#!/usr/bin/env bash
set -euo pipefail

server_ip="121.199.29.74"
remote_directory="hotel-butler-image-upload"
platform_name="linux-amd64"

if [[ "$#" -ne 1 ]]; then
  echo "Usage: npm run upload:server:production -- <ssh-user>" >&2
  exit 1
fi

ssh_user="$1"
if [[ ! "${ssh_user}" =~ ^[a-z_][a-z0-9_-]*\$?$ ]]; then
  echo "SSH user contains unsupported characters: ${ssh_user}" >&2
  exit 1
fi

for command_name in git scp ssh; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/../../.." && pwd)"
ssh_key="${repository_root}/apps/server/rms-agent-key.pem"
revision="$(git -C "${repository_root}" rev-parse --short=12 HEAD)"
release_pointer="${repository_root}/output/deploy/current-image-release"
if [[ ! -f "${release_pointer}" || -L "${release_pointer}" ]]; then
  echo "Missing release pointer; run npm run package:server:production first." >&2
  exit 1
fi
artifact_name="$(<"${release_pointer}")"
if [[ ! "${artifact_name}" =~ ^hotel-butler-server-(full-)?images-${revision}-${platform_name}\.tar$ ]]; then
  echo "Release pointer does not reference the current Git revision and platform: ${artifact_name}" >&2
  exit 1
fi
checksum_name="${artifact_name}.sha256"
artifact_path="${repository_root}/output/deploy/${artifact_name}"
checksum_path="${repository_root}/output/deploy/${checksum_name}"

for required_file in "${ssh_key}" "${artifact_path}" "${checksum_path}"; do
  if [[ ! -f "${required_file}" || -L "${required_file}" ]]; then
    echo "Required regular file is missing or is a symbolic link: ${required_file}" >&2
    exit 1
  fi
done

if key_mode="$(stat -f '%Lp' "${ssh_key}" 2>/dev/null)"; then
  :
else
  key_mode="$(stat -c '%a' "${ssh_key}")"
fi
if [[ "${key_mode: -2}" != "00" ]]; then
  echo "SSH private key permissions must not allow group or other access: ${ssh_key}" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd -- "$(dirname -- "${artifact_path}")" && sha256sum -c "${checksum_name}")
elif command -v shasum >/dev/null 2>&1; then
  (cd -- "$(dirname -- "${artifact_path}")" && shasum -a 256 -c "${checksum_name}")
else
  echo "Neither sha256sum nor shasum is available for local checksum verification." >&2
  exit 1
fi

ssh_target="${ssh_user}@${server_ip}"
upload_id="$(date +%s)-$$"
staging_directory="${remote_directory}/.incoming-${revision}-${upload_id}"
ssh_options=(
  -i "${ssh_key}"
  -o IdentitiesOnly=yes
  -o ConnectTimeout=10
)

ssh "${ssh_options[@]}" "${ssh_target}" \
  "set -eu; umask 077; install -d -m 0700 \"\$HOME/${remote_directory}\" \"\$HOME/${staging_directory}\""

scp "${ssh_options[@]}" "${artifact_path}" "${checksum_path}" \
  "${ssh_target}:${staging_directory}/"

ssh "${ssh_options[@]}" "${ssh_target}" \
  "set -eu; cd \"\$HOME/${staging_directory}\"; sha256sum -c \"${checksum_name}\"; mv -f \"${checksum_name}\" \"\$HOME/${remote_directory}/${checksum_name}\"; mv -f \"${artifact_name}\" \"\$HOME/${remote_directory}/${artifact_name}\"; printf '%s\\n' \"${artifact_name}\" >\"\$HOME/${remote_directory}/.current-image-release.tmp\"; mv -f \"\$HOME/${remote_directory}/.current-image-release.tmp\" \"\$HOME/${remote_directory}/current-image-release\"; cd \"\$HOME/${remote_directory}\"; rmdir \"\$HOME/${staging_directory}\""

echo "Production image release uploaded and verified:"
echo "  server: ${server_ip}"
echo "  remote directory: ~/${remote_directory}"
echo "  artifact: ${artifact_name}"
echo "No archive was extracted, no migration was run, and no service was changed."
