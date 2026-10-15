## Context

见 `proposal.md`。Electron 43 提供 `app.userAgentFallback`，只在 `webContents` 与 `session` 未覆盖 UA 时生效，须在创建会话前设置。当前成功的实验值是 macOS 上 Chrome `155.0.0.0` 的标准 UA。Cookie 导入暂存区已有每渠道 `manifest.json`；账号分区生命周期已有 `partitions.json` 账本。`openExisting` 当前同步，但 IPC/renderer 调用链本来是异步。

## Goals / Non-Goals

**Goals:** 默认值覆盖所有网页会话；可识别来源浏览器时在导入、首次打开、重开、绑定新分区、后台同分区请求之间保持同一 UA；旧数据透明回退。

**Non-Goals:** 复制整份浏览器 Profile、伪造 Client Hints 或其他浏览器指纹、保证通过第三方风控。Cookie 文件无法提供原始 UA，也无法还原用户自定义 UA。

## Decisions

### 1. 全局默认值与优先级

在 `main/index.ts` 的会话创建前设置 `app.userAgentFallback`，默认 UA 采用已验证的 Chrome 155 格式，平台段分别取 macOS、Windows、Linux 常见格式。默认版本是有意固定的已验证兼容值，后续升级必须重新验证；避免用 Electron 自带 Chromium 版本替换这个实验结果。优先级为分区保存的来源 UA > 全局默认 UA。删除前一轮只针对 dev/macOS/携程的覆盖。

选择 `app.userAgentFallback` 是因为 Electron 43 官方类型说明它是全应用默认值。替代方案是在每个 `SessionFactory` 路径逐一覆盖，容易漏掉主窗口或新增分区。

### 2. 来源 UA 是推导值，不是 Cookie 字段

导入器在读取 Chromium 来源时，同时读取所选 Profile 根目录的 `Last Version`。仅 Chrome 与 Edge 使用已知 UA 模板：Chrome 采用标准 Chrome token，Edge 采用 Chrome token 加 Edg token；版本必须匹配数字格式且长度受限。其他来源（Firefox、Safari、QQ、360、搜狗）、缺失版本或读文件失败返回 `null`，导入 Cookie 不受影响。版本只来自本机文件，不发网络请求、不读取 Cookie 内容来猜测。

替代方案是启动被导入浏览器并执行脚本取 `navigator.userAgent`；这会改变用户浏览器状态，也不保证访问的是同一 Profile，因此不采用。另一个方案是只保存来源名称，重开时重新探测版本；浏览器升级会让原登录态的 UA 静默变化，因此保存导入时的值。

### 3. 持久化与恢复

`cookie-imports/<channel>/manifest.json` 增加可选 `userAgent`，旧文件无需迁移。新建导入会话时把它传入 `BrowserManager`，首次加载前在该 partition 的 `Session` 和新 `WebContents` 上设置；传入值先验证，非法值回退默认值。同一分区的后台 `session.fetch` 因 Session 覆盖使用相同 UA。

`partitions.json` 的记录增加可选 `userAgent`，在账号分区创建时写入，状态迁移保留该字段。`openExisting` 改为异步读取账本，找到保存值后再建标签；绑定新分区同样继承。若旧分区没有账本记录或字段，使用默认值。账本是该分区设置的事实来源，避免把浏览器配置混入渠道 credential 的业务附加信息，也避免数据库迁移。

### 4. 边界与验证

共享 IPC DTO 无需新增字段；`OtaTabOrchestrator.openExisting` 的主进程返回类型允许 Promise，renderer 已 await。导入结果向 renderer 保持原形状。测试覆盖 UA 模板与版本校验、导入元数据及旧文件回退、分区重开与绑定继承、全局默认值装配；人工验证 dev 中携程导入后及重开访问。

## Risks / Trade-offs

- [Chrome 155 固定默认版本会老化] → 记录为兼容性基准，升级时单独验证并更新；导入 Chrome/Edge 成功时优先使用其版本。
- [UA 与实际 Chromium 能力或 Client Hints 不完全一致] → 本次只验证 UA 对既有拦截的影响，不添加更多伪装；失败时保留可回退的独立设置。
- [读取 Profile `Last Version` 不是完整 UA] → 只对 Chrome/Edge 生成已知格式，其他来源使用默认值；绝不称为从 Cookie 精确复制。
- [账本读取失败或旧记录缺字段] → 回退全局默认值，不阻止打开账号。

## Migration Plan

无需迁移旧导入文件和分区账本：可选字段缺省即默认 UA。回滚代码后新增字段仍可被旧读取路径忽略。发布前先在本地 dev 完成携程人工验证，再决定是否发布。
