#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this command as root (for example with sudo)." >&2
  exit 1
fi

deploy_user="${HOTEL_BUTLER_DEPLOY_USER:-${SUDO_USER:-}}"
if [[ -z "${deploy_user}" || "${deploy_user}" == "root" ]]; then
  echo "Set HOTEL_BUTLER_DEPLOY_USER to the non-root account that owns deployments." >&2
  exit 1
fi
if ! id "${deploy_user}" >/dev/null 2>&1; then
  echo "Deployment user does not exist: ${deploy_user}" >&2
  exit 1
fi

deploy_root="${HOTEL_BUTLER_DEPLOY_ROOT:-/opt/hotel-butler}"
postgres_data_dir="${POSTGRES_DATA_DIR:-/var/lib/hotel-butler/postgresql}"
postgres_uid="${HOTEL_BUTLER_POSTGRES_UID:-999}"
postgres_gid="${HOTEL_BUTLER_POSTGRES_GID:-999}"
server_uid="${HOTEL_BUTLER_SERVER_UID:-1000}"
server_gid="${HOTEL_BUTLER_SERVER_GID:-1000}"
server_log_dir="${SERVER_LOG_DIR:-/var/log/hotel-butler/server}"
logrotate_config="${HOTEL_BUTLER_LOGROTATE_CONFIG:-/etc/logrotate.d/hotel-butler-server}"

validate_directory() {
  local value="$1"
  local label="$2"
  local relative="${value#/}"
  if [[ "${value}" != /* || "${value}" == "/" || "${relative}" != */* || "${value}" == *".."* ]]; then
    echo "${label} must be a specific absolute directory below a top-level directory: ${value}" >&2
    exit 1
  fi
}

validate_id() {
  local value="$1"
  local label="$2"
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || [[ "${value}" -eq 0 ]]; then
    echo "${label} must be a positive numeric container ID: ${value}" >&2
    exit 1
  fi
}

validate_directory "${deploy_root}" "HOTEL_BUTLER_DEPLOY_ROOT"
validate_directory "${postgres_data_dir}" "POSTGRES_DATA_DIR"
validate_directory "${server_log_dir}" "SERVER_LOG_DIR"
if [[ "${logrotate_config}" != /* || "${logrotate_config}" == "/" || "${logrotate_config}" == *".."* ]]; then
  echo "HOTEL_BUTLER_LOGROTATE_CONFIG must be a specific absolute file path: ${logrotate_config}" >&2
  exit 1
fi
validate_id "${postgres_uid}" "HOTEL_BUTLER_POSTGRES_UID"
validate_id "${postgres_gid}" "HOTEL_BUTLER_POSTGRES_GID"
validate_id "${server_uid}" "HOTEL_BUTLER_SERVER_UID"
validate_id "${server_gid}" "HOTEL_BUTLER_SERVER_GID"

deploy_group="$(id -gn "${deploy_user}")"
deploy_uid="$(id -u "${deploy_user}")"
app_directory="${deploy_root}/app"
tls_directory="${deploy_root}/tls/server"

install -d -o "${deploy_user}" -g "${deploy_group}" -m 0750 "${deploy_root}" "${app_directory}"
install -d -o "${deploy_uid}" -g "${server_gid}" -m 0750 "${deploy_root}/tls" "${tls_directory}"
install -d -o "${postgres_uid}" -g "${postgres_gid}" -m 0700 "${postgres_data_dir}"
install -d -o "${server_uid}" -g "${server_gid}" -m 0750 "${server_log_dir}"

production_environment="${app_directory}/apps/server/.env.production"
if [[ -f "${production_environment}" ]]; then
  chown "${deploy_uid}:${deploy_group}" "${production_environment}"
  chmod 0600 "${production_environment}"
fi
for tls_file in ca.pem cert.pem key.pem; do
  tls_path="${tls_directory}/${tls_file}"
  if [[ -f "${tls_path}" ]]; then
    chown "${deploy_uid}:${server_gid}" "${tls_path}"
    if [[ "${tls_file}" == "key.pem" ]]; then
      chmod 0640 "${tls_path}"
    else
      chmod 0644 "${tls_path}"
    fi
  fi
done

if command -v logrotate >/dev/null 2>&1; then
  {
    echo "${server_log_dir}/server.jsonl {"
    echo "  daily"
    echo "  maxsize 50M"
    echo "  rotate 14"
    echo "  compress"
    echo "  delaycompress"
    echo "  missingok"
    echo "  notifempty"
    echo "  copytruncate"
    echo "}"
  } >"${logrotate_config}"
  chmod 0644 "${logrotate_config}"
else
  echo "Warning: logrotate is not installed; configure rotation for ${server_log_dir}/server.jsonl." >&2
fi

echo "Production host directories are ready:"
echo "  application: ${app_directory}"
echo "  server TLS:  ${tls_directory}"
echo "  PostgreSQL:  ${postgres_data_dir}"
echo "  server logs: ${server_log_dir}"
echo "  log rotation: ${logrotate_config} (when logrotate is installed)"
echo "Ensure .env.production exists at ${app_directory}/apps/server/.env.production with mode 0600."
echo "Ensure cert.pem, key.pem and ca.pem exist in ${tls_directory}; keep key.pem restricted."
echo "No service, firewall rule or remote deployment was changed."
