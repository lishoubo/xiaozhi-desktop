## 1. 构建期环境注入

- [x] 1.1 新建 `apps/desktop/vite-plugins/app-env.ts`：`ENVIRONMENTS` 白名单、
      `resolveAppEnvironment()`（非法值抛错不回退，缺省 `dev`）、`appEnvDefine()`
      注入 `__APP_ENV__`。形状复刻 `auth-variant.ts`（D1）
- [x] 1.2 在同文件加 `PROFILES` 表（productName / bundleId / rmsOrigin 三环境取值）
      与 `resolveEnvironmentProfile()`（D2）
- [x] 1.3 `forge.env.d.ts` 补 `declare const __APP_ENV__: 'dev' | 'pre' | 'online'`
- [x] 1.4 三个 vite config（main / preload / renderer）各挂一次 `appEnvDefine()`
- [x] 1.5 `vite-plugins/rms-origin.ts` 改为：未设 `XIAOZHI_RMS_SERVER_URL` 时取
      profile 默认值而非写死 localhost；HTTPS 强制校验逻辑保持不变（D2）
- [x] 1.6 单测：白名单校验、非法值抛错、缺省值、profile 取值、HTTPS 豁免分支

## 2. 应用标识随环境变化

- [x] 2.1 `forge.config.ts` 的 `packagerConfig` 补 `name`（取 profile.productName）
      与 `appBundleId`（取 profile.bundleId）（D3）
- [x] 2.2 `MakerSquirrel` 补 ASCII slug `name`（`xiaozhi-hotel[-pre|-dev]`），与中文
      展示名分离，避免 Windows 路径/注册表兼容问题（D3）
- [x] 2.3 确认 `composition/app-scope.ts:77` 的 `app.getPath('userData')` 保持不变——
      本次不引入任何 `app.setPath` 与平台路径分支（D3）
- [x] 2.4 启动日志输出当前 `__APP_ENV__` 与 RMS origin，满足「环境标识对使用者可见」

## 3. partition 环境段接通

- [x] 3.1 `browser/partition.ts`：`toPartitionName` 去掉 `environment` 形参，改为内部
      读 `__APP_ENV__`（D4）
- [x] 3.2 `shared/browser.ts`：`startLoginInputSchema` 移除 `environment` 字段
- [x] 3.3 顺着编译错误清理调用点：`ipc/ota-tab-handlers.ts:84`、
      `browser/session-factory.ts`、`browser/browser-manager.ts`、
      `renderer/components/browser/browser-ota-tabs.svelte.ts` 两处、
      `CookieLoginListDialog.svelte`
- [x] 3.4 `file-store/partition-ledger.ts` 的 `environment` 字段类型跟随扩为三值
- [x] 3.5 更新受影响的既有单测（partition 命名、账本、IPC 契约）

## 4. 构建脚本跨平台化

- [x] 4.1 新建 `scripts/desktop-clean.mjs`：把现有 sh 里内嵌的 `node -e` 路径计算扶正，
      **并补上日志目录**（macOS 在 `~/Library/Logs/`，Windows 在 userData 内）（D5）
- [x] 4.2 新建 `scripts/desktop-make.mjs`：读 `XIAOZHI_APP_ENV` 并转发 forge make
- [x] 4.3 `package.json` 增加 `make:pre` / `make:online` 入口，`dev` 显式带
      `XIAOZHI_APP_ENV=dev`；跨平台传环境变量（cross-env 或 Node 脚本内设）（D5）
- [x] 4.6 **补做**：环境 × 平台的完整打包入口矩阵。原先只留了当前平台的两个入口，
      丢掉了旧 `make:mac:intel|mac:arm64|win64`，打 Windows 包得手敲 Forge 参数；
      且 `package:desktop` 绕过脚本、会打出 dev 默认包。现改为
      `--target=<mac-arm64|mac-intel|win64|linux64>` 简写 + `--package-only`，
      package.json 出 6 个 make 入口
- [x] 4.4 删除 `scripts/desktop-make-prod.sh`（名为 prod 实为 pre，已被 4.3 取代）
      与其余三个 `.sh`，确认无残留引用
- [x] 4.5 验证 `make:online` 在正式域名未配置时**构建失败**而非兜底（D2 的有意设计）

## 5. 顺带清理

- [x] 5.1 删除磁盘遗留 `<userData>/pending-partitions.json`，重建过期的
      `apps/desktop/.e2e/build/` 产物（源码零引用，仅陈旧构建产物命中）（D6）
- [x] 5.2 修 `browser/partition.ts:21` 悬空注释：改为引用同文件的
      `PARTITION_LAYOUT_VERSION`，不新建常量表（D6）
- [x] 5.3 ~~e2e 启动时指定独立 `userData`~~ —— **无需改动，提案时的判断有误**：
      `tests/e2e/app.spec.ts:18-27` 已经 `mkdtemp` 出临时目录并用
      `--user-data-dir` 传给 Electron，`afterEach` 里清掉。全仓只有这一处
      `electron.launch`，不存在污染开发环境的路径（D6）

## 5A. 真机回归修复（2026-08-17 dev 包实测发现）

现象：从 cookie 导入携程，导入成功（133 条）却仍停在登录页。

- [x] 5A.1 **根因一：跨环境误清**。`isOtaLoginPartition` 只判前缀+段数，不看环境段；
      而孤儿判定依据是「本环境 credential 表里没有」，于是**另一套环境的 partition
      必然被判成孤儿清空**。真机日志：`Orphan partitions cleared { cleared: 19 }`，
      新建的 `:dev:` partition 下一轮也被清（实测两个 dev partition 的 Cookies 库
      均为 0 条）。修复：环境段必须等于 `APP_ENVIRONMENT`
- [x] 5A.2 **根因二：dev 模式不换目录**。`forge.config.ts` 的 `packagerConfig.name`
      只在**打包**时生效，`electron-forge start` 下 `app.getName()` 仍回落到
      package.json 的 `productName` —— dev 数据与正式包共用目录，隔离对 dev 无效。
      修复：新增构建期常量 `__APP_PRODUCT_NAME__`，在 `index.ts` **第一条语句**
      `app.setName()`（必须早于 configureMainLogging 与 app-scope，否则日志与
      userData 已解析到旧目录）
- [x] 5A.3 回归测试：`partition-cleanup.test.ts` 新增「绝不碰其他环境的 partition」，
      并把原有本环境用例从 `prod` 改为 `dev`（测试环境常量即 dev）
- [x] 5A.4 按既定决策清空存量：删除 `小智酒店管家/` 及 4 个 `.backup-*`（合计 1.9GB）
      与孤立日志目录（17MB）。渠道账号需重新登录绑定

## 6. 验证

- [x] 6.1 定向单测通过（1.6 / 3.5 新增与更新的用例）
- [x] 6.2 `npm run check:desktop` 与 `npm run lint:desktop` 通过
- [x] 6.3 macOS：`make:pre` 出包，确认 productName / bundleId / userData / 日志四处
      均带环境标记，且与开发环境目录互不可见
- [ ] 6.4 macOS：dev 与 pre 同时安装，确认可并存、图标与名称可区分、数据隔离
- [ ] 6.5 **Windows 真机**：`make:pre` 出包并安装，确认 better-sqlite3 可加载
      （`packageAfterCopy` 未在 Windows 验证过）、Squirrel 安装目录与注册表项带环境
      标记、`%APPDATA%` 数据目录隔离、中文 productName 无兼容问题
- [x] 6.6 全量单测跑一次（中/大任务完成态）
- [x] 6.7 验证证据写入 `openspec/changes/desktop-build-env-isolation/verification.md`

## 7. 规范同步

- [x] 7.1 已合并 delta 进 `openspec/specs/`：新建
      `desktop-build-environments/spec.md`（106 行）；`browser-partition-lifecycle`
      更新「partition 名称不可从账号反推」并**新增「孤儿回收只作用于本环境的 OTA
      登录 partition」**——后者是 5A.1 那个真机 bug 暴露出的规范缺口，原规范只约束了
      `retired` 的清空条件，没约束孤儿回收的候选范围。
      `openspec validate --specs` 两份均通过
- [ ] 7.2 待 Windows 验收后 `openspec archive desktop-build-env-isolation`
      （现在归档为时过早：6.5 未完成）
