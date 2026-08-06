#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

usage() {
  cat <<'EOF'
用法: scripts/desktop-make.sh [Electron Forge make 参数]

打包前会固定清理 apps/desktop/.vite 和 apps/desktop/out，其他参数原样传给
Electron Forge make。

示例:
  scripts/desktop-make.sh
  scripts/desktop-make.sh --platform=darwin --arch=x64
  scripts/desktop-make.sh --platform=darwin --arch=arm64
  scripts/desktop-make.sh --platform=win32 --arch=x64
EOF
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

"$SCRIPT_DIR/desktop-clean.sh"

cd "$REPO_ROOT"
exec npm run make --workspace @hotel-butler/desktop -- "$@"
