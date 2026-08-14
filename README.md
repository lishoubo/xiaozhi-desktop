# 小智酒店管家

本仓库包含 Electron 桌面端、SvelteKit 服务端以及两端共享的 tRPC 契约：

| 目录 | 职责 |
|---|---|
| `apps/desktop/` | Electron 桌面应用 |
| `apps/server/` | Desktop API、Agent 服务和管理后台 |
| `packages/api/` | 两端共享的 tRPC contract、schema 和纯类型 |

## 环境要求

- Node.js 24
- npm 11
- Docker 与 Docker Compose
- 首次运行前安装依赖：`npm install`

本地 HTTPS 证书由 mkcert 管理。项目启动命令会自动执行证书检查，也可以手动执行：

```bash
npm run https:setup
```

首次执行可能需要完成一次系统授权。不要通过关闭 TLS 校验绕过证书安装。

## 本地开发

### 1. 启动服务端

推荐使用 Docker Compose 启动 PostgreSQL、RMS 开发库和 HTTPS 服务端：

```bash
npm run compose:dev:up
```

常用辅助命令：

```bash
npm run compose:dev:config  # 只校验配置
npm run compose:dev:logs    # 查看服务端日志
npm run compose:dev:down    # 停止本地环境
```

本地 Compose 从 `apps/server/.env` 读取配置，但只把服务端需要的变量显式注入容器，
不会把 PostgreSQL/MySQL 管理变量整体传给 server。

如果不使用 Compose，也可以直接启动服务端：

```bash
npm run dev:server
```

直启模式使用 `apps/server/.env` 中的宿主机连接地址；此时需要自行保证 PostgreSQL 等依赖
已经启动。

### 2. 启动桌面端

账号密码版：

```bash
npm run dev:desktop:staff
```

手机号版：

```bash
npm run dev:desktop:phone
```

`npm run dev:desktop` 是 staff 版的默认别名。

桌面 Profile 是构建期选择：staff 包只装配账号密码认证，phone 包只装配手机号认证。
服务端不区分 Profile，同一个服务端实例始终注册两套认证接口。

## 服务端认证与 RMS 配置

服务端始终支持：

- staff 客户端通过 RMS HTTPS API 校验 Bearer 身份；
- phone 客户端通过服务端 OTP、session 和 RMS employee identity source 登录。

`RMS_DATABASE_URL` 是可选能力配置：

- 未配置：服务端正常启动，不创建 RMS MySQL 连接池；手机号接口仍存在，但身份查询会返回
  明确的服务不可用提示。
- 已配置：服务端创建一个 RMS MySQL 连接池，并同时服务 staff 与 phone 客户端。

本地 `.env` 中的两组地址用途不同，不应合并：

| 宿主机直启 | Docker Compose | 用途 |
|---|---|---|
| `DATABASE_URL` | `COMPOSE_DATABASE_URL` | PostgreSQL |
| `RMS_DATABASE_URL` | `COMPOSE_RMS_DATABASE_URL` | 可选 RMS MySQL 身份源 |

## 生产服务端

生产环境固定使用：

| 用途 | 地址 |
|---|---|
| Desktop API / Agent HTTPS | `https://121.199.29.74:35443` |
| PostgreSQL 宿主机端口 | `35432` |

PostgreSQL 会映射到宿主机 `0.0.0.0:35432`，便于后续使用 GUI 工具连接。生产机防火墙和
云安全组必须将该端口限制为可信源 IP，不应对全网开放。

### 1. 本地准备生产配置与证书

仅在 `apps/server/.env.production` 不存在时生成一份私有生产配置：

```bash
npm run env:setup:production
```

该命令会生成 PostgreSQL 密码并写入已忽略的 `.env.production`，文件权限为 `0600`。
已存在时会拒绝覆盖。随后填入 RMS HTTPS、Kimi / DMS 和初始管理员的真实配置，
并保持权限：

```bash
chmod 600 apps/server/.env.production
```

仅在 `output/production-tls/121.199.29.74/` 不存在时生成生产私有 CA 和 IP 证书：

```bash
npm run https:setup:production
```

该命令固定为 `121.199.29.74` 签发 IP SAN 证书，并分离输出服务端 TLS 文件与
desktop 只读 CA。已存在时同样会拒绝覆盖。`ca-key.pem` 和 `server/key.pem`
都是私密材料，不得提交或外传。

### 2. 生成单次上传的生产部署包

生产部署包只允许从已提交且干净的 Git `HEAD` 生成。先提交需要上线的修改，然后执行：

```bash
git status --short
npm run package:server:production
```

产物位于 `output/deploy/`：

```text
hotel-butler-server-deployment-<12位commit>.tar.gz
hotel-butler-server-deployment-<12位commit>.tar.gz.sha256
```

该敏感部署包包含服务端构建源码、`apps/server/.env.production` 以及
`tls/server/{cert.pem,key.pem,ca.pem}`。脚本会检查占位值、私有文件权限、证书有效期、
证书链、私钥匹配和 `121.199.29.74` IP SAN，并确保不包含 CA 签名私钥、SSH 私钥、
desktop 源码、依赖缓存或构建产物。包文件权限为 `0600`，不得提交 Git、发到群聊或
当作普通日志附件。

如果只需要不带运行时凭证的普通源码包，使用：

```bash
npm run package:server:source
```

### 3. 上传生产部署包

确保 `apps/server/rms-agent-key.pem` 是可用的 SSH 私钥且权限为 `0600`，然后传入服务器
SSH 用户名：

```bash
chmod 600 apps/server/rms-agent-key.pem
npm run upload:server:production -- <ssh-user>
```

上传脚本固定连接 `121.199.29.74`，固定使用被 Git 忽略的
`apps/server/rms-agent-key.pem`，并只选择与当前 `HEAD` 对应的部署包。执行顺序是：

1. 检查私钥权限、部署包及本地 SHA-256；
2. 通过 SSH 创建远端 `~/hotel-butler-upload/`（权限 `0700`）；
3. 通过 SCP 上传到唯一的 `.incoming-*` 临时目录；
4. 在临时目录再次校验 SHA-256，成功后覆盖正式目录中的同名压缩包和 checksum。

首次连接时 OpenSSH 会显示服务器主机指纹，应先与云平台控制台提供的指纹核对后再接受。
网络中断或 checksum 失败不会覆盖正式文件。脚本不会使用 `StrictHostKeyChecking=no`，
也不会自动解压、运行 Docker 或修改线上服务。
远端已有同名文件时，只会在新包的 SHA-256 验证成功后覆盖。成功后
`~/hotel-butler-upload/current-release` 指向本次已验证的压缩包。

### 4. 服务器首次准备、校验与解压

服务器需要安装 Docker Engine 和 Docker Compose v2 插件。不需要安装 Docker Hub，也不需要
自建镜像仓库；Compose 会使用压缩包中的源码直接在服务器构建镜像。

上传成功后，在服务器执行下面整段命令。它根据 `current-release` 选择压缩包，
再次校验 SHA-256，解压到 `/opt/hotel-butler/`，并创建 PostgreSQL、TLS 和日志挂载目录：

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

如果当前是 root，主机准备脚本会在首次执行时自动创建不允许交互登录的
`hotelbutler` 本地部署用户（默认 UID `2000`），用于持有应用、生产配置和 TLS 文件；
脚本还会将解压后的应用目录递归设置为该用户所有。

如果服务器已经存在同名 `hotelbutler` 用户，脚本不会重复创建：UID 为 `2000` 且
shell 为 `/usr/sbin/nologin`、`/sbin/nologin` 或 `/bin/false` 时直接复用；如果同名用户的
UID 或 shell 不符合这些安全条件，脚本会在改变目录所有权之前失败，不会修改该账号。
此时应显式选择另一个用户名和未占用的 UID：

```bash
sudo HOTEL_BUTLER_DEPLOY_USER=hotelbutler_app HOTEL_BUTLER_DEPLOY_UID=2001 \
  bash /opt/hotel-butler/app/apps/server/scripts/prepare-production-host.sh
```

自动创建的部署 UID 必须与 PostgreSQL `999` 和 server `1000` 容器运行 UID 分离。
非 root 用户通过 `sudo` 执行时，默认使用 `SUDO_USER` 作为所有者。如需指定另一个
已有或待创建的本地用户，可传入 `HOTEL_BUTLER_DEPLOY_USER=<name>`。
`hotelbutler` 只承担文件所有权，不加入 `docker` 组，也不用它执行部署命令。后续
Docker Compose 仍由 root 执行；如果当前就是 root，直接执行下文的 `docker compose`
命令，不需要再加 `sudo`。

重复部署时可以复用同一段命令。解压和目录准备都不会启动服务。

### 5. 构建镜像并启动生产服务

确认 `/opt/hotel-butler/app/apps/server/.env.production` 和 TLS 文件无误后，执行：

```bash
cd /opt/hotel-butler/app
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml config --quiet
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml up --build --detach --wait
```

`up --build` 会在服务器本机构建 `hotel-butler-server` 镜像，然后启动 PostgreSQL、一次性
数据库初始化容器和 HTTPS server。配置校验失败时不应继续执行 `up`。

启动后检查：

```bash
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml ps
curl --cacert /opt/hotel-butler/tls/server/ca.pem \
  https://121.199.29.74:35443/api/trpc/system.health
```

常用运维命令（在 `/opt/hotel-butler/app` 下执行）：

```bash
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml logs --follow server
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml down --remove-orphans
```

生产模板当前不要求 `RMS_DATABASE_URL`。将来需要手机号身份查询时，可在
`.env.production` 中增加 RMS MySQL 只读连接字符串，无需更换服务端镜像或认证模式。

### 6. 生产目录与关键文件

| 路径 | 内容 | 安全属性 |
|---|---|---|
| `/opt/hotel-butler/app/` | Compose 与 server 构建源码 | 部署用户可读写 |
| `/opt/hotel-butler/app/apps/server/.env.production` | 数据库、RMS、AI 和管理员配置 | **敏感，`0600`** |
| `/opt/hotel-butler/tls/server/cert.pem` | `121.199.29.74` 服务证书 | 可公开 |
| `/opt/hotel-butler/tls/server/ca.pem` | 桌面端信任的公开 CA | 可公开 |
| `/opt/hotel-butler/tls/server/key.pem` | HTTPS 服务私钥 | **敏感，仅部署用户/容器可读** |
| `/var/lib/hotel-butler/postgresql/` | PostgreSQL 持久数据 | **敏感，不作普通文件复制** |
| `/var/log/hotel-butler/server/server.jsonl` | Pino 结构化服务日志 | 已脱敏，外发前仍需复核 |

服务日志同时保留在 Docker stdout，可实时查看：

```bash
npm run compose:prod:logs
# 或
docker compose --env-file apps/server/.env.production \
  -f apps/server/compose.production.yaml logs --follow server
```

Docker 的 stdout 日志使用 `local` 驱动，单文件 20 MiB、最多 5 个文件。主机准备脚本
会在已安装 `logrotate` 时创建 `/etc/logrotate.d/hotel-butler-server`：`server.jsonl` 每日
或达到 50 MiB 时轮转，保留 14 份并压缩；未安装时脚本会明确告警，应改由日志采集代理
负责轮转。RMS `/api/v1/me` 调用会记录 request ID、操作名、目标 origin/path、HTTP 状态、
结果分类和耗时，不记录 Bearer、响应正文或员工身份。

## 桌面端生产打包

### 固定生产环境打包（推荐）

生产 staff 版使用专用入口：

```bash
XIAOZHI_RMS_SERVER_URL="$(node --env-file=apps/server/.env.production \
  -p 'process.env.XIAOZHI_RMS_SERVER_URL')" \
  npm run package:desktop:production
```

该命令会：

- 固定将 Desktop API / Agent 地址编译为 `https://121.199.29.74:35443`；
- 校验服务证书对 `121.199.29.74` 有效、证书链和私钥匹配；
- 只将 `output/production-tls/121.199.29.74/desktop/private-ca.pem` 作为公开 CA 打入客户端；
- 生成 staff Profile 的未封装应用目录 `apps/desktop/out/staff/`。

`XIAOZHI_RMS_SERVER_URL` 是 staff 登录服务的构建期地址，必须显式传入真实 HTTPS origin；
双击启动的安装包不会再读取 shell 环境变量。

### 必要构建变量

| 变量 | staff | phone | 用途 |
|---|---:|---:|---|
| `HOTEL_BUTLER_SERVER_URL` | 必需 | 必需 | Desktop API 与 Agent HTTPS 地址 |
| `XIAOZHI_RMS_SERVER_URL` | 必需 | 不需要 | staff 登录使用的 RMS HTTPS API |
| `HOTEL_BUTLER_PRIVATE_CA_PATH` | 私有 CA 部署时必需 | 私有 CA 部署时必需 | 打包进客户端的公开 CA 证书，文件名必须是 `private-ca.pem` |

CA 路径只能指向公开 CA 证书。不得把 CA 私钥或服务端私钥打进客户端。

### 生成可分发安装包

`package:desktop:production` 只生成未封装应用。需要 DMG / ZIP / Windows 安装产物时，
使用下面的 `make` 入口，并显式传入同一套生产参数。

staff 版：

```bash
HOTEL_BUTLER_SERVER_URL=https://121.199.29.74:35443 \
XIAOZHI_RMS_SERVER_URL="$(node --env-file=apps/server/.env.production \
  -p 'process.env.XIAOZHI_RMS_SERVER_URL')" \
HOTEL_BUTLER_PRIVATE_CA_PATH="$PWD/output/production-tls/121.199.29.74/desktop/private-ca.pem" \
npm run make:desktop:staff
```

phone 版：

```bash
HOTEL_BUTLER_SERVER_URL=https://121.199.29.74:35443 \
HOTEL_BUTLER_PRIVATE_CA_PATH="$PWD/output/production-tls/121.199.29.74/desktop/private-ca.pem" \
npm run make:desktop:phone
```

staff 版也提供平台快捷命令。执行前仍须先导出上表中的三个生产构建变量：

```bash
npm run make:desktop:mac:intel
npm run make:desktop:mac:arm64
npm run make:desktop:win64
```

phone 版可把 Electron Forge 平台参数继续传给 Profile runner：

```bash
npm run make:desktop:phone -- --platform=darwin --arch=arm64
npm run make:desktop:phone -- --platform=win32 --arch=x64
```

### 只生成未封装应用

如果只需要检查打包后的应用目录，不需要安装器：

```bash
npm run package:desktop:staff
npm run package:desktop:phone
```

产物按 Profile 隔离：

```text
apps/desktop/out/staff/
apps/desktop/out/phone/
```

phone 产物使用独立标识：

```text
Executable: hotel-butler-phone
Bundle ID:  com.hotelbutler.desktop.phone
```

### 桌面端生产日志与本地数据

桌面主进程使用 Electron 官方的应用日志目录，并按构建 Profile 再隔离一层。当前日志
为 `main.log`；打包版记录 `info` 及以上，达到 10 MiB 后轮转为 `main.old.log`。staff 与
phone 不会写入同一个日志文件。

| 系统 | 生产日志目录 |
|---|---|
| macOS | `~/Library/Logs/小智酒店管家/{staff\|phone}/` |
| Windows | `%APPDATA%\小智酒店管家\logs\{staff\|phone}\` |
| Linux | `${XDG_CONFIG_HOME:-$HOME/.config}/小智酒店管家/logs/{staff\|phone}/` |

这是 Electron 的 per-user 目录，不需要管理员权限，也不应写到安装目录。程序启动日志会
同时记录解析后的 `logFilePath`，便于现场确认实际位置。

桌面业务数据位于 Electron `userData` 目录：

| 系统 | `userData` 根目录 |
|---|---|
| macOS | `~/Library/Application Support/小智酒店管家/` |
| Windows | `%APPDATA%\小智酒店管家\` |
| Linux | `${XDG_CONFIG_HOME:-$HOME/.config}/小智酒店管家/` |

关键文件包括 `hotel-butler.sqlite`、加密的 `staff-auth.json`、
`cookie-imports/`、`pending-partitions.json` 以及 Chromium session/partition 数据。它们
可能包含业务数据、登录态或 Cookie，不能当作普通排错附件上传。`main.log` 已经过统一
脱敏，但提交给第三方前仍应人工检查。

桌面端直接访问 RMS 的登录、刷新、退出、身份与业务接口也统一记录
`rms.http.request.started/completed/failed`，包括请求 ID、尝试次数、操作、HTTP 状态和
耗时；URL 查询参数、请求体、用户名、密码、Token 和响应正文不会写入日志。

## 验证

日常定向检查：

```bash
npm run check:desktop
npm run check:server
npm run check:api
```

交付前完整门禁：

```bash
npm run verify
```

完整门禁包含类型检查、Svelte 检查、lint、单元测试和 E2E。
