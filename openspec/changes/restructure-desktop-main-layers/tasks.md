# 任务清单

执行顺序即批次顺序。**每批结束跑一次批次门禁，绿了才进下一批**，不合批、不跳批。

批次门禁（下称「门禁」）：
```
npm run check:desktop && npm run lint:desktop && npm run test:unit:desktop
```
仅 A 批与 F 批额外跑 `npm run test:e2e:desktop`（E2E 构建慢，中间批次不跑）。

**关键顺序约束**：D 批（补 service）必须在 E 批（删 ports / 拆 domain）之前完成。
否则 `calendar-handlers` 会从「import 接口」退化成「import SQLite 实现类」，比现状更糟。

---

## A 批 — 测试瘦身（先做，避免后续每批都改废弃测试）

- [ ] A1 记录基线：跑 `npm run test:all`，把通过数/失败数写进 `verification.md` 作为对照
- [ ] A2 删除 `apps/desktop/tests/component/` 整目录（11 文件，1133 行）
- [ ] A3 删除 `vitest.component.config.mts`；从 `apps/desktop/package.json` 移除 `test:component` / `test:component:watch`，调整 `test` / `test:all` / `test:coverage`
- [ ] A4 从根 `package.json` 移除 `test:component`，调整 `test` / `test:all`
- [ ] A5 删除锁日志/文案/常量的 unit 测试：`unit/main/logging.test.ts`、`unit/main/ipc-logging.test.ts`、`unit/renderer-font.test.ts`、`unit/renderer-logging.test.ts`
- [ ] A6 卸载仅被 component 测试使用的依赖（`@testing-library/svelte` 等，先 grep 确认无其他引用）
- [ ] A7 门禁 + `npm run test:e2e:desktop`（**E2E 必须绿 —— 后续所有批次的验收基线**）

## B 批 — IPC 样板收敛（独立，不动目录结构）

- [ ] B1 新建 `main/ipc/create-handler-registry.ts`（design §6.2）
- [ ] B2 registry 单测：信任校验拒绝非主窗口、参数校验失败返回指定文案、dispose 清理全部 channel
- [ ] B3 `auth-handlers.ts` 改用 registry，删除本文件内的 `handle` / `assertTrusted`
- [ ] B4 `calendar-handlers.ts` 同上
- [ ] B5 `hotel-management-handlers.ts` 同上
- [ ] B6 `automation-handlers.ts` 同上
- [ ] B7 `ota-tab-handlers.ts` 同上
- [ ] B8 `browser-handlers.ts` 同上
- [ ] B9 删除 4 份 handler 测试中「信任校验 / 参数校验」用例（已由 B2 覆盖），保留各自业务断言
- [ ] B10 门禁

## C 批 — 目录重命名与移动（机械改动，不改逻辑）

- [ ] C1 `main/features/` → `main/services/`，类名 `XxxFeature` → `XxxService`
  - `hotel-management-feature.ts` → `services/hotel-management-service.ts`
  - `ota-hotel-prob-feature.ts` → `services/ota-hotel-prob-service.ts`
  - `discover-and-create.ts` → `services/ota-credential-service.ts`（`DiscoverAndCreate` → `OtaCredentialService`）
- [ ] C2 渠道适配器上提为 `main/channels/{ctrip,douyin,meituan}/`，合并原先散在三个 feature 目录下的 `ota/<channel>/`
- [ ] C3 新建 `main/channels/types.ts`：`LoginUrlMatcher` / `HotelProbe` / `Discovery` 接口（原 `ports/discovery.ts` + `hotel-prob-port.ts`）
- [ ] C4 新建 `main/channels/registry.ts`（design §6.3），`application.ts` 中三段手写渠道装配改为调用 `createChannelRegistry`
- [ ] C5 `features/common/tab-event-bus.ts` → `services/tab-event-bus.ts`
- [ ] C6 `features/common/ota/trusted-hotel-url.ts` → `channels/trusted-hotel-url.ts`
- [ ] C7 `main/server/` → `main/server-client/`
- [ ] C8 mock gateway → `main/gateway/rms/`；`ports/rms-gateway.ts` → `main/gateway/rms/types.ts`（**接口保留**）
- [ ] C9 同步更新所有 import 路径与测试文件路径
- [ ] C10 门禁

## D 批 — 补齐 service 层（必须在 E 批之前）

- [ ] D1 新建 `services/calendar-service.ts`，`calendar-handlers` 改为依赖它而非 `CalendarRepository`
- [ ] D2 新建 `services/cookie-import-service.ts`，接管 `browser-handlers.ts:142-179` 那 30 行编排
- [ ] D3 新建 `services/system-service.ts`，接管 `systemPreferences()` 与 `setLoginItemSettings`（把 `electron.app` 移出 ipc 层）
- [ ] D4 新建 `services/auth-service.ts`，接管 `auth-handlers.ts:64-90` 的 tRPC 调用、`safeCall` 错误映射、登出事务
  - **重点**：登出是「先调远端、再清本地 session cookie」的有序事务，抽出后单独写测试断言这个顺序
- [ ] D5 `OtaCredentialService` 补 `listByChannel`，`browser-handlers.ts:140` 改为走它
- [ ] D6 拆 `browser-handlers.ts` 为 4 个：`browser-handlers` / `cookie-handlers` / `ota-credential-handlers` / `system-handlers`
- [ ] D7 handler 依赖一律用**本文件声明的窄接口**表达，不 import service 实现类（沿用 `HotelManagementOrchestrator` 既有模式）
- [ ] D8 验证：`grep -rn "Repository\|database/\|file-store/\|cookie-import/\|server-client/" main/ipc/` 应无结果
- [ ] D9 门禁

## E 批 — 拆掉 domain（D 批完成后才能做）

- [ ] E1 `domain/identity.ts` → `main/ids.ts`（**逻辑全部保留**，design §5.4）
- [ ] E2 解散 `domain/policy/`（design §5.3）：
  - `partition-policy.ts` → `main/browser/partition.ts`
  - `cookie-scope-policy.ts` → `main/cookie-import/cookie-scope.ts`
  - `ota-channel-landing-url-policy.ts` → `main/channels/landing-url.ts`
  - `startup-automation-policy.ts` → `main/config.ts`
- [ ] E3 `domain/ota-bind-extra.ts` → `main/channels/bind-extra.ts`
- [ ] E4 纯类型迁至 `shared/types/`：`ota-hotel` / `ota-credential` / `rms-hotel` / `rms-ota-account` / `calendar` / `json`
- [ ] E5 **删除 4 个 `createXxx` + 4 个 `InvalidXxxError`**（校验是死代码，design §5.1）；repository 的 `create()` 直接返回入参对象
- [ ] E6 **删除 `domain/ports/repositories.ts`**，三个 service 改为依赖具体 `SqliteXxxRepository` 类
- [ ] E7 删除 `domain/` 空目录
- [ ] E8 处置 `cookie-scope.ts`：`isCookieHostInScope` 当前**无生产调用方**（仅测试引用）。先查清 `browser-cookie-importer.ts` 现在怎么过滤域名 —— 若其域名过滤确有缺陷（注释称此函数是「D2 的修复：此前会把小红书/抖音/淘宝 cookie 一并读走」），则接回去；否则连测试一并删除。**结论写进 `verification.md`**
- [ ] E9 修复或删除 `shared/calendar.ts` 的 `AssertExtends` —— 当前 `[A,B] extends [B,A] ? true : true` 两分支同值、永不报错。改为真正的双向 extends 检查，或直接删掉这段假守卫
- [ ] E10 检查其余 `shared/*.ts` 有无同款失效守卫
- [ ] E11 测试文件从 `tests/unit/domain/` 迁至对应新路径
- [ ] E12 门禁

## F 批 — ota-tab 独立与拆分

- [ ] F1 `main/services/ota-tab-opener/` → `main/ota-tab/`
- [ ] F2 拆为 `ota-tab-service.ts`（4 个 open 方法）+ `login-detector.ts`（订阅判定），衔接方式 `LoginDetector.register(tabId, channel)`
- [ ] F3 **保留时序约束**（design §6.4）：`tab:credential-checked` 必须等 `triggerDiscovery` 写库完成后广播。单独写回归测试断言广播发生在写库之后
- [ ] F4 新建 `main/ota-tab/index.ts`，只导出 `OtaTabService` 窄接口
- [ ] F5 删除 `BrowserManager.create()`（已无调用方，先 grep 确认）
- [ ] F6 重写 `ota-tab-opener.test.ts` → `ota-tab-service.test.ts` + `login-detector.test.ts`，砍掉 mock 组合矩阵，每行为 1 happy path + ≤2 边界
- [ ] F7 门禁 + `npm run test:e2e:desktop`

## G 批 — composition root 拆分（最后做，前面所有改动都影响装配代码）

- [ ] G1 新建 `main/composition/app-scope.ts`：进程级依赖（database / repositories / gateways / sessionFactory）+ `dispose()`
- [ ] G2 新建 `main/composition/window-scope.ts`（design §6.1），`disposers` 逆序清理
- [ ] G3 抽出 `wire-ota.ts` / `wire-hotel-management.ts` / `wire-calendar.ts`
- [ ] G4 新建 `main/index.ts`：只保留 app 事件绑定（squirrel / whenReady / window-all-closed / activate / will-quit），**不含任何 `new`**
- [ ] G5 删除 `main/application.ts`；更新 forge / vite 配置里的 main 入口路径
- [ ] G6 确认清理路径唯一：原 `closed` 与 `will-quit` 两份不一致的清单已合并（原先 `discoverAndCreate` 只在 `will-quit` 清理）
- [ ] G7 门禁

## H 批 — eslint 强制边界

- [ ] H1 配置 `import/no-restricted-paths`：
  - `main/ipc` ✗→ `main/database`、`main/file-store`、`main/cookie-import`、`main/browser`、`main/server-client`
  - `main/services` ✗→ `main/browser`、`electron`
  - `main/channels` ✗→ `main/services`
  - `main/ids.ts` ✗→ `electron`、`zod`、`better-sqlite3`、`node:fs`
  - `renderer` ✗→ `main/**`
- [ ] H2 为 design §3 的两条已知例外配置豁免，并在 eslint 配置里注释原因
- [ ] H3 删除 `ota-tab-service.ts` 里手写的「架构约束：不 import browser-manager 实现」注释 —— 已由 H1 强制
- [ ] H4 门禁

## I 批 — preload 拆分

- [ ] I1 新建 `preload/invoke.ts`：`invokeValidated` / `subscribeValidated`
- [ ] I2 拆 `preload/namespaces/`：auth / automation / browser / calendar / cookies / hotel-management / ota-credential / ota-tab / system，各导出 `createXxxApi(invoke, subscribe)`
- [ ] I3 `preload/api.ts` 收敛为组装函数；`DesktopApi` 类型改为由实现推导，删除手写大类型
- [ ] I4 重写 `unit/preload/api.test.ts`：只留「schema 校验拦截非法返回值」与「不泄露 token」两个核心断言，其余按 namespace 各留 1 个
- [ ] I5 门禁

## J 批 — 收尾

- [ ] J1 写 `verification.md`：A1 基线对照、各批门禁结果、E2E 结果、E8 结论、测试行数前后对比
- [ ] J2 在 `apps/desktop/AGENTS.md` 写入分层准入标准表（design §3）与已知例外
- [ ] J3 同步更新根 `AGENTS.md` 与 `CLAUDE.md` 中与目录结构相关的描述（两份措辞对齐）；**移除 domain 相关表述**（编程约束一节现有「`src/domain/` 零框架依赖」条款需改写为针对 `main/ids.ts`）
- [ ] J4 本次涉及架构与模块边界变化 → 触发完成门禁，同步 `openspec/specs/` 对应 capability
- [ ] J5 `docs/arch/2026-08-03-final-architecture.md` 若与新结构冲突，更新或标注被取代

---

## 未纳入本次范围

| 项 | 原因 |
|---|---|
| renderer 侧统一 data-source（消除页面直连 `window.hotelButler`） | 属 renderer 内部结构，本次不动 |
| `gateway/rms/` 真实远端实现 | 属业务开发，非结构调整 |
| 按运行环境组织 main（VS Code 的 `common/node/electron-main` 模式） | 当前规模不需要；若将来主进程代码需在 node 侧复用再考虑 |
