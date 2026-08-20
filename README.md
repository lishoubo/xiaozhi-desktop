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

server 还会通过 `XIAOZHI_RMS_SERVER_URL` 访问 RMS API。该地址与 RMS MySQL 连接
用途不同，不应混用。生产 desktop 的 staff 登录也会在构建期读取
`apps/server/.env.production` 中的同一个地址，避免 server 与 desktop 指向不同 RMS。生产门禁
默认要求 HTTPS 且不得携带 URL 凭证；当前 RMS 只能提供 HTTP 时，必须为每次生产构建显式设置
`XIAOZHI_ALLOW_INSECURE_RMS=1`，不得把该开关写入环境文件长期放宽门禁。

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
敏感材料，必须保持为 `0600`，不得提交或转发。`XIAOZHI_RMS_SERVER_URL` 必须是生产 server
和 staff desktop 均可访问的 origin，且不得在 URL 中携带用户名或密码。HTTPS 是默认要求；若
当前 RMS 只能使用 HTTP，按下述命令逐次显式确认风险。

### 3. 在 Mac 构建离线镜像包

生产包只允许从已提交且干净的 Git `HEAD` 生成：

```bash
git status --short
```

首次部署、更换 ECS、升级 pgvector，或者 ECS 上的数据库镜像已被清理时，生成包含 server 和
pgvector 的全量包：

```bash
XIAOZHI_ALLOW_INSECURE_RMS=1 npm run package:server:production -- --include-database-image
```

后续只修改应用代码时，默认只打包新的 server 镜像：

```bash
XIAOZHI_ALLOW_INSECURE_RMS=1 npm run package:server:production
```

上面的显式开关仅因当前 RMS 接口为 HTTP 而需要。它不会关闭 desktop 到 Hotel Butler server
的私有 HTTPS，也不会关闭 server 证书检查；但 staff JWT/Bearer 凭证在 RMS HTTP 链路上没有
传输加密，经过不可信网络时存在窃听、篡改和重放风险。建议让 ECS、使用 staff 包的终端与 RMS
处于同一可信私网或 VPN，配合 IP 白名单并缩短令牌有效期；后续为 RMS 增加 HTTPS 入口后立即
去掉该开关。

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
   migration 前的 custom-format `pg_dump`；备份命令使用 `.env.production` 配置的
   `POSTGRES_PORT`，当前为 `35432`。
3. 安装 Compose、环境文件和 TLS 文件，然后通过 `docker load` 导入包内镜像。
4. 启动或复用 PostgreSQL，停止 server，单独运行 `database-init`。
5. migration 和幂等管理员初始化成功后，才使用新镜像启动 server；失败时 server 保持停止。

数据库和 server 的 Compose 健康等待均有 360 秒总超时。server 未能按时进入 `healthy` 时，
部署脚本会自动打印 Compose 状态及最后 120 行 server 日志并以非零状态退出，不会无限停在
`Recreated`。

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
  --resolve 121.199.29.74:35443:127.0.0.1 \
  https://121.199.29.74:35443/api/trpc/system.health
```

`docker compose ps` 中 `db` 和 `server` 都应为 `healthy`。还可以直接执行镜像内同一份 server
健康检查，命令必须快速返回 `exit=0`：

```bash
docker exec hotel-butler-production-server-1 \
  node apps/server/tests/compose/server-healthcheck.mjs
echo "exit=$?"
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

### 8. 生产日志目录

#### Server

Server 同时把结构化日志写到标准输出和 JSON Lines 文件。宿主机文件位置为：

```text
${SERVER_LOG_DIR}/server.jsonl
```

生产环境默认配置对应：

```text
/var/log/hotel-butler/server/server.jsonl
```

Compose 将 `SERVER_LOG_DIR` 挂载到容器内 `/var/log/hotel-butler`，因此容器内文件是
`/var/log/hotel-butler/server.jsonl`。在 ECS 上可以使用：

```bash
sudo tail -f /var/log/hotel-butler/server/server.jsonl
cd /opt/hotel-butler/app
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml logs --follow server
```

`prepare-production-host.sh` 会在宿主机安装了 logrotate 时配置日志按天或达到 50 MB 轮转，
保留 14 份并压缩；未安装 logrotate 时会打印警告，需要另行配置轮转。

#### Desktop

Desktop 主进程日志按认证 Profile 隔离，文件结构为：

```text
<Electron 系统日志目录>/<staff|phone>/main.log
```

常见平台路径：

| 平台 | 生产日志路径 |
|---|---|
| macOS | `~/Library/Logs/小智酒店管家/<staff\|phone>/main.log` |
| Windows | `%APPDATA%/小智酒店管家/logs/<staff\|phone>/main.log` |
| Linux | `~/.config/小智酒店管家/logs/<staff\|phone>/main.log` |

Linux 设置了 `XDG_CONFIG_HOME` 时，以该目录替代默认的 `~/.config`。

macOS 上可直接查找当前安装包实际使用的路径：

```bash
find "$HOME/Library/Logs" -type f \( -path "*/staff/main.log" -o -path "*/phone/main.log" \)
```

生产包的文件日志级别为 `info`，单文件上限为 10 MB，并在写盘前执行敏感信息脱敏。启动日志
中的 `Application logging initialized` 事件也会记录最终解析出的 `logFilePath`。

## 生产 desktop：构建与交付

生产 desktop 默认构建 staff 认证版本，也支持显式构建 phone 版本；两者都从同一套生产事实
来源注入：

| 构建输入 | 生产值来源 |
|---|---|
| Backend API | 固定为 `https://121.199.29.74:35443` |
| RMS API | `apps/server/.env.production` 的 `XIAOZHI_RMS_SERVER_URL` |
| Backend 私有 CA | `output/production-tls/121.199.29.74/desktop/private-ca.pem` |
| 认证 Profile | 默认 `staff`，phone 快捷命令显式选择 `phone` |

生产脚本会默认确认 RMS 使用 HTTPS；当前 HTTP RMS 需要显式不安全开关。脚本还会确认生产
证书对 `121.199.29.74` 有效、server 证书与私钥匹配、desktop CA 与 server CA 完全一致，
而且 desktop 资源中不包含 CA 私钥。

### 1. 生产输入预检

先确保生产 server 已部署并通过健康检查，再在 Mac 执行：

```bash
npm run check:desktop:production
```

该命令只校验并显示 backend、RMS 和 CA 路径，不构建应用。任何 placeholder、证书过期、
证书不匹配或环境文件权限过宽都会直接失败。

RMS 目前是明文 HTTP（正式域名尚未启用 HTTPS），**脚本自行放行、不需要再手敲
`XIAOZHI_ALLOW_INSECURE_RMS=1`**，但每次都会打印凭证明文传输的 WARNING——豁免自动
生效，可见性由告警保证，与 `scripts/desktop-make.mjs` 的做法一致。RMS 上 HTTPS 后
校验自动恢复强制，告警随之消失。

### 2. 生成可运行应用目录

用于本机安装前检查，不是最终分发安装包：

```bash
npm run package:desktop:production
```

产物位于 `apps/desktop/out/` 下对应平台和架构的应用目录。

### 3. 生成分发产物

使用当前 Mac 架构生成 Electron Forge 分发产物：

```bash
npm run make:desktop:production
```

如需明确构建 macOS 架构：

```bash
npm run make:desktop:production -- --platform=darwin --arch=arm64
npm run make:desktop:production -- --platform=darwin --arch=x64
```

分发产物位于 `apps/desktop/out/make/`。macOS 产物会在 Forge 打包后按正确的 bundle ID 自动
执行 ad-hoc 重签名，以保证 Keychain、`safeStorage` 和登录态正常，无需手工运行 `codesign`。
当前仍未配置 Apple Developer ID 签名、Apple notarization 或 Windows 代码签名，因此产物只
适合内部测试和交付；若面向普通终端用户公开分发，正式签名与 notarization 是独立的上线门禁。

### 4. 生成 phone 登录的生产桌面包

Phone 生产入口复用上述生产地址、私有 CA、环境文件权限和 RMS 安全检查，不需要手工拼接
`HOTEL_BUTLER_SERVER_URL` 等构建变量。先执行只读预检：

```bash
npm run check:desktop:production:phone
```

生成本机可运行应用目录：

```bash
npm run package:desktop:production:phone
```

生成当前 Mac 架构的分发产物：

```bash
npm run make:desktop:production:phone
```

如需指定 macOS 架构：

```bash
npm run make:desktop:production:phone -- --platform=darwin --arch=arm64
npm run make:desktop:production:phone -- --platform=darwin --arch=x64
```

产物仍位于 `apps/desktop/out/make/`，Forge 使用 phone build identifier、独立 bundle ID 和
executable name 与 staff 产物隔离。生产 server 的 `RMS_DATABASE_URL` 必须有效，否则 phone
登录页可以启动，但服务端无法查询手机号对应的 RMS 员工身份。该入口只构建本地产物，不会
上传、发布或部署。若生产 RMS 仍为 HTTP，上述 phone 命令与 staff 命令一样必须在命令前
显式添加 `XIAOZHI_ALLOW_INSECURE_RMS=1`，并接受构建时输出的明文传输警告。

普通的 `package:desktop:staff`、`package:desktop:phone`、`make:desktop:staff` 和
`make:desktop:phone` 默认注入本地 backend/RMS，仅用于开发或显式定制构建，不得作为生产
包发布。兼容入口 `scripts/desktop-make-prod.sh` 现在也统一转发到
`make:desktop:production`。

## 最终上线顺序

1. 确认 Git worktree 干净且所有上线代码已提交。
2. 确认 `apps/server/.env.production` 权限为 `0600` 且所有 placeholder 已替换；RMS 优先使用
   HTTPS，当前 HTTP 例外需在 server 与 desktop 构建命令前显式设置不安全开关。
3. 默认生成并上传 server-only 镜像包；仅首次部署或 pgvector 缺失时使用全量包。
4. 在 ECS 执行部署脚本，确认备份、migration、管理员初始化及 server 健康检查全部成功。
5. 从 ECS 使用私有 CA 请求健康接口，确认 HTTP `200`，并确认两个 Compose 服务均为
   `healthy`。
6. 使用与 server 构建相同的 RMS 安全开关执行 `check:desktop:production`，再执行
   `make:desktop:production`。
7. 在目标 Mac 上启动最终产物，验证 staff 登录、Agent 对话、7 日经营快捷入口和退出重启。
8. 若面向外部用户分发，在交付前完成对应平台的代码签名与 notarization。

生产部署和发布不得由 Agent 自动执行，必须在说明目标环境和影响范围后获得用户明确确认。
