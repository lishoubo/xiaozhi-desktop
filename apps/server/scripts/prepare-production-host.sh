#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this command as root (for example with sudo)." >&2
  exit 1
fi

deploy_root="${HOTEL_BUTLER_DEPLOY_ROOT:-/opt/hotel-butler}"
postgres_data_dir="${POSTGRES_DATA_DIR:-/var/lib/hotel-butler/postgresql}"
postgres_uid="${HOTEL_BUTLER_POSTGRES_UID:-999}"
postgres_gid="${HOTEL_BUTLER_POSTGRES_GID:-999}"
server_uid="${HOTEL_BUTLER_SERVER_UID:-1000}"
server_gid="${HOTEL_BUTLER_SERVER_GID:-1000}"
preferred_deploy_uid="${HOTEL_BUTLER_DEPLOY_UID:-2000}"
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
validate_id "${preferred_deploy_uid}" "HOTEL_BUTLER_DEPLOY_UID"
if [[ "${preferred_deploy_uid}" -eq "${postgres_uid}" || "${preferred_deploy_uid}" -eq "${server_uid}" ]]; then
  echo "HOTEL_BUTLER_DEPLOY_UID must differ from PostgreSQL and server container UIDs." >&2
  exit 1
fi

default_deploy_user="hotelbutler"
deploy_user_is_automatic=false
if [[ -n "${HOTEL_BUTLER_DEPLOY_USER:-}" ]]; then
  deploy_user="${HOTEL_BUTLER_DEPLOY_USER}"
elif [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  deploy_user="${SUDO_USER}"
else
  deploy_user="${default_deploy_user}"
  deploy_user_is_automatic=true
fi
if [[ ! "${deploy_user}" =~ ^[a-z_][a-z0-9_-]*\$?$ ]]; then
  echo "HOTEL_BUTLER_DEPLOY_USER contains unsupported characters: ${deploy_user}" >&2
  exit 1
fi

deploy_user_created=false
if ! id "${deploy_user}" >/dev/null 2>&1; then
  if ! command -v useradd >/dev/null 2>&1; then
    echo "Deployment user does not exist and useradd is unavailable: ${deploy_user}" >&2
    exit 1
  fi
  nologin_shell="/usr/sbin/nologin"
  if [[ ! -x "${nologin_shell}" ]]; then
    nologin_shell="/sbin/nologin"
  fi
  if [[ ! -x "${nologin_shell}" ]]; then
    nologin_shell="/bin/false"
  fi
  useradd --uid "${preferred_deploy_uid}" --user-group --home-dir "${deploy_root}" \
    --no-create-home --shell "${nologin_shell}" "${deploy_user}"
  deploy_user_created=true
fi
actual_deploy_uid="$(id -u "${deploy_user}")"
if [[ "${actual_deploy_uid}" -eq 0 ]]; then
  echo "Deployment owner must not be root: ${deploy_user}" >&2
  exit 1
fi
if [[ "${actual_deploy_uid}" -eq "${postgres_uid}" ]]; then
  echo "Deployment owner UID conflicts with the PostgreSQL container UID: ${actual_deploy_uid}" >&2
  exit 1
fi
if [[ "${deploy_user_is_automatic}" == true ]]; then
  if [[ "${actual_deploy_uid}" -ne "${preferred_deploy_uid}" ]]; then
    echo "Existing automatic deployment owner has unexpected UID ${actual_deploy_uid}; expected ${preferred_deploy_uid}." >&2
    echo "Choose another account with HOTEL_BUTLER_DEPLOY_USER and HOTEL_BUTLER_DEPLOY_UID." >&2
    exit 1
  fi
  deploy_shell="$(awk -F: -v account="${deploy_user}" '$1 == account { print $7; exit }' /etc/passwd)"
  case "${deploy_shell}" in
    /usr/sbin/nologin | /sbin/nologin | /bin/false) ;;
    *)
      echo "Existing automatic deployment owner must use a non-login shell: ${deploy_user}" >&2
      exit 1
      ;;
  esac
fi

deploy_group="$(id -gn "${deploy_user}")"
deploy_uid="${actual_deploy_uid}"
app_directory="${deploy_root}/app"
tls_directory="${deploy_root}/tls/server"

install -d -o "${deploy_user}" -g "${deploy_group}" -m 0750 "${deploy_root}" "${app_directory}"
install -d -o "${deploy_uid}" -g "${server_gid}" -m 0750 "${deploy_root}/tls" "${tls_directory}"
install -d -o "${postgres_uid}" -g "${postgres_gid}" -m 0700 "${postgres_data_dir}"
install -d -o "${server_uid}" -g "${server_gid}" -m 0750 "${server_log_dir}"
chown -R "${deploy_uid}:${deploy_group}" "${app_directory}"

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
echo "  deployment owner: ${deploy_user} (created: ${deploy_user_created})"
echo "  application: ${app_directory}"
echo "  server TLS:  ${tls_directory}"
echo "  PostgreSQL:  ${postgres_data_dir}"
echo "  server logs: ${server_log_dir}"
echo "  log rotation: ${logrotate_config} (when logrotate is installed)"
echo "Ensure .env.production exists at ${app_directory}/apps/server/.env.production with mode 0600."
echo "Ensure cert.pem, key.pem and ca.pem exist in ${tls_directory}; keep key.pem restricted."
echo "No service, firewall rule or remote deployment was changed."
