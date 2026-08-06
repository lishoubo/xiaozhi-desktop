#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SHOULD_CLEAN=false

usage() {
  cat <<'EOF'
用法: scripts/desktop-dev.sh [--clean|--no-clean] [-- Electron Forge 参数]

选项:
  --clean       启动前清理桌面构建缓存和打包产物
  --no-clean    不清理（默认）
  -h, --help    显示帮助

示例:
  scripts/desktop-dev.sh
  scripts/desktop-dev.sh --clean
  scripts/desktop-dev.sh --clean -- --inspect-electron
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --clean)
      SHOULD_CLEAN=true
      shift
      ;;
    --no-clean)
      SHOULD_CLEAN=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$SHOULD_CLEAN" = true ]; then
  "$SCRIPT_DIR/desktop-clean.sh"
fi

cd "$REPO_ROOT"
exec npm run dev --workspace @hotel-butler/desktop -- "$@"
