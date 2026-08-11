#!/bin/sh
#
# 打线上包：把 RMS 服务端地址烧进产物后调用 desktop-make.sh。
#
# 地址是构建期注入的（见 apps/desktop/vite-plugins/rms-origin.ts），不是运行时
# 读环境变量——打包产物被双击启动时拿不到父进程的环境变量。
#
# 用法:
#   scripts/desktop-make-prod.sh                          # 默认当前架构
#   scripts/desktop-make-prod.sh --platform=darwin --arch=arm64
#   XIAOZHI_RMS_SERVER_URL=https://rms.example.com scripts/desktop-make-prod.sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# 线上 RMS 地址。允许调用方通过环境变量覆盖，便于打别的环境。
: "${XIAOZHI_RMS_SERVER_URL:=http://47.96.144.176}"
export XIAOZHI_RMS_SERVER_URL

# 该地址是明文 HTTP，构建期校验要求显式豁免才放行。
# RMS 上 HTTPS 之后，删掉这一行即可恢复默认的强制校验。
case "$XIAOZHI_RMS_SERVER_URL" in
  https://*) ;;
  *)
    export XIAOZHI_ALLOW_INSECURE_RMS=1
    echo "警告: RMS 地址为明文 HTTP ($XIAOZHI_RMS_SERVER_URL)，JWT 将以明文传输。" >&2
    ;;
esac

echo "RMS 地址: $XIAOZHI_RMS_SERVER_URL"

exec "$SCRIPT_DIR/desktop-make.sh" "$@"
