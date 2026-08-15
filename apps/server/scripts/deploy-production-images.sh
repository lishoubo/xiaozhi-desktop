#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this command as root (for example with sudo)." >&2
  exit 1
fi

for command_name in docker gzip install uname; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command_name}" >&2
    exit 1
  fi
done
docker compose version >/dev/null

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot verify Alibaba Cloud Linux 4 because /etc/os-release is unavailable." >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "alinux" || "${VERSION_ID%%.*}" != "4" ]]; then
  echo "This deployment script targets Alibaba Cloud Linux 4; found ${PRETTY_NAME:-unknown Linux}." >&2
  exit 1
fi

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
release_directory="$(cd -- "${script_directory}/.." && pwd)"
manifest_path="${release_directory}/manifest.env"
image_archive="${release_directory}/images.tar.gz"

manifest_value() {
  local key="$1"
  awk -F= -v expected_key="${key}" '$1 == expected_key { print substr($0, index($0, "=") + 1); exit }' \
    "${manifest_path}"
}

for required_file in \
  "${manifest_path}" \
  "${image_archive}" \
  "${script_directory}/compose.production.yaml" \
  "${script_directory}/.env.production" \
  "${script_directory}/prepare-production-host.sh" \
  "${release_directory}/tls/server/ca.pem" \
  "${release_directory}/tls/server/cert.pem" \
  "${release_directory}/tls/server/key.pem"; do
  if [[ ! -f "${required_file}" || -L "${required_file}" ]]; then
    echo "Required regular file is missing or is a symbolic link: ${required_file}" >&2
    exit 1
  fi
done

target_platform="$(manifest_value TARGET_PLATFORM)"
server_image="$(manifest_value SERVER_IMAGE)"
pgvector_image="$(manifest_value PGVECTOR_IMAGE)"
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "This release targets the production x86_64 ECS; found $(uname -m)." >&2
  exit 1
fi
if [[ "${target_platform}" != "linux/amd64" ]]; then
  echo "Production releases must target linux/amd64; found ${target_platform}." >&2
  exit 1
fi
if [[ ! "${server_image}" =~ ^hotel-butler-server:[0-9a-f]{7,40}$ ]]; then
  echo "Invalid server image in release manifest: ${server_image}" >&2
  exit 1
fi
if [[ "${pgvector_image}" != "pgvector/pgvector:0.8.5-pg18" ]]; then
  echo "Unexpected pgvector image in release manifest: ${pgvector_image}" >&2
  exit 1
fi

deploy_root="${HOTEL_BUTLER_DEPLOY_ROOT:-/opt/hotel-butler}"
app_directory="${deploy_root}/app"
server_directory="${app_directory}/apps/server"
compose_path="${server_directory}/compose.production.yaml"
environment_path="${server_directory}/.env.production"
backup_directory="${deploy_root}/backups/postgresql"

bash "${script_directory}/prepare-production-host.sh"

if [[ -f "${compose_path}" && -f "${environment_path}" ]]; then
  existing_compose=(--env-file "${environment_path}" -f "${compose_path}")
  if docker compose "${existing_compose[@]}" ps --status running --services 2>/dev/null | grep -Fxq db; then
    install -d -m 0700 "${backup_directory}"
    backup_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_path="${backup_directory}/before-${backup_timestamp}.dump"
    temporary_backup="${backup_path}.tmp"
    echo "Creating pre-migration PostgreSQL backup: ${backup_path}"
    if ! docker compose "${existing_compose[@]}" exec -T db \
      sh -eu -c 'exec pg_dump --host 127.0.0.1 --port "${POSTGRES_PORT:-35432}" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom' \
      >"${temporary_backup}"; then
      rm -f -- "${temporary_backup}"
      echo "PostgreSQL backup failed; deployment stopped before migration." >&2
      exit 1
    fi
    chmod 0600 "${temporary_backup}"
    mv "${temporary_backup}" "${backup_path}"
  else
    if [[ "${HOTEL_BUTLER_ALLOW_MIGRATION_WITHOUT_BACKUP:-}" != "1" ]]; then
      echo "An existing deployment was found, but its PostgreSQL container is not running." >&2
      echo "Start the existing db service so it can be backed up, or explicitly set" >&2
      echo "HOTEL_BUTLER_ALLOW_MIGRATION_WITHOUT_BACKUP=1 after arranging another backup." >&2
      exit 1
    fi
    echo "Warning: proceeding without an automatic PostgreSQL backup by explicit override." >&2
  fi
fi

install -d -m 0750 "${server_directory}/scripts" "${deploy_root}/tls/server"
install -m 0644 "${script_directory}/compose.production.yaml" "${compose_path}"
install -m 0600 "${script_directory}/.env.production" "${environment_path}"
install -m 0755 "${script_directory}/prepare-production-host.sh" \
  "${server_directory}/scripts/prepare-production-host.sh"
install -m 0755 "${script_directory}/deploy-production-images.sh" \
  "${server_directory}/scripts/deploy-production-images.sh"
install -m 0644 "${release_directory}/tls/server/ca.pem" "${deploy_root}/tls/server/ca.pem"
install -m 0644 "${release_directory}/tls/server/cert.pem" "${deploy_root}/tls/server/cert.pem"
install -m 0640 "${release_directory}/tls/server/key.pem" "${deploy_root}/tls/server/key.pem"
bash "${server_directory}/scripts/prepare-production-host.sh"

echo "Loading offline Docker images."
gzip -dc "${image_archive}" | docker image load
server_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "${server_image}")"
if [[ "${server_platform}" != "${target_platform}" ]]; then
  echo "Loaded image ${server_image} has platform ${server_platform}; expected ${target_platform}." >&2
  exit 1
fi
if ! database_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "${pgvector_image}" 2>/dev/null)"; then
  echo "Database image is unavailable on this ECS host: ${pgvector_image}" >&2
  echo "Create and upload a full release with --include-database-image." >&2
  exit 1
fi
if [[ "${database_platform}" != "${target_platform}" ]]; then
  echo "Database image ${pgvector_image} has platform ${database_platform}; expected ${target_platform}." >&2
  exit 1
fi

compose=(--env-file "${environment_path}" -f "${compose_path}")
docker compose "${compose[@]}" config --quiet
docker compose "${compose[@]}" up --detach --wait --no-build --pull never db

echo "Stopping the application before database migration."
docker compose "${compose[@]}" stop server >/dev/null 2>&1 || true

echo "Running database migrations and idempotent administrator initialization."
docker compose "${compose[@]}" run --rm --no-deps database-init

echo "Starting the server from the loaded image."
docker compose "${compose[@]}" up \
  --detach --wait --no-build --pull never --force-recreate --no-deps server
docker compose "${compose[@]}" ps

echo "Offline image deployment completed."
echo "The server uses ${server_image}; no application source code is required on this host."
