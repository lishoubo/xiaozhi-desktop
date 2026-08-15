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

## 生产 server：离线镜像部署

生产 ECS 使用 Alibaba Cloud Linux 4 LTS。应用在 Mac 上构建为 Linux 镜像，随后通过 SSH
上传离线镜像包；ECS 不构建应用，也不访问 Docker Hub，并且不需要保存应用源码或
`node_modules`。

| 用途 | 地址 |
|---|---|
| Desktop API / Agent HTTPS | `https://121.199.29.74:35443` |
| PostgreSQL 宿主机端口 | `35432` |

生产 PostgreSQL 端口只应对可信源 IP 开放，不应暴露给公网。

### 1. 已确认的 ECS 运行环境

生产部署脚本固定面向以下已经核验的环境：

| 项目 | 生产值 |
|---|---|
| 系统 | Alibaba Cloud Linux 4 LTS（`ID=alinux`、`VERSION_ID=4`） |
| ECS CPU | `x86_64` |
| 容器平台 | `linux/amd64` |
| Docker Engine | `28.3.3` |
| Docker Compose | `2.26.1` |

本地打包脚本固定生成 `linux/amd64` 镜像，不接受平台覆盖参数。远端脚本会在修改服务前再次
校验系统主版本、CPU 架构和部署包平台。

### 2. 准备生产配置与证书

以下命令只在目标文件不存在时创建内容，不会覆盖已有私有配置：

```bash
npm run env:setup:production
npm run https:setup:production
chmod 600 apps/server/.env.production
```

补全 `apps/server/.env.production` 中的 RMS、AI 和初始管理员配置。生产证书位于
`output/production-tls/121.199.29.74/`。生产环境文件、server 私钥和最终离线部署包都包含
敏感材料，必须保持为 `0600`，不得提交或转发。

### 3. 在 Mac 构建离线镜像包

生产包只允许从已提交且干净的 Git `HEAD` 生成：

```bash
git status --short
```

首次部署、更换 ECS、升级 pgvector，或者 ECS 上的数据库镜像已被清理时，生成包含 server 和
pgvector 的全量包：

```bash
npm run package:server:production -- --include-database-image
```

后续只修改应用代码时，默认只打包新的 server 镜像：

```bash
npm run package:server:production
```

打包命令会完成以下工作：

1. 校验 `.env.production`、生产证书和私钥权限。
2. 使用 Docker Buildx 构建 `linux/amd64` 的 `hotel-butler-server:<commit>`。
3. 仅在全量模式下拉取并加入同架构的 `pgvector/pgvector:0.8.5-pg18`。
4. 打包镜像和最小运行文件；不包含 ECS 运行所需之外的仓库源码。
5. 更新 `output/deploy/current-image-release`，供上传脚本选择刚生成的包。

产物位于 `output/deploy/`：

```text
# 默认的后续更新包
hotel-butler-server-images-<12位commit>-linux-amd64.tar
hotel-butler-server-images-<12位commit>-linux-amd64.tar.sha256

# 包含 pgvector 的首次部署/数据库镜像更新包
hotel-butler-server-full-images-<12位commit>-linux-amd64.tar
hotel-butler-server-full-images-<12位commit>-linux-amd64.tar.sha256
```

### 4. 上传到 ECS

准备权限为 `0600` 的 SSH 私钥后执行：

```bash
chmod 600 apps/server/rms-agent-key.pem
npm run upload:server:production -- <ssh-user>
```

上传脚本固定连接生产主机，分别在本地和远端校验 SHA-256，并在成功后更新远端
`~/hotel-butler-image-upload/current-image-release`。首次连接前应通过阿里云控制台核对 SSH
主机指纹。上传脚本根据本地 `output/deploy/current-image-release` 上传最近一次生成的全量包或
server 更新包，不会解压部署包、运行 migration 或修改线上容器。

### 5. 在 ECS 导入、迁移并启动

下面的远端命令会修改生产容器并可能产生短暂停机。执行前确认目标主机、Git commit 和维护
窗口：

```bash
cd "$HOME/hotel-butler-image-upload"
IMAGE_ARCHIVE="$(cat current-image-release)"
case "$IMAGE_ARCHIVE" in
  hotel-butler-server-images-????????????-linux-amd64.tar | \
  hotel-butler-server-full-images-????????????-linux-amd64.tar) ;;
  *) echo "current-image-release 内容非法" >&2; exit 1 ;;
esac
sha256sum -c "${IMAGE_ARCHIVE}.sha256"
tar -xf "$IMAGE_ARCHIVE"
sudo bash hotel-butler-release/runtime/deploy-production-images.sh
```

远端脚本按以下顺序工作：

1. 校验 Alibaba Cloud Linux 4、CPU 架构、部署包和必要命令。
2. 如果旧 PostgreSQL 容器正在运行，在 `/opt/hotel-butler/backups/postgresql/` 创建
   migration 前的 custom-format `pg_dump`。
3. 安装 Compose、环境文件和 TLS 文件，然后通过 `docker load` 导入包内镜像。
4. 启动或复用 PostgreSQL，停止 server，单独运行 `database-init`。
5. migration 和幂等管理员初始化成功后，才使用新镜像启动 server；失败时 server 保持停止。

默认更新包只导入 server 镜像，并复用 ECS 已有的
`pgvector/pgvector:0.8.5-pg18`。部署脚本会在启动数据库和执行 migration 前检查该镜像及其
平台；若镜像不存在，会停止部署并提示重新生成、上传全量包。重新导入 pgvector 镜像不会
覆盖 PostgreSQL 数据，数据始终保存在 `POSTGRES_DATA_DIR` 对应的宿主机目录。

当前生产 ECS 已完成 `pgvector/pgvector:0.8.5-pg18` 的首次导入；只要没有执行镜像清理或
升级该版本，后续代码发布直接使用默认的 server 更新包即可。

如果已存在部署但数据库容器没有运行，脚本会拒绝在无备份情况下迁移。只有已经通过其他方式
完成备份时，才可显式跳过自动备份：

```bash
sudo HOTEL_BUTLER_ALLOW_MIGRATION_WITHOUT_BACKUP=1 \
  bash hotel-butler-release/runtime/deploy-production-images.sh
```

### 6. 数据库 migration 与后续更新

Drizzle migration 文件和 `initialize-database.ts` 已复制进生产镜像。每次发布新镜像时，远端
脚本都会先备份现有数据库，再运行新镜像中的 migration，因此后续不需要上传应用源码。
新增 migration 后只需提交代码、重新生成镜像包、上传并执行同一远端部署命令。

应用镜像回退不等于数据库回退。数据库 migration 应优先保持向后兼容；如果确实需要恢复
旧 schema，应停止写入并使用部署前的 dump 制定单独恢复方案，不要自动执行破坏性降级。

### 7. 验证与运维

```bash
cd /opt/hotel-butler/app
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml ps
curl --cacert /opt/hotel-butler/tls/server/ca.pem \
  https://121.199.29.74:35443/api/trpc/system.health
```

常用命令：

```bash
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml logs --follow server
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml down --remove-orphans
```

`npm run compose:prod:up` 现在同样使用 `--no-build --pull never`，只允许启动已经导入本机的
镜像，不会回退到 Docker Hub。

生产部署和发布不得由 Agent 自动执行，必须在说明目标环境和影响范围后获得用户明确确认。
