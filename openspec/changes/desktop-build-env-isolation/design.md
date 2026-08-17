## Context

动机见 `proposal.md - Why`；行为契约见 `specs/`。这里只记录塑造实现路径的现状约束。

**已有的可复用模式**：仓库里已经有两个构建期注入插件，形状一致且被真机验证过：

```
vite-plugins/auth-variant.ts   XIAOZHI_AUTH_VARIANT  → __AUTH_VARIANT__   挂 3 处构建
vite-plugins/rms-origin.ts     XIAOZHI_RMS_SERVER_URL → __RMS_ORIGIN__     挂 1 处（仅 main）
```

两者都做对了同一件事：白名单校验、非法值抛错不静默回退、类型声明收口在
`forge.env.d.ts`。`rms-origin.ts:1-14` 的注释已写明为何不在运行时读 env。**本次不发明
新机制，只增加第三个同形状插件。**

**现状断点**（均已核实）：

| 断点 | 位置 | 现状 |
|---|---|---|
| 应用标识无环境维度 | `package.json:3`、`forge.config.ts:18-20` | `productName` 硬编码；无 `appBundleId`；`MakerSquirrel({})` 空配置 |
| `environment` 参数是死的 | `ipc/ota-tab-handlers.ts:84` 等 5 处 | 契约贯穿 shared→IPC→renderer，但全部硬编码 `'prod'` |
| 构建脚本不跨平台 | `scripts/*.sh` × 4 | 全是 `#!/bin/sh`，Windows 跑不了；环境注入只存在于 `desktop-make-prod.sh:18` |
| 悬空常量引用 | `browser/partition.ts:21` | 注释引用的 `STORAGE_VERSIONS.partitionLayout` 全仓不存在 |
| 死数据 | `<userData>/pending-partitions.json` | 源码零引用，已被 `partitions.json` 账本取代 |
| 另一条链路运行时读 env | `server-client/config.ts:4` | 打包后静默兜底 `https://localhost:5173`，正是 `rms-origin.ts` 批判的反模式 |

**跨平台现状**：核心存储天然跨平台，不需要改。`app.getPath` / `safeStorage`
（macOS Keychain ↔ Windows DPAPI）/ better-sqlite3（`packageAfterCopy` 已处理原生模块）
全部由 Electron 自行解析。`cookie-import/browser-cookie-importer.ts` 已完整支持
win32/darwin/linux，是仓库里跨平台做得最好的模块。

## Goals / Non-Goals

**Goals:**

- 一个构建期变量驱动全部环境差异，新增环境时只改一处取值表
- 跨平台路径零手写分支——平台差异全部交给 `app.getPath`
- 环境注入进入 npm script 主干，而非只存在于某个 shell 脚本里

**Non-Goals:**

- 代码签名与公证、auto-update（见 `proposal.md` 非目标）
- `server-client/config.ts` 的 phone 变体链路改造：本次只标注它与 RMS 链路的原则冲突，
  不顺手改——它服务另一个尚未启用的登录变体，改动应随该变体上线一起做
- 存量数据迁移（已拍板丢弃）

## Decisions

### D1：环境标识用构建期 `define` 注入，不用运行时 env

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **构建期 `define`** | 打包产物自带环境，双击启动不依赖父进程环境；字面量可被 DCE 折叠 | 换环境要重新构建 | **采用**，与既有两个插件一致 |
| 运行时读 `process.env` | 一个包切多环境 | 双击启动读不到，静默兜底成错误配置 | 否决，`rms-origin.ts:1-14` 已论证 |
| 打包内配置文件 | 可后期改 | 用户可篡改指向；与 asar 完整性校验冲突 | 否决 |

新增 `vite-plugins/app-env.ts`，形状复刻 `auth-variant.ts`：

```ts
const ENVIRONMENTS = ['dev', 'pre', 'online'] as const;
export type AppEnvironment = (typeof ENVIRONMENTS)[number];
const DEFAULT_ENVIRONMENT: AppEnvironment = 'dev';

/** 非法值抛错，不回退——静默回退会打出「看起来正常、却连错后端」的包。 */
export function resolveAppEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment;

/** 三处构建共用，确保 main / preload / renderer 拿到同一个值。 */
export function appEnvDefine(): Plugin;   // → define: { __APP_ENV__: ... }
```

默认值取 `dev` 而非 `online`：误打出连本机的开发包，风险远低于误打出连生产的包。

### D2：环境差异集中成一张表，不散在各处 `if`

```ts
// vite-plugins/app-env.ts —— 新增环境只改这张表
type EnvironmentProfile = Readonly<{
  productName: string;      // 展示名 & 各平台目录名的来源
  bundleId: string;         // macOS CFBundleIdentifier
  rmsOrigin: string;        // 该环境默认 RMS 地址
}>;

const PROFILES: Record<AppEnvironment, EnvironmentProfile> = {
  dev:    { productName: '小智酒店管家[开发]', bundleId: 'com.xiaozhi.hotel.dev',  rmsOrigin: 'http://localhost:8080' },
  pre:    { productName: '小智酒店管家[预发]', bundleId: 'com.xiaozhi.hotel.pre',  rmsOrigin: 'http://47.96.144.176' },
  online: { productName: '小智酒店管家',       bundleId: 'com.xiaozhi.hotel',      rmsOrigin: '<待定，须 HTTPS>' },
};
```

`XIAOZHI_RMS_SERVER_URL` 保留为**覆盖**能力（便于临时指向任意后端），未设置时取
profile 默认值。HTTPS 强制校验逻辑不变，继续复用 `rms-origin.ts` 现有实现。

⚠️ online 的正式域名尚未确定。落地时若仍未定，`online` 档 MUST 保持构建失败而非填
占位地址——打出连着错误后端的正式包，比构建失败危险得多。

### D3：只改应用标识，不碰存储路径代码

这是本设计的核心。`productName` 一变，各平台目录**全部自动隔离**：

```
XIAOZHI_APP_ENV=pre
      │
      ├─→ forge packagerConfig.name / appBundleId
      ├─→ MakerSquirrel.name           (Windows 安装目录 + 注册表卸载项)
      └─→ app.getName()
              │
              ├─ macOS   ~/Library/Application Support/小智酒店管家[预发]/
              │          ~/Library/Logs/小智酒店管家[预发]/
              ├─ Windows %APPDATA%\小智酒店管家[预发]\
              │          %APPDATA%\小智酒店管家[预发]\logs\
              └─ Linux   ~/.config/小智酒店管家[预发]/
```

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **改应用标识，路径交给 Electron** | 零平台分支；安装、数据、日志、注册表一并隔离 | 无 | **采用** |
| `app.setPath('userData', ...)` 手动指定 | 包名可保持一致 | 必须手写三平台路径分支；日志目录另需单独处理；与 D3 的跨平台目标直接冲突 | 否决 |

`composition/app-scope.ts:77` 的 `app.getPath('userData')` **一行不改**。

**Windows 特有**：Squirrel 用 app name 决定 `%LOCALAPPDATA%\<name>` 与注册表项，
`MakerSquirrel({})` 必须补 `name`，否则三环境在 Windows 上互相覆盖（比 macOS 更严重——
macOS 至少还能靠 bundleId 区分）。Squirrel 的 `name` 不接受部分非 ASCII 字符，故与
展示名分开：`setupExe`/展示名用中文，Squirrel `name` 用 ASCII slug。

```
productName  小智酒店管家[预发]      ← 展示名、目录名
squirrel.name xiaozhi-hotel-pre     ← Windows 内部标识（ASCII）
```

### D4：`environment` 参数从调用方传入改为构建期读取

现状是「契约里有、调用点全写死 `'prod'`」——把 5 个字面量逐个换成三值枚举只会把问题
从「写死一个值」变成「五个地方各自决定环境」。

**做法**：`toPartitionName` 不再从参数接收 environment，改为在 `browser/partition.ts`
内部读 `__APP_ENV__`；`startLoginInputSchema` 移除 `environment` 字段，IPC 与 renderer
三处调用点随之删掉该实参。

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **从契约移除，内部读构建期常量** | 环境只有一个来源，renderer 无从传错 | 改动触及 shared 契约与 renderer | **采用** |
| 保留参数，各调用点传真实值 | 改动小 | 五处各自决定环境，迟早不一致 | 否决 |

⚠️ **partition 名称一旦发布就固化在用户磁盘上**（`partition.ts:26` 已有此警告）。本次
`<environment>` 段取值变化会让旧 `prod` partition 全部变成孤儿——但存量已决定丢弃，
且 `cleanupOrphanPartitions` 会在启动时回收它们，无需额外迁移代码。

### D5：构建脚本迁到 Node，环境注入进 npm script

Windows 上 `#!/bin/sh` 不可执行，而环境注入目前只存在于 `desktop-make-prod.sh:18`。

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Node 脚本 + npm script 显式传环境** | 跨平台；环境在 script 名里可见 | 需重写 4 个脚本 | **采用** |
| `cross-env` 仅包一层 | 改动最小 | `desktop-clean.sh` 的路径计算逻辑仍需 Node 重写 | 部分采用（见下） |
| 保留 sh，Windows 上要求 Git Bash | 零改动 | 把环境依赖转嫁给每台开发机 | 否决 |

```
scripts/desktop-clean.mjs        算 userData + 日志目录并清理（现有 sh 里已内嵌 node -e，直接扶正）
scripts/desktop-make.mjs         读 XIAOZHI_APP_ENV，转发 forge make

package.json scripts:
  dev            XIAOZHI_APP_ENV=dev   forge start        ← 经 cross-env
  make:pre       XIAOZHI_APP_ENV=pre   node scripts/desktop-make.mjs
  make:online    XIAOZHI_APP_ENV=online node scripts/desktop-make.mjs
```

`desktop-make-prod.sh` 名为 prod 实为 pre（烧的是明文 HTTP 裸 IP 并自动豁免），拆成
`make:pre` 与 `make:online` 两个入口后删除。

**清理脚本必须补日志目录**：macOS 下日志在 `~/Library/Logs/` 而非 `userData` 内，现有
`desktop-clean.sh` 完全覆盖不到（已积 17MB）；Windows 下日志在 `userData` 内，无需
额外处理——这个差异由 `app.getPath('logs')` 的语义决定，脚本里按平台各算一次。

### D6：顺带清理项

| 项 | 处置 |
|---|---|
| `pending-partitions.json` | 源码零引用（唯一命中是过期的 `.e2e/build/main.js` 构建产物）。删磁盘遗留文件 + 重建 e2e 产物 |
| `STORAGE_VERSIONS.partitionLayout` 悬空引用 | `partition.ts:21` 注释指向不存在的常量。就地改为引用同文件的 `PARTITION_LAYOUT_VERSION`，不新建常量表 |
| e2e 无独立 userData | 会写进开发环境真实库。e2e 启动时指定独立 `userData`，与本次环境隔离同源 |

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| online 正式 RMS 域名未定 → 打不出 online 包 | 有意为之：`online` 档保持构建失败，不填占位地址。域名确定前只用 `make:pre` |
| 中文 `productName` 在 Windows 路径/注册表上的兼容性 | Squirrel `name` 用 ASCII slug 与展示名分离（D3）；真机验证列为 Windows 打包任务的验收条件 |
| 改 partition 命名 = 用户重新登录 | 存量已决定丢弃；孤儿由 `cleanupOrphanPartitions` 自动回收 |
| 三套包并存占磁盘（单套 partition 已达 755MB） | 可接受：非正式环境按需安装；`desktop-clean` 提供按环境清理 |
| 从 shared 契约移除 `environment` 是破坏性改动 | 契约在同仓，编译期即可暴露全部调用点；无外部消费方 |
| `packageAfterCopy` 拷贝原生模块在 Windows 上未验证 | Windows 打包任务须真机验证 better-sqlite3 可加载 |

## Migration Plan

存量数据不迁移（已拍板）。开发机上一次性手工处理：

```
1. 合并前：记录当前已绑定的渠道账号清单（重新绑定时对照）
2. 切到新构建后，旧目录 小智酒店管家/ 成为无人引用的遗留 → 手动删除
3. 各渠道重新登录绑定
```

回滚：环境注入是纯增量（新插件 + 新 npm script），回退到旧 commit 即恢复原行为；
但已按新命名产生的数据目录不会自动回到旧目录，回滚后需重新绑定。

## Open Questions

- online 环境的正式 RMS 域名与是否已上 HTTPS —— 不阻塞本次实现（`make:pre` 可独立
  验证全链路），仅阻塞 `make:online` 首次出包
- Windows 安装包是否需要用户可选安装路径 —— Squirrel 不支持自定义安装目录，若确有
  需求需换 maker（如 WiX/NSIS），届时单独评估，不影响本次环境隔离机制
