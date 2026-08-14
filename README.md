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

从示例创建私有生产配置，并替换所有必填占位值：

```bash
cp apps/server/.env.production.example apps/server/.env.production
```

先校验配置：

```bash
npm run compose:prod:config
```

构建服务端 Docker 镜像并启动生产栈：

```bash
npm run compose:prod:up
```

生产运维命令：

```bash
npm run compose:prod:logs
npm run compose:prod:down
```

`compose:prod:up` 会在本机构建服务端镜像，不依赖私有镜像仓库。生产模板当前不要求
`RMS_DATABASE_URL`；将来需要手机号身份查询时，只需在 `.env.production` 中增加只读地址：

```dotenv
RMS_DATABASE_URL=mysql://readonly-user:password@rms-host:3306/rms-database
```

无需更换服务端镜像或认证模式。

## 桌面端生产打包

### 必要构建变量

| 变量 | staff | phone | 用途 |
|---|---:|---:|---|
| `HOTEL_BUTLER_SERVER_URL` | 必需 | 必需 | Desktop API 与 Agent HTTPS 地址 |
| `XIAOZHI_RMS_SERVER_URL` | 必需 | 不需要 | staff 登录使用的 RMS HTTPS API |
| `HOTEL_BUTLER_PRIVATE_CA_PATH` | 私有 CA 部署时必需 | 私有 CA 部署时必需 | 打包进客户端的公开 CA 证书，文件名必须是 `private-ca.pem` |

CA 路径只能指向公开 CA 证书。不得把 CA 私钥或服务端私钥打进客户端。

### 生成可分发安装包

staff 版：

```bash
HOTEL_BUTLER_SERVER_URL=https://server.example.com \
XIAOZHI_RMS_SERVER_URL=https://rms.example.com \
HOTEL_BUTLER_PRIVATE_CA_PATH=/absolute/path/private-ca.pem \
npm run make:desktop:staff
```

phone 版：

```bash
HOTEL_BUTLER_SERVER_URL=https://server.example.com \
HOTEL_BUTLER_PRIVATE_CA_PATH=/absolute/path/private-ca.pem \
npm run make:desktop:phone
```

staff 版也提供平台快捷命令：

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
