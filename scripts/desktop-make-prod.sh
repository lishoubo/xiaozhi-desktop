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
#   HOTEL_BUTLER_SERVER_URL=https://10.0.0.8 \
#   HOTEL_BUTLER_PRIVATE_CA_PATH=/secure/deploy-ca.pem scripts/desktop-make-prod.sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# 线上 RMS 地址。允许调用方通过环境变量覆盖，便于打别的环境。
: "${XIAOZHI_RMS_SERVER_URL:=http://47.96.144.176}"
export XIAOZHI_RMS_SERVER_URL

: "${HOTEL_BUTLER_SERVER_URL:?Set HOTEL_BUTLER_SERVER_URL to the production HTTPS backend}"
: "${HOTEL_BUTLER_PRIVATE_CA_PATH:?Set HOTEL_BUTLER_PRIVATE_CA_PATH to the public CA certificate}"
case "$HOTEL_BUTLER_SERVER_URL" in
  https://*) ;;
  *)
    echo "错误: HOTEL_BUTLER_SERVER_URL 必须使用 HTTPS。" >&2
    exit 1
    ;;
esac
if [ ! -f "$HOTEL_BUTLER_PRIVATE_CA_PATH" ]; then
  echo "错误: 找不到私有 CA 公钥证书: $HOTEL_BUTLER_PRIVATE_CA_PATH" >&2
  exit 1
fi
if [ "$(basename "$HOTEL_BUTLER_PRIVATE_CA_PATH")" != "private-ca.pem" ]; then
  echo "错误: 私有 CA 公钥证书文件名必须是 private-ca.pem。" >&2
  exit 1
fi
export HOTEL_BUTLER_SERVER_URL HOTEL_BUTLER_PRIVATE_CA_PATH

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
echo "后端地址: $HOTEL_BUTLER_SERVER_URL"

exec "$SCRIPT_DIR/desktop-make.sh" "$@"
