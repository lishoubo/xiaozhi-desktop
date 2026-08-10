#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DESKTOP_DIR="$REPO_ROOT/apps/desktop"

# Electron 的 app.getPath('userData') 按平台展开为
# macOS:   ~/Library/Application Support/<productName>
# Linux:   ~/.config/<productName>
# Windows: %APPDATA%\<productName>
# 与 electron-forge/Squirrel 打包产物无关，构建缓存清理不会触碰它——
# 这里单独算出来，跟 .vite/out 一起清，避免每次手动去翻这个目录。
USER_DATA_DIR=$(node -e "
  const path = require('node:path');
  const { productName } = require('$DESKTOP_DIR/package.json');
  const home = process.env.HOME || process.env.USERPROFILE;
  if (process.platform === 'darwin') {
    console.log(path.join(home, 'Library', 'Application Support', productName));
  } else if (process.platform === 'win32') {
    console.log(path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), productName));
  } else {
    console.log(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), productName));
  }
")

clean_directory() {
  target=$1

  case "$target" in
    "$DESKTOP_DIR/.vite"|"$DESKTOP_DIR/out"|"$USER_DATA_DIR") ;;
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
clean_directory "$USER_DATA_DIR"
