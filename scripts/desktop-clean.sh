#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DESKTOP_DIR="$REPO_ROOT/apps/desktop"

clean_directory() {
  target=$1

  case "$target" in
    "$DESKTOP_DIR/.vite"|"$DESKTOP_DIR/out") ;;
    *)
      echo "拒绝清理未声明的目录: $target" >&2
      exit 1
      ;;
  esac

  if [ -e "$target" ]; then
    echo "清理 $target"
    rm -rf -- "$target"
  fi
}

clean_directory "$DESKTOP_DIR/.vite"
clean_directory "$DESKTOP_DIR/out"
