# 验证证据 —— desktop-build-env-isolation

日期：2026-08-17　平台：macOS (darwin arm64, Darwin 25.2.0)　Node v24.18.1

## 自动化验证

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run check:desktop` | ✅ `tsc --noEmit` 通过；`svelte-check` 998 文件 **0 errors 0 warnings** |
| Lint | `npm run lint:desktop` | ✅ 通过，无输出 |
| 全量单测 | `npm run test:unit:desktop` | ✅ **84 文件 / 609 用例全部通过**（2.24s） |
| 新增单测 | `tests/unit/main/app-env.test.ts` | ✅ 14 用例通过 |

新增用例覆盖：环境白名单、非法值抛错不回退、缺省 `dev`、三环境标识两两不同、
online 展示名不带标记、Squirrel 标识为纯 ASCII、profile 默认地址、online 地址未定
时抛错、显式地址覆盖、HTTPS 强制与豁免分支。

### 单测暴露的真实契约收紧（非预先编排）

`tests/unit/main/ota-tab-intent-boundary.test.ts` 4 个用例在改动后**失败**，原因是
fixture 仍传 `environment: 'prod'`，而 `startLoginInputSchema` 是 `strictObject`。
这正面证明了「renderer 再也传不进环境」这条约束是被 schema 真实拦住的，不是靠约定。
移除 fixture 中该字段后通过。

## 打包验证（任务 6.3）

```
$ npm run make:desktop:pre
环境: pre
应用名: 小智酒店管家[预发]（com.xiaozhi.hotel.pre / xiaozhi-hotel-pre）
RMS 地址: http://47.96.144.176
警告: RMS 地址为明文 HTTP（http://47.96.144.176），JWT 将以明文传输。
✔ Packaging application  ✔ Making distributables
› Artifacts available at: apps/desktop/out/make
```

产物：`out/小智酒店管家[预发]-darwin-arm64/`（334MB）+
`out/make/zip/darwin/arm64/小智酒店管家[预发]-darwin-arm64-1.0.0.zip`

### 应用标识落地（`Info.plist` 实读）

```
CFBundleName        小智酒店管家[预发]
CFBundleIdentifier  com.xiaozhi.hotel.pre
CFBundleExecutable  小智酒店管家[预发]
```

`CFBundleName` 即 `app.getName()` 的来源 → macOS 数据目录将是
`~/Library/Application Support/小智酒店管家[预发]/`、日志目录
`~/Library/Logs/小智酒店管家[预发]/`，与 dev 的 `[开发]` 后缀天然隔离。

### 构建期常量确实烧进产物（解包 asar 实读 `.vite/build/main.js`）

| 检查 | 结果 |
|---|---|
| pre 的 RMS 地址 | ✅ 出现 `47.96.144.176` |
| localhost 兜底 | ✅ **0 次命中** —— 不存在「看起来正常却连着本机」的风险 |
| 环境常量 | ✅ 压缩后为 `an="pre"`，并流入启动日志 `appEnvironment` 字段 |
| `__APP_ENV__` 残留 | ✅ 0 次 —— 已被 Rollup 折叠为字面量，非运行时读取 |

### 原生模块

`app.asar.unpacked/node_modules/better-sqlite3/prebuilds/` 内含
`darwin-arm64.node` / `darwin-x64.node` / **`win32-x64.node`** —— Windows 预编译产物
随包分发，对任务 6.5 是利好信号（但仍需真机确认加载）。

## Windows 交叉打包验证（任务 4.6）

```
$ npm run make:desktop:pre:win64
环境: pre　目标: win64
✔ Packaging for x64 on win32　✔ Packaging application
✖ Making a squirrel distributable for win32/x64
  [FAILED: You must install both Mono and Wine on non-Windows]
```

**结论：应用本体能在 macOS 上交叉打出，Squirrel 安装包不能。**

| 阶段 | macOS 上可行性 |
|---|---|
| `package`（出 `.exe` 与运行时目录） | ✅ 可行，用 `--package-only` |
| `make`（出 Squirrel `.exe` 安装包） | ❌ 需 Mono + Wine，或在 Windows 上跑 |

已产出 `out/小智酒店管家[预发]-win32-x64/`，实读确认：

- 可执行文件 `小智酒店管家[预发].exe` —— 环境标记随文件名带上
- `resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node`
  已解包到位（原生模块随包分发，`packageAfterCopy` 在 win32 目标下工作正常）

⚠ 仍**未验证**：该 `.exe` 能否真正启动、better-sqlite3 能否加载、`%APPDATA%` 目录
隔离、注册表卸载项。这些必须在 Windows 真机完成（任务 6.5）。

该限制已写进 `scripts/desktop-make.mjs` 的 `--help`，避免重复踩坑。

## 失败路径验证（任务 4.5）

```
$ node scripts/desktop-make.mjs --env=online
环境 online 尚未配置默认 RMS 地址。
请在 apps/desktop/vite-plugins/app-env-profiles.mjs 的 PROFILES 中填入，或显式设置
XIAOZHI_RMS_SERVER_URL。
（退出码 1，未产出任何构建产物）
```

符合 D2 的有意设计：正式域名未定时**构建失败而非兜底**。

非法环境值同样被拦：`XIAOZHI_APP_ENV=prod` → `取值非法（可选 dev | pre | online）`。

## 顺带清理验证（任务 5.1 / 5.3）

- `<userData>/pending-partitions.json`（411 字节，源码零引用）已删除
- `.e2e/build/` 重建后 `pending-partitions` 命中数由 1 → **0**
- 5.3 原计划有误：`tests/e2e/app.spec.ts:18-27` 早已用 `mkdtemp` +
  `--user-data-dir` 隔离，全仓仅此一处 `electron.launch`，**无需改动**

## 真机回归：cookie 导入后仍停在登录页（已修）

2026-08-17 dev 包实测发现。**是本次改动引入的 bug，不是渠道侧问题。**

### 排查过程与证据

| 步骤 | 结论 |
|---|---|
| 查导入文件 | ✅ `cookie-imports/ctrip/cookies.json` 33 条，含 `usertoken`/`usersign`/`logintype`/`imislogin` 等认证 cookie |
| 查日志 | ✅ `Cookies imported to disk { imported: 133, failed: 0 }` |
| 单独跑 Electron 复现注入 | ✅ 33 条 set 成功、29 条落库 —— **注入逻辑本身没问题** |
| 查 dev partition 的 Cookies 库 | 🔴 **两个 `:dev:` partition 均为 0 条** |
| 查启动日志 | 🔴 `Orphan partitions cleared { cleared: 19 }` |
| 对比标签页 partition | 🔴 界面上那个是 `:prod:`，带 cookie 的新 partition 是 `:dev:`，且 **9ms 后即被关闭** |

### 两个独立根因

**1. 跨环境误清**（数据破坏性，更危险）

```ts
// 旧：只看前缀与段数 —— prod / pre / dev 全部命中
partitionName.startsWith('persist:xiaozhi:') && split(':').length === 5
```

孤儿判定依据是「本环境 credential 表里查不到」。改了环境段之后，旧 `prod` partition
在 dev 的表里必然查不到 → 19 个全被清空；新建的 `:dev:` partition 也在下一轮被清。

**2. dev 模式根本没换目录**

`forge.config.ts` 的 `packagerConfig.name` **只在打包时生效**。`electron-forge start`
下 `app.getName()` 回落到 package.json 的 `productName`，所以 dev 仍写老目录
——实测 `~/Library/Application Support/小智酒店管家[开发]/` **不存在**。

### 修复

- `isOtaLoginPartition` 增加 `segments[2] === APP_ENVIRONMENT` 判断
- 新增构建期常量 `__APP_PRODUCT_NAME__`，`index.ts` 第一条语句 `app.setName()`
  （必须早于 `configureMainLogging` 与 app-scope，否则日志与 userData 已解析到旧目录）
- 回归测试「绝不碰其他环境的 partition」：`partition-cleanup.test.ts` 12 用例通过
- 全量 **610 用例通过**（较修复前 +1），check 与 lint 通过

### 存量清理（按既定决策）

删除 `小智酒店管家/` 及 4 个 `.backup-*`（合计 1.9GB）与孤立日志目录（17MB）。
渠道账号需重新登录绑定。

⚠️ **此修复尚未真机复验** —— 需重跑 dev 确认数据落到 `[开发]` 目录、cookie 导入后
能进已登录页。

## 未完成 / 阻塞项

| 任务 | 状态 | 原因 |
|---|---|---|
| 6.4 dev 与 pre 并存安装 | ⏸ 未执行 | 需把 `.app` 装进 `/Applications` 并各跑一次；属用户侧真机操作 |
| 6.5 **Windows 真机** | ⏸ **无法执行** | 当前环境为 macOS。需在 Windows 上验证：better-sqlite3 加载、Squirrel 安装目录与注册表项带环境标记、`%APPDATA%` 隔离、中文 `productName` 兼容性 |
| 7.1 specs 合并 | ⏸ 待验收后执行 | 完成门禁要求验收通过后再合并 delta 进 `openspec/specs/` |

**结论**：macOS 侧全部通过；Windows 侧未验证，不得声称跨平台已验收。
