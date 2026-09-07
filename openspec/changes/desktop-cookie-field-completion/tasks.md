## 1. 契约与纯映射（无 Electron 依赖，可裸测）

- [x] 1.1 扩展 `main/gateway/rms/types.ts` 的 `RmsCookieSnapshotEntry`：新增可选 `path` / `secure` / `httpOnly` / `sameSite` / `expires` / `partitionKey`（`partitionKey` 用 `unknown`，见 design 决策 4）
- [x] 1.2 新建 `main/browser/cookie-snapshot/to-snapshot-entry.ts`：两条采集路径共用的字段映射，用条件展开实现「缺省即省略 key」，绝不产出 `null`
- [x] 1.3 实现 `sameSite` 映射（design 决策 5）：`no_restriction→None`、`lax→Lax`、`strict→Strict`、`unspecified→省略字段`
- [x] 1.4 实现 `expires` 规则：`session === true` 或 `expires <= 0` 时省略该字段
- [x] 1.5 单测 `to-snapshot-entry`：覆盖 happy path、`sameSite: unspecified` 省略、会话 cookie 省略 `expires`、`partitionKey` 原样透传（含对象与字符串两种形态）

## 2. 采集来源

- [x] 2.1 新建 `cdp-source.ts`：`Network.getAllCookies`，attach 生命周期按 design 决策 6（只 detach 自己 attach 的；`isAttached()` 为 true 时不抢占直接返回不可用；不调 `Network.enable`）
- [x] 2.2 新建 `electron-source.ts`：`session.cookies.get({})`，产出交给同一个 `to-snapshot-entry`
- [x] 2.3 单测 CDP source 的 attach/detach 行为：debugger 已被占用时不抢占且返回不可用；attach 抛错时不泄漏 attach 状态

## 3. 标签页 webContents 查找

- [x] 3.1 `BrowserManager` 新增 `webContentsForPartition(partitionName): WebContents | null`，从 `tabs` 按 `partitionName` 反查，跳过 `isDestroyed()` 的 webContents
- [x] 3.2 单测：命中、未命中（无对应标签页）、webContents 已销毁三种情况

## 4. 采集编排与装配

- [x] 4.1 新建 `collect-cookie-snapshot.ts`：CDP 优先 → 不可用则降级到 Electron source → 返回统一形状
- [x] 4.2 降级时打结构化日志，带 `degraded: true` 与原因（标签页缺席 / debugger 被占 / attach 失败），且只记条数与采集方式，不记任何 cookie value（spec「快照不落地、不入日志」）
- [x] 4.3 改 `app-scope.ts:89` 的 `readCookieSnapshot` 走 `collectCookieSnapshot`，注入 `sessionFactory` 与 `webContentsForPartition`；保持签名仍只收 `partitionName`（调用方三处不改）
- [x] 4.4 单测编排：CDP 可用走 CDP、不可用走降级、降级日志字段正确
- [x] 4.5 跑一次 eslint 确认分层边界未被破坏（`services/` 未 import `browser/`、`ipc/` 未 import `electron`）

## 5. 验证

- [x] 5.1 跑受影响模块的单测（cookie-snapshot、browser-manager、hotel-management-service）
- [x] 5.2 真机：抖音账号在 desktop 绑定「Alan·银际酒店(九原区政府店)」，POST 200
- [x] 5.3 核对本次上送快照：`source: cdp`、56 条、字段齐全；**分区 cookie 0 条**（未达 ≥10，根因已定位见 `verification.md` 第三节，非本次代码缺陷）；`ttwid` 未达 2 条（非硬性目标）
- [x] 5.4 确认日志中未出现降级标记（`degraded: true` 一次都没打，全程走 CDP）
- [ ] 5.5 通知服务端跑核验工具比对，并观察 24 小时是否复发 `LOGIN_EXPIRED`
- [ ] 5.6 与服务端确认 RPA 写回 cookie 后的顶级站点上下文，据此判断分区 cookie 是否为必需（见 design Open Questions）

## 6. 收尾

- [ ] 6.1 本次触及跨模块接口（上送 RMS 的 cookies 数组形状），验收通过后同步 `openspec/specs/`（新增 `ota-cookie-snapshot` capability）
- [x] 6.2 写 `verification.md` 留存验证证据
