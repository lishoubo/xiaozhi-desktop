# 小智酒店管家

小智酒店管家是一套面向酒店运营人员的桌面工作台。仓库同时包含 Electron 桌面应用、
SvelteKit backend API 与管理后台，以及两端共享的 tRPC 契约。

| 目录 | 职责 |
|---|---|
| `apps/desktop/` | Electron 桌面应用 |
| `apps/server/` | Desktop API、Agent 服务和业务数据管理后台 |
| `packages/api/` | desktop 与 server 共享的 tRPC contract、schema 和纯类型 |

## 环境要求

- Node.js 24
- npm 11
- Docker 与 Docker Compose v2
- mkcert（由项目的 HTTPS 初始化命令调用）

首次使用先安装依赖：

```bash
npm install
```

## 快速开始

推荐用 Docker Compose 运行本地数据库和 server，再单独启动 desktop：

```bash
npm run compose:dev:up
npm run dev:desktop:phone
```

账号密码版 desktop 使用：

```bash
npm run dev:desktop:staff
```

启动完成后，本地服务默认使用以下地址：

| 服务 | 地址 |
|---|---|
| Desktop renderer | `https://localhost:5174` |
| Desktop backend API | `https://localhost:5173` |
| PostgreSQL | `localhost:5432` |
| RMS MySQL | `localhost:3306` |

首次启动会自动检查本地 HTTPS 证书，可能要求完成一次系统授权。不要通过关闭 TLS 校验
绕过证书安装。

## 本地 server 的两种运行方式

### Docker Compose

```bash
npm run compose:dev:up
```

该命令会构建并启动 PostgreSQL、RMS MySQL、数据库初始化任务和 server。server 在容器内
监听 `4173`，默认映射到宿主机的 `https://localhost:5173`，因此 desktop 无需切换地址。

常用命令：

```bash
npm run compose:dev:config  # 校验 Compose 配置
npm run compose:dev:logs    # 跟随 server 日志
npm run compose:dev:down    # 停止本地 Compose 环境
```

如需修改 Compose 暴露到宿主机的 HTTPS 端口，可在环境中设置
`SERVER_HTTPS_PORT`。同时需要通过 `HOTEL_BUTLER_SERVER_URL` 为 desktop 指定匹配的
HTTPS 地址。

### 宿主机直启

```bash
npm run dev:server
```

宿主机直启同样默认使用 `https://localhost:5173`，并读取 `apps/server/.env` 中的宿主机
数据库连接地址。启动前置流程会自动准备 HTTPS 证书、确保本地数据库容器可用并初始化
数据库。

Compose server 和宿主机 server 是两种替代运行方式，默认都会占用宿主机 `5173`，不要
同时启动。

## 启动 desktop

仓库提供两种认证 Profile：

```bash
npm run dev:desktop:staff  # 账号密码认证
npm run dev:desktop:phone  # 手机号认证
```

`npm run dev:desktop` 是 staff Profile 的别名。Profile 在构建时选择：staff 包只装配账号
密码认证，phone 包只装配手机号认证；server 始终注册两套认证接口，不需要切换运行模式。

desktop 默认连接 `https://localhost:5173`。如需连接其他 server，可在启动前设置完整的
HTTPS origin：

```bash
HOTEL_BUTLER_SERVER_URL=https://localhost:5443 npm run dev:desktop:phone
```

## 本地配置

本地配置位于 `apps/server/.env`。宿主机直启与 Docker Compose 使用不同的数据库地址：

| 宿主机直启 | Docker Compose | 用途 |
|---|---|---|
| `DATABASE_URL` | `COMPOSE_DATABASE_URL` | PostgreSQL |
| `RMS_DATABASE_URL` | `COMPOSE_RMS_DATABASE_URL` | RMS MySQL 身份源 |

Compose 只把 server 需要的变量显式注入容器，不会把 `.env` 或数据库管理变量整体传入
server。

`RMS_DATABASE_URL` 是可选能力配置：

- 未配置时，server 不创建 RMS MySQL 连接池；手机号身份查询会返回明确的服务不可用提示。
- 已配置时，server 创建 RMS MySQL 连接池，为 staff 与 phone 两种客户端提供身份能力。

server 还会通过 `XIAOZHI_RMS_SERVER_URL` 访问 RMS HTTPS API。该地址与 RMS MySQL 连接
用途不同，不应混用。

## HTTPS 证书

开发入口会自动执行证书检查，也可以手动运行：

```bash
npm run https:setup
```

证书保存在被 Git 忽略的 `apps/server/.cert/`。Docker 只读挂载宿主机签发的证书，不会在
容器中创建独立 CA。CA 私钥和服务私钥不得提交或分享。

## 检查与测试

```bash
npm run check              # TypeScript 与 Svelte 检查
npm run lint               # ESLint
npm run test:unit          # 全仓单元测试
npm run test:e2e           # 全仓 E2E
npm run verify             # 完整验证入口
```

开发过程中应优先运行改动直接命中的定向测试；准备交付时再运行对应范围的完整验证。

## 生产 server

当前生产 server 使用：

| 用途 | 地址 |
|---|---|
| Desktop API / Agent HTTPS | `https://121.199.29.74:35443` |
| PostgreSQL 宿主机端口 | `35432` |

生产 PostgreSQL 端口只应对可信源 IP 开放，不应暴露给公网。

### 1. 准备生产配置与证书

以下命令只在目标文件不存在时创建内容，不会覆盖已有私有配置：

```bash
npm run env:setup:production
npm run https:setup:production
chmod 600 apps/server/.env.production
```

随后补全 `apps/server/.env.production` 中的 RMS、AI 和初始管理员配置。生产证书输出在
`output/production-tls/121.199.29.74/`。`ca-key.pem`、server 私钥和生产环境文件均为
敏感材料，不得提交或外传。

### 2. 生成部署包

生产部署包只允许从已提交且干净的 Git `HEAD` 生成：

```bash
git status --short
npm run package:server:production
```

产物位于 `output/deploy/`：

```text
hotel-butler-server-deployment-<12位commit>.tar.gz
hotel-butler-server-deployment-<12位commit>.tar.gz.sha256
```

部署包包含运行所需的私有配置与 TLS 文件，权限应保持为 `0600`。如果只需要不含运行时
凭证的源码包，使用 `npm run package:server:source`。

### 3. 上传部署包

准备权限为 `0600` 的 SSH 私钥后执行：

```bash
chmod 600 apps/server/rms-agent-key.pem
npm run upload:server:production -- <ssh-user>
```

上传脚本固定连接生产主机，校验本地与远端 SHA-256，并在校验成功后更新远端
`~/hotel-butler-upload/current-release`。首次连接前应通过云平台控制台核对 SSH 主机指纹。
该脚本不会自动解压、启动 Docker 或修改线上服务。

### 4. 准备生产主机

登录服务器后，根据 `current-release` 校验并解压部署包：

```bash
cd "$HOME/hotel-butler-upload"
DEPLOY_ARCHIVE="$(cat current-release)"
case "$DEPLOY_ARCHIVE" in
  hotel-butler-server-deployment-????????????.tar.gz) ;;
  *) echo "current-release 内容非法" >&2; exit 1 ;;
esac
sha256sum -c "${DEPLOY_ARCHIVE}.sha256"
sudo install -d -o "$USER" -g "$(id -gn)" -m 0750 /opt/hotel-butler
tar -xzf "$DEPLOY_ARCHIVE" -C /opt
sudo bash /opt/hotel-butler/app/apps/server/scripts/prepare-production-host.sh
```

主机准备脚本负责创建或验证部署文件所有者，并准备 PostgreSQL、TLS 和日志挂载目录；不会
启动服务。默认部署用户为禁止交互登录的 `hotelbutler`，且不会加入 `docker` 组。

### 5. 校验并启动

远端启动或更新生产服务属于高风险操作，执行前应确认目标环境、变更内容和影响范围：

```bash
cd /opt/hotel-butler/app
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml config --quiet
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml up --build --detach --wait
```

启动后检查服务状态：

```bash
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml ps
curl --cacert /opt/hotel-butler/tls/server/ca.pem \
  https://121.199.29.74:35443/api/trpc/system.health
```

常用运维命令：

```bash
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml logs --follow server
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml down --remove-orphans
```

生产部署和发布不得由 Agent 自动执行，必须在说明目标环境和影响范围后获得用户明确确认。
