## 实施期证据（2026-10-19）

### 会话请求预检

使用仓库忽略的 `output/meituan-session-fetch-probe.cjs`，仅输出 HTTP 状态、业务码和账号 ID 是否匹配；未输出账号值、Cookie、响应正文。开发版当日扫描成功的美团 partition：`getDetail` HTTP 200 / code 10000 / ID 匹配，`poiInfos` HTTP 200 / code 10000。已失效的正式版 partition 与空白 session：`getDetail`、`poiInfos` 均返回 code 606（其中一份过期 partition 的详情请求为 HTTP 403）。因此同 partition 的主进程 `session.fetch` 在本机有效会话可用，未登录会话可区分；失效响应不会进入网页 JavaScript 环境。

### 空白会话导航

使用仓库忽略的 `output/meituan-nav-probe.cjs`，只记录主 frame 的 origin 和 pathname。加载 `/ebooking/merchant/ebIframe` 后，先出现该 URL 的 `did-navigate` 与多次 `did-navigate-in-page`，随后主 frame 导航到 `/login/index.html`，并出现 `epassport.meituan.com/portal/oauth-login` 的 in-page 事件。最终主 URL 为 `https://me.meituan.com/login/index.html`。现有 matcher 会在最初的 `/ebooking/merchant/ebIframe` 命中，但最终登录页不命中；失效后不能因最初 URL 命中就断言登录成功。后续重试应由新的导航/登录状态变化驱动，不能定时重发历史候选请求。

以上仅证明本机测试条件与请求/导航行为；尚未复现客户原生弹窗的触发请求。

### 跨账号请求核对

独立 review 指出 `getDetail` 可能按查询参数返回非当前账号，因此用开发版有效会话另查本地另一条美团渠道账号（不输出账号值或响应正文）。当前账号详情返回 HTTP 200 / code 10000 / ID 匹配；查询另一账号返回 HTTP 200 / code 33001 / ID 不匹配。此样本说明该接口在这份有效会话中拒绝跨账号详情，支持“定向查询 + 响应 ID 校验”的判据；其他美团权限组合仍需客户环境实测。

### 代码验证

- 独立 review 后补充首次失效不结束重登等待、首个导航直接到登录页、普通标签切换账号及首次恢复原账号的测试。最后一次状态机改动后，5 个直接相关文件、58 个用例通过；TypeScript 与定向 ESLint 通过。
- Desktop 全量单元测试：146 个文件、1436 个用例通过（仅运行一次）。独立 review 后又修改了美团状态机；修改后运行上述定向测试，未重复全量套件。
- `npm run check --workspace @hotel-butler/desktop`：TypeScript 与 Svelte 检查通过，0 错误、0 警告。
- 改动文件定向 ESLint：通过。仓库全量 ESLint 仍有 4 处旧错误，均在未修改的 `meituan-inventory-readback.test.ts` 与 `meituan-room-change-targets.test.ts`，为 `_omitted` 未使用；本变更没有改动这两份文件。首次全量 lint 与单测并行时还碰到了分层边界测试临时生成的 probe 文件；单测退出后重跑，只剩上述 4 处旧错误。
- `git diff --check` 通过；`openspec validate meituan-login-discovery-guard` 通过。独立 verification pass 与 code-review pass 已执行；review 指出的首次失效提前结束等待、普通账号切换状态问题已修正并定向复核。
- 原生弹窗观察代码与页面弹窗 API 未改动；新增发现日志只包含 `tabId`、可选 `requestId`、模式、阶段、结果类别及耗时，不记录账号 ID、Cookie、响应正文或弹窗正文。

### 待实机复核

客户 Windows 诊断包尚未部署。需在过期美团账号的酒店管理重登链路实测：停在美团登录页时仅出现一次定向 `getDetail`，没有逐历史账号请求；原生弹窗若仍出现，由既有观察日志关联请求阶段；手动登录后可恢复，并核对两种重登锚点。完成这一复核后再合并 delta spec、归档 change。
