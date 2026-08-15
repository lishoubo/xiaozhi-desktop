#!/usr/bin/env bash
set -euo pipefail

target_platform="linux/amd64"
platform_name="linux-amd64"
server_image_name="hotel-butler-server"
pgvector_image="pgvector/pgvector:0.8.5-pg18"
production_ip="121.199.29.74"
include_database_image=false

if [[ "$#" -gt 1 ]]; then
  echo "Usage: npm run package:server:production -- [--include-database-image]" >&2
  exit 1
fi
if [[ "$#" -eq 1 ]]; then
  if [[ "$1" != "--include-database-image" ]]; then
    echo "Unsupported argument: $1" >&2
    echo "Usage: npm run package:server:production -- [--include-database-image]" >&2
    exit 1
  fi
  include_database_image=true
fi

for command_name in docker git gzip node tar; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/../../.." && pwd)"

dirty="$(git -C "${repository_root}" status --porcelain=v1 --untracked-files=all)"
if [[ -n "${dirty}" ]]; then
  echo "Refusing to package production images from a dirty Git worktree." >&2
  exit 1
fi

revision="$(git -C "${repository_root}" rev-parse --short=12 HEAD)"
if [[ ! "${revision}" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "Could not resolve the Git revision." >&2
  exit 1
fi

node --experimental-strip-types \
  "${repository_root}/apps/server/scripts/validate-production-runtime.ts"

docker info >/dev/null
docker buildx inspect --bootstrap >/dev/null

server_image="${server_image_name}:${revision}"
docker buildx build \
  --platform "${target_platform}" \
  --target production \
  --file "${repository_root}/apps/server/Dockerfile" \
  --tag "${server_image}" \
  --load \
  "${repository_root}"

expected_architecture="${target_platform#linux/}"
images_to_save=("${server_image}")
if [[ "${include_database_image}" == true ]]; then
  docker pull --platform "${target_platform}" "${pgvector_image}"
  images_to_save+=("${pgvector_image}")
fi

for image_name in "${images_to_save[@]}"; do
  actual_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "${image_name}")"
  if [[ "${actual_platform}" != "linux/${expected_architecture}" ]]; then
    echo "Image ${image_name} has platform ${actual_platform}; expected ${target_platform}." >&2
    exit 1
  fi
done

output_directory="${repository_root}/output/deploy"
if [[ "${include_database_image}" == true ]]; then
  artifact_prefix="hotel-butler-server-full-images"
else
  artifact_prefix="hotel-butler-server-images"
fi
artifact_name="${artifact_prefix}-${revision}-${platform_name}.tar"
checksum_name="${artifact_name}.sha256"
artifact_path="${output_directory}/${artifact_name}"
checksum_path="${output_directory}/${checksum_name}"
if [[ -e "${artifact_path}" || -e "${checksum_path}" ]]; then
  echo "Refusing to overwrite an existing image release for ${revision}: ${artifact_path}" >&2
  exit 1
fi

mkdir -p "${output_directory}"
staging_directory="$(mktemp -d "${output_directory}/.image-staging.XXXXXX")"
cleanup() {
  if [[ -n "${staging_directory:-}" && -d "${staging_directory}" ]]; then
    rm -rf -- "${staging_directory}"
  fi
}
trap cleanup EXIT

release_directory="${staging_directory}/hotel-butler-release"
runtime_directory="${release_directory}/runtime"
tls_directory="${release_directory}/tls/server"
mkdir -p "${runtime_directory}" "${tls_directory}"

install -m 0644 \
  "${repository_root}/apps/server/compose.production.yaml" \
  "${runtime_directory}/compose.production.yaml"
install -m 0755 \
  "${repository_root}/apps/server/scripts/prepare-production-host.sh" \
  "${runtime_directory}/prepare-production-host.sh"
install -m 0755 \
  "${repository_root}/apps/server/scripts/deploy-production-images.sh" \
  "${runtime_directory}/deploy-production-images.sh"

awk '!/^SERVER_IMAGE_TAG=|^PGVECTOR_IMAGE_TAG=/' \
  "${repository_root}/apps/server/.env.production" >"${runtime_directory}/.env.production"
{
  printf '\nSERVER_IMAGE_TAG="%s"\n' "${revision}"
  printf 'PGVECTOR_IMAGE_TAG="%s"\n' "${pgvector_image##*:}"
} >>"${runtime_directory}/.env.production"
chmod 0600 "${runtime_directory}/.env.production"

install -m 0644 \
  "${repository_root}/output/production-tls/${production_ip}/server/ca.pem" \
  "${tls_directory}/ca.pem"
install -m 0644 \
  "${repository_root}/output/production-tls/${production_ip}/server/cert.pem" \
  "${tls_directory}/cert.pem"
install -m 0600 \
  "${repository_root}/output/production-tls/${production_ip}/server/key.pem" \
  "${tls_directory}/key.pem"

{
  printf 'RELEASE_REVISION=%s\n' "${revision}"
  printf 'TARGET_PLATFORM=%s\n' "${target_platform}"
  printf 'SERVER_IMAGE=%s\n' "${server_image}"
  printf 'PGVECTOR_IMAGE=%s\n' "${pgvector_image}"
  printf 'INCLUDES_DATABASE_IMAGE=%s\n' "${include_database_image}"
} >"${release_directory}/manifest.env"
chmod 0644 "${release_directory}/manifest.env"

docker image save "${images_to_save[@]}" | gzip -9 >"${release_directory}/images.tar.gz"
chmod 0600 "${release_directory}/images.tar.gz"

staged_artifact="${staging_directory}/${artifact_name}"
tar -cf "${staged_artifact}" -C "${staging_directory}" hotel-butler-release
chmod 0600 "${staged_artifact}"
mv "${staged_artifact}" "${artifact_path}"

if command -v sha256sum >/dev/null 2>&1; then
  (cd -- "${output_directory}" && sha256sum "${artifact_name}" >"${checksum_name}")
elif command -v shasum >/dev/null 2>&1; then
  (cd -- "${output_directory}" && shasum -a 256 "${artifact_name}" >"${checksum_name}")
else
  echo "Neither sha256sum nor shasum is available for checksum generation." >&2
  exit 1
fi

release_pointer="${output_directory}/current-image-release"
temporary_pointer="${staging_directory}/current-image-release"
printf '%s\n' "${artifact_name}" >"${temporary_pointer}"
mv "${temporary_pointer}" "${release_pointer}"

echo "Offline production image release created:"
echo "  artifact: ${artifact_path}"
echo "  checksum: ${checksum_path}"
echo "  platform: ${target_platform}"
echo "  server image: ${server_image}"
echo "  includes database image: ${include_database_image}"
echo "The artifact contains production secrets and TLS private-key material; keep it mode 0600."
