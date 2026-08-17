## Why

桌面应用的 `userData`、日志目录、安装标识全部由 `package.json` 的 `productName` 单独
决定，三套环境（dev / pre / online）打出的包共用同一份存储且互相覆盖安装——开发机上
已出现 4 个手工 `.backup-*` 目录和 755MB 混杂 partition 佐证这个痛点。应用即将正式
安装到 Windows，若继续按 macOS 单环境假设推进，`productName`/appId/安装路径这套命名
会被绑死，Windows 上必须返工。

## What Changes

- 新增构建期变量 `XIAOZHI_APP_ENV`（`dev` | `pre` | `online`），复刻 `auth-variant.ts`
  已验证的构建期注入模式：白名单校验、非法值抛错不静默回退、类型声明收口在
  `forge.env.d.ts`
- 该变量驱动 `productName`、macOS `appBundleId`、Windows Squirrel `name` 与 RMS origin
  默认值；`userData` 与日志目录由 Electron 的 `app.getPath` 按平台自动派生，**不引入
  `app.setPath` 手写平台分支**
- **BREAKING**：三环境包名与数据目录全部改变。存量数据不迁移、不写迁移代码——正式
  用户尚未安装过，唯一存量是开发机上那份，渠道账号重新登录绑定即可
- partition 名称中的 `environment` 段由当前硬编码的 `'prod'` 改为真实环境值。该参数
  已贯穿 shared schema → IPC → renderer，但 5 个调用点全部写死 `'prod'`，本次接通
- 构建脚本从 POSIX `sh` 迁到跨平台 Node，`scripts/*.sh` 在 Windows 上无法执行
- 清理 `pending-partitions.json` 遗留（源码零引用，已被 `partitions.json` 账本取代）
- 修 `partition.ts:21` 指向不存在常量 `STORAGE_VERSIONS.partitionLayout` 的悬空注释
- `desktop-clean.sh` 的后继脚本补上日志目录（macOS 下日志不在 `userData` 内，现有清理
  完全覆盖不到，已积 17MB）

非目标：代码签名与公证（`osxSign`/`osxNotarize`/Windows EV 证书）、auto-update。二者
都依赖本次的环境标识落地，但各自独立且需要证书与发布通道决策，单独立项。

## Capabilities

### New Capabilities

- `desktop-build-environments`: 构建期环境变量的取值、校验规则，以及它如何驱动应用
  标识（productName / appId / Squirrel name）、RMS 地址与存储隔离；跨平台路径派生
  策略与三环境并存安装的保证

### Modified Capabilities

- `browser-partition-lifecycle`: partition 命名中 `<environment>` 段的取值从事实上的
  单值 `prod` 扩展为三个真实环境值，并要求其与构建期环境一致

## Impact

| 范围 | 影响 |
|---|---|
| 构建配置 | `forge.config.ts`（packagerConfig / MakerSquirrel）、三个 vite config、新增 `vite-plugins/app-env.ts` |
| 主进程 | `composition/app-scope.ts`、`browser/partition.ts`、`ipc/ota-tab-handlers.ts`、`staff-auth/rms-endpoint.ts` |
| 跨进程契约 | `shared/browser.ts` 的 `startLoginInputSchema.environment` 枚举 |
| 渲染进程 | `browser-ota-tabs.svelte.ts`、`CookieLoginListDialog.svelte` 三处 `'prod'` 字面量 |
| 构建脚本 | `scripts/*.sh` 四个脚本迁 Node；`desktop-make-prod.sh`（名为 prod 实为 pre）拆分 |
| 用户数据 | **不兼容**：包标识变更导致指向新目录，渠道账号需重新登录绑定 |
| 平台 | 新增 Windows 作为一等目标；Squirrel 安装目录与注册表项随环境隔离 |
