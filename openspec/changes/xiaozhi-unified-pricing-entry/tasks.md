## 1. 构建期：RMS web 页面地址

- [x] 1.1 在 `vite-plugins/app-env-profiles.mjs` 的 PROFILES 加 `rmsWebOrigin` 字段：dev 填 `http://localhost:5173`，pre / online 填 `null`（表示回落到 `rmsOrigin`），并在表头注释里说明该字段与 `rmsOrigin` 的关系
- [x] 1.2 新建 `vite-plugins/rms-web-origin.ts`，照 `rms-origin.ts` 的形状导出 `resolveRmsWebOriginForBuild()` 与 `rmsWebOriginDefine()`：取值优先级 `XIAOZHI_RMS_WEB_URL` > `profile.rmsWebOrigin` > `profile.rmsOrigin`；沿用同一套 HTTPS 强制校验与 `XIAOZHI_ALLOW_INSECURE_RMS` 豁免
- [x] 1.3 单测覆盖 1.2 的取值优先级：显式 env 覆盖、profile 有值、profile 为 null 时回落 API 地址、非本机明文未豁免则构建失败
- [x] 1.4 在 `vite.main.config.ts` 挂上该插件；在 `forge.env.d.ts` 声明 `__RMS_WEB_ORIGIN__`；在 `vitest.unit.config.mts` 与 `tests/e2e/config/vite.main.config.mts` 补 define
- [x] 1.5 新建 `main/staff-auth/rms-web-endpoint.ts` 导出 `resolveRmsWebOrigin()`，注释说明它为何与 `resolveRmsOrigin()` 分开（dev 下不同端口；同源是部署巧合）

## 2. 主进程：内部页面 partition

- [x] 2.1 在 `main/browser/partition.ts` 加 `INTERNAL_PAGE_PARTITION`（`persist:xiaozhi:<env>:internal`，**4 段**），注释写明段数不得增至 5 的原因（会被 `isOtaLoginPartition` 判为孤儿清空）
- [x] 2.2 ⚠️ 单测断言 `INTERNAL_PAGE_PARTITION` **不被** `partition-cleanup.ts` 的孤儿判据命中，且名字含当前环境段。这条守的是「用户数据被静默清空」，不可省
- [x] 2.3 在 `SessionFactory` 加 `sessionForInternalPage()`，与 `sessionForRmsApi()` 并列

## 3. 主进程：打开内部页面

- [x] 3.1 在 `shared/ipc-channels.ts` 加 `internalPage.open` 通道常量
- [x] 3.2 新建 `main/ipc/internal-page-handlers.ts`：取令牌（`rmsTokens.accessToken()`）→ 拼 `<webOrigin>/unified-pricing?token=…` → `browserManager.createWithAlreadyPartition(INTERNAL_PAGE_PARTITION, 'xiaozhi', url)`。**不传 refreshToken、不传 hotelId**
- [x] 3.3 无有效会话时（`RmsSessionMissingError`）不打开 tab，转成用户可读的错误返回；日志与错误上报**均不得含 URL 或令牌**
- [x] 3.4 在 `composition/window-scope.ts` 装配该 handler，参照 `registerBrowserHandlers` 直接注入 `browserManager`（不要参照 `registerOtaTabHandlers`——eslint 禁 `services/` import `browser/`）
- [x] 3.5 在 `preload/namespaces/` 暴露 `internalPage.open()`，返回 `BrowserTab`
- [x] 3.6 单测：URL 拼装正确且含 token、不含 refreshToken 与 hotelId；无会话时不开 tab；令牌不进日志
- [x] 3.7 决定并实现重复点击行为（design Open Questions；倾向复用已有 tab 而非叠开），补对应单测

## 4. renderer：渠道入口

- [x] 4.1 在 `renderer/data/ota-channels.ts` 给渠道条目加 `kind: 'ota' | 'internal'`，既有条目全部标 `'ota'`
- [x] 4.2 新增 `xiaozhi` 条目（`kind: 'internal'`，展示名「小智平台」），在 `WORKSPACE_CHANNEL_IDS` 中置于**第一位**；确认它**不在** `BINDABLE_CHANNEL_IDS`
- [x] 4.3 准备图标并加入 `renderer/data/ota-icons.ts`
- [x] 4.4 `BrowserWorkspace.svelte` 点击行为分流：`kind === 'internal'` 直接调 `internalPage.open()` 并 `browserOtaTabs.adopt(tab)`（**必须 adopt**，否则重演零尺寸事故）；`'ota'` 维持现有 `selectChannel`
- [x] 4.5 内部页面选中时不渲染账号切换弹窗区块（该区块对它无意义：无账号、无 cookie 导入）
- [x] 4.6 单测：内部页面不出现在绑定候选渠道中；历史绑定记录的渠道名反查不被 `xiaozhi` 命中

## 6. 会话过期拦截（决策 1 方案 E）

- [x] 6.1 在 `BrowserManager` 的 `options` 加一个可选导航守卫（如 `onNavigationBlocked`），在 `will-navigate` 里对**已有的 URL 合法性校验之外**再问一次守卫；守卫不存在时行为与现在完全一致
- [x] 6.2 给 `BrowserManager` 加 `loadUrl(tabId, url)`：把已有 tab 导到新地址。`reload()` 不能用 —— 页面已把 token 从地址栏抹掉，重载等于加载一个没有 token 的地址
- [x] 6.3 在 `internal-page-handlers.ts` 装配守卫：只对内部页面的 tab、且目标落到 RMS 登录页时拦截；其余一律放行
- [x] 6.4 拦下后取新令牌重载；`RmsSessionMissingError` 时关闭该 tab（不把用户留在 RMS 登录页）
- [x] 6.5 同一 tab 连续拦截设上限，超限关 tab —— 防「续期成功却仍被跳转」的死循环
- [x] 6.6 单测：目标为登录页时拦截并重载、非登录页放行、非内部 tab 放行、会话失效时关 tab、超限关 tab；**日志与错误上报不得含 URL 或令牌**

## 5. 验证与收口

- [x] 5.1 确认 `channels/registry.ts` **未**注册 `xiaozhi`（不注册即不挂载登录判定/探测/改价监听），并补一条断言测试固化该前提
- [x] 5.2 跑一次受影响范围的单测；跑 lint 确认未违反分层边界
- [x] 5.3 真机验证（dev）：点入口能开 tab、地址栏 token 已被页面抹掉、反复打开不新增 partition 目录、`partitions.json` 无新增记录、重启后该 partition 未被清空
- [ ] 5.3b ⭐ 真机验证拦截路径（**依赖服务端需求先落地**，见 `server-feedback.md` §3）：传一枚已过期的 token 打开 → 页面尝试跳 `/login` → desktop 拦下 → 换新 token 重载成功
- [x] 5.4 把对 rms-admin 的需求同步给 rms 侧（已写为 `server-feedback.md`）；在对方落地前，验证记录中如实注明页面渲染与拦截路径未通过端到端验证
- [x] 5.5 写 `verification.md`，附上 5.3 的实际结果（禁止虚构输出）
- [ ] 5.6 归档前同步 `openspec/specs/`：新增 `desktop-internal-web-pages`，合并 `desktop-build-environments` 与 `browser-partition-lifecycle` 的 delta
