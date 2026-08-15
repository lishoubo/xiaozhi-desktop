#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

echo "scripts/desktop-make-prod.sh 已兼容保留；生产打包统一走 make:desktop:production。" >&2
cd "$REPO_ROOT"
exec npm run make:desktop:production -- "$@"
