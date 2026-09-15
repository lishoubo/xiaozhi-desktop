# Tasks

## 1. 构建期：更新源与盐值注入

- [x] 1.1 `vite-plugins/app-env-profiles.mjs` 的 `PROFILES` 三个环境各加 `updateFeedUrl`
      （dev / pre 为 `null`，online 填 `xiaozhi-desktop-release.oss-cn-beijing`）与
      `updateSalt`，并在表头字段说明 JSDoc 中补两行
- [x] 1.2 `vite-plugins/app-env-profiles.d.mts` 的 `EnvironmentProfile` 加对应字段类型
- [x] 1.3 新建 `vite-plugins/update-feed.ts`，照 `sentry-dsn.ts` 的形状导出
      `resolveUpdateFeedUrlForBuild(env, profileOf)` / `resolveUpdateSaltForBuild(...)`
      与 `updateFeedDefine(): Plugin`，define `__UPDATE_FEED_URL__` 与 `__UPDATE_SALT__`
      （空值一律归一成空串，不抛错）
- [x] 1.4 `vite.main.config.ts` 的 plugins 数组追加 `updateFeedDefine()`
- [x] 1.5 `forge.env.d.ts` 加两条 `declare const` 及注释
- [x] 1.6 单测：覆盖「环境变量覆盖优先」「profile 为 null 时得到空串」「非法环境值抛错」
      「末尾斜杠归一」（26 tests 通过）

## 2. 主进程：灰度判定

- [x] 2.1 新建 `src/main/updater/update-endpoint.ts`，单行 resolver 导出 feed 地址与
      manifest 地址（后者由 feed 地址派生），空串归一成 `null`
- [x] 2.2 新建 `src/main/updater/phone-digest.ts`，`sha256(phone + salt)` 返回 hex；
      手机号先 trim
- [x] 2.3 新建 `src/main/updater/gray-release-manifest.ts`：zod schema
      （`allowAll: boolean`、`allowlist: string[]`）、解析、判定命中
- [x] 2.4 单测：`allowAll` 为 true 时任何手机号命中；为 false 时只有名单内命中；
      manifest 结构非法时判定为不命中（不抛）（15 tests 通过）

## 3. 主进程：更新器服务

- [x] 3.1 新建 `src/main/services/updater-service.ts`，按 design 的依赖骨架实现
      `UpdaterService.checkOnce(identity)`；判定顺序为
      平台 → feedUrl → phone → manifest → 命中
- [x] 3.2 `checked` 标志保证单次运行只检查一次
- [x] 3.3 所有失败路径：先 `logger.warn(..., { error: safeLogErrorDetails(error) })`
      再 `reportError(error, { operation: 'update-check' })`，绝不向上抛
- [x] 3.4 监听 `update-downloaded` → 调 `onUpdateReady`；监听 `error` → 同 3.3
- [x] 3.5 单测：feedUrl 为 null 不检查、phone 缺失不检查、未命中名单不调
      `setFeedURL`、命中才调、重复调用只检查一次、manifest 拉取抛错时不抛出
      且已上报（第 7 组把「非 win32 不检查」改成了「非 win32 不启动 Squirrel」）

## 4. 接线

- [x] 4.1 `src/shared/ipc-channels.ts` 新增 `updater` 命名空间（更新就绪推送通道）
- [x] 4.2 推送走现有 `WindowCapabilityRegistry`（加 `notifyUpdateReady`），**不建**
      独立 handlers 文件——该通道只有主进程→渲染进程的推送，没有 invoke，
      用不上 handler registry 的参数校验
- [x] 4.3 `composition/app-scope.ts` 构造 `UpdaterService` 并挂到返回对象；
      `reportError` 由此处注入；electron 的重载式 `on` 在此适配成两个窄方法
- [x] 4.4 `ipc/staff-auth-handlers.ts` 的 options 加可选 `onIdentityResolved`，
      在 `login` / `loginWithPhoneCode` / `currentSession` **三条**成功且非 null 的
      路径上调用
- [x] 4.5 `composition/window-scope.ts` 把 `scope.updaterService.checkOnce` 接到 4.4 的
      回调上；`WindowScopeDependencies` 的 Pick 白名单加 `updaterService`
- [x] 4.6 preload 暴露更新就绪订阅（`namespaces/updater.ts`，走 `ValidatedSubscribe`）
- [x] 4.7 渲染进程展示「新版本已就绪」常驻提示（`durationMs: 0`）

## 5. 发布工具

- [x] 5.1 新建 `scripts/oss-uploader.mjs`：整目录同步到 OSS，拒绝单文件模式；
      上传前校验 `RELEASES` 与 `.nupkg` 同时存在；`RELEASES` 最后传（它是 Squirrel
      的开关，先传包再传清单）；OSS V4 签名用内置 crypto，不引 SDK
- [x] 5.2 新建 `scripts/gray-release.mjs`：digest / set --phone / --all / --none；
      手机号打 stderr、哈希打 stdout（重定向不会把明文写进文件）；
      **已实测与 `phone-digest.ts` 算出同一个哈希**
- [x] 5.3 OSS 凭证从环境变量读取，不落盘、不进仓库

## 6. 验证

- [x] 6.1 `npm run check:desktop` —— 本变更引入的类型错误已清零。**残留 1 条与本
      变更无关的基线错误**（`src/renderer/data/ota-icons.ts` 找不到
      `xiaozhi-logo-flat.png`），在上一个 commit `954d67d` 就已存在，已用
      `git stash -u` 核对确认
- [x] 6.2 `npm run lint:desktop` 通过（0 问题）
- [x] 6.3 `npm run test:unit:desktop` 全量通过（第 7 组后为 **115 files / 946 tests**），
      含 `layer-boundaries` 分层约束检查
- [ ] 6.4 dev 环境启动应用，确认更新器静默关闭且日志有说明（无更新源）
- [ ] 6.5 **真 Windows：安装 1.0.0 → 上传 1.0.1 → 名单命中 → 自动升级成功**
      ⚠️ 阻塞项，开发机无 Windows 环境
- [ ] 6.6 **真 Windows：名单未命中时不升级**
      ⚠️ 同上
- [ ] 6.7 **真 Windows：更新源不可达时应用照常可用**
      ⚠️ 同上

## 7. macOS 手动更新提示（档位 B）

- [x] 7.1 manifest 增加可选字段 `latestVersion` / `downloadUrls.{arm64,x64}`
      （必须可选——线上已有一份不含它们的名单，设成必填会连带把 Windows 更新停掉）
- [x] 7.2 新建 `updater/compare-versions.ts`：三段数字比较，解析失败保守返回 false
- [x] 7.3 `checkOnce` 按平台分流：win32 走 Squirrel，其余走手动提示
- [x] 7.4 按 `process.arch` 挑下载地址；挑不到只报版本号不给按钮
- [x] 7.5 `SystemService.openExternal`：只放行 https（名单经网络传输，不可信）
- [x] 7.6 渲染进程常驻提示 +「前往下载」按钮
- [x] 7.7 **更新源按平台分目录**：`updates/` → `win32/`，新增 `darwin/`
      —— Squirrel.Windows 与 .Mac 都用 `RELEASES` 文件名，混在一起没法共存；
      而 feedUrl 写死在已发布产物里改不了，必须现在分
- [x] 7.8 上传脚本加 `--mac-dir`，拒收文件名不含 `darwin` 的文件
      （Windows CI 产物也是 zip，实测会被误收）
- [x] 7.9 `gray-release.mjs` 加 `--version` / `--mac-arm64` / `--mac-x64`，
      校验版本号格式与 https 协议
- [x] 7.10 验证：115 files / 946 tests 通过；lint 通过；脚本护栏实测
      （有地址无版本号 / http 地址 / 版本号格式错 / Windows 包混入 —— 四条全拦住）

## 8. 收尾

- [ ] 8.1 `specs/` delta 合并进 `openspec/specs/`（待 6.5-6.7 通过后）
- [ ] 8.2 `verification.md` 记录验证证据
