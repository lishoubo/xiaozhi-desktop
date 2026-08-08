# 重划 desktop main 分层 — 设计

> 本文已整合 `decisions-log.md` 的全部结论，为唯一现行版本。
> `decisions-log.md` 保留为决策依据与推翻记录，不再具有更高优先级。

## 1. 目标结构

```
apps/desktop/src/
├── shared/                    跨进程契约：zod schema + IPC 通道名 + 纯类型
│   ├── browser.ts  calendar.ts  hotel-management.ts  automation.ts
│   ├── ipc-channels.ts  logging.ts
│   └── types/                 ← 原 domain 的纯类型（OtaHotel / OtaCredential / Rms*）
│
├── main/
│   ├── index.ts               ← 进程入口：app 事件绑定，无任何 new
│   ├── composition/           ← 唯一允许 new 具体实现的地方
│   │   ├── app-scope.ts         进程级：db / repos / gateways / sessionFactory
│   │   ├── window-scope.ts      窗口级：window / browserManager / services / ipc
│   │   ├── wire-ota.ts
│   │   ├── wire-hotel-management.ts
│   │   └── wire-calendar.ts
│   ├── ids.ts                 ← branded id + 校验（原 domain/identity.ts）
│   ├── config.ts              ← 环境变量解析（含原 startup-automation-policy）
│   ├── services/              ← 业务编排
│   │   ├── calendar-service.ts            新增
│   │   ├── cookie-import-service.ts       新增
│   │   ├── system-service.ts              新增
│   │   ├── auth-service.ts                新增
│   │   ├── ota-credential-service.ts      原 DiscoverAndCreate
│   │   ├── ota-hotel-prob-service.ts      原 OtaHotelProbFeature
│   │   ├── hotel-management-service.ts    原 HotelManagementFeature
│   │   └── tab-event-bus.ts
│   ├── ota-tab/               ← OTA tab 唯一开口（能力门面，非 service）
│   │   ├── ota-tab-service.ts   四个 open 方法
│   │   ├── login-detector.ts    登录判定订阅者
│   │   └── index.ts             只导出窄接口
│   ├── channels/              ← 渠道适配器
│   │   ├── types.ts             LoginUrlMatcher / HotelProbe / Discovery 接口
│   │   ├── landing-url.ts       原 ota-channel-landing-url-policy
│   │   ├── trusted-hotel-url.ts
│   │   ├── registry.ts
│   │   └── ctrip/  douyin/  meituan/
│   ├── gateway/rms/           ← RMS gateway：接口 + mock + 真实实现（待写）
│   ├── server-client/         ← tRPC 传输层（原 main/server/）
│   ├── ipc/
│   │   ├── create-handler-registry.ts
│   │   └── *-handlers.ts
│   ├── browser/               browser-manager / session-factory / partition.ts
│   ├── cookie-import/         importer / store / cookie-scope.ts
│   ├── database/  file-store/  security/  windows/  logging/  calendar/
└── renderer/
```

`domain/` 与 `domain/ports/` 目录消失。

## 2. 依赖方向

```
                    renderer
                       │ window.hotelButler
                       ▼
                    preload  ──────────────┐
                       │ ipcRenderer       │ 都只依赖
                       ▼                   ▼
                   main/ipc  ─────────► shared/（zod 契约 + 纯类型）
                       │ 只调 service              ▲
                       ▼                           │
        ┌──────── main/services ───────────────────┤
        │              │                           │
        │              ▼                           │
        │        main/ota-tab                      │
        │              │                           │
        │              ▼                           │
        ├───► main/browser  database  gateway/rms  server-client
        │              ▲                    ▲
        │              │                    │
        └──► main/channels ──► channels/types.ts
                                   main/ids.ts（谁都可以用）
                                            ▲
                              main/composition ──► main/index.ts
```

硬规则：**`ipc/` 只能调 `services/`；`services/` 不能 import `electron`；`channels/` 不能 import `services/`。**

## 3. 分层准入标准

| 目录 | 准入标准 | 禁止 |
|---|---|---|
| `shared/` | 跨 preload 边界传输的契约与类型 | 会抛异常的构造器、主进程专用工具 |
| `services/` | 类名 `XxxService`，方法名是业务动作 | `electron`、`ipcMain`、直接 new 依赖 |
| `ota-tab/` | OTA tab 的唯一开口 | 被 `services/` 之外的模块 import |
| `channels/` | 单渠道适配器，实现 `channels/types.ts` | import `services/` |
| `ipc/` | 信任校验 → 参数校验 → 调**恰好一个** service 方法 → 错误转换 | `database/` `file-store/` `cookie-import/` `browser/` `server-client/`；`electron.app`（`ipcMain` 除外）；任何业务逻辑 |
| `composition/` | 唯一允许 `new` 具体实现的地方 | 业务逻辑、渠道知识 |
| `ids.ts` | branded id + 校验 | 任何框架依赖（eslint 单独锁） |

已知例外（记录在案，不得作为新破例的先例）：

| 例外 | 原因 |
|---|---|
| `OtaHotelProbService` import `WebContents` 类型 | 探测需要页面句柄；仅类型引用，不调 electron API |
| `ota-tab/` import `browser/browser-manager` | 它是 BrowserManager 的门面，这是其职责本身 |

## 4. 决策表

| # | 决策 | 备选 | 结论 |
|---|---|---|---|
| 1 | `features/` 更名 | `use-cases/` / `application/` | **`services/`**。features 在前端语境=含 UI 的垂直切片，与实际不符 |
| 2 | `channels/` 位置 | 嵌进 `services/` | **与 `services/` 平级**。依赖方向是 channels→接口←services；且 `ota-tab/` 不是 service，嵌套会导致下层反向依赖上层 |
| 3 | `OtaTabOpener` 归属 | 留在 `services/` | **独立 `ota-tab/`**。它需要 `WebContents`/`BrowserManager`，不满足 service 准入 |
| 4 | `OtaTabOpener` 是否拆分 | 保持单类 | **拆为 `OtaTabService` + `LoginDetector`**。一个类同时是链路入口和中继站，是「定位说不清」的根因 |
| 5 | `application.ts` 拆法 | 只拆 wire 函数 | **按生命周期拆 app-scope / window-scope**。根因是没有 scope 抽象而非行数多 |
| 6 | **`domain/` 去留** | 保留 / 瘦身保留 | **删除**。四个 `createXxx` 校验是死代码（见 §5），该层在本项目未提供实际约束 |
| 7 | **`ports/` 去留** | 全保留 | **删除，两处例外**（见 §5.2）。接口价值来自当下存在多个实现，不是「将来可能换」 |
| 8 | **`identity.ts` 命名与位置** | `shared/identity.ts` / 拆概念文件 | **`main/ids.ts`**。`identity.ts` 无业内先例；`toChannelId()` 会抛异常，不放 shared |
| 9 | **`policy/` 去留** | 改名 `rules/` | **解散**，按调用方就近放置（见 §5.3） |
| 10 | `adapters/` 命名 | `remote/` | **`gateway/rms/`**。项目内 `RmsHotelGateway` 类名已用此词；mock 不在远端，`remote/` 语义不符 |
| 11 | `main/server/` 命名 | 保持 | **`server-client/`**。与 `apps/server/` 易混；它是「访问 server 的客户端」 |
| 12 | `domain/` 与 `shared/` 合并 | 合并 | **不合并**（domain 已删，此项自然消解）。实测 6 个 shared 文件仅 calendar 一个真重复 |
| 13 | calendar 是否包 service | handler 直连 repository | **包 `CalendarService`**，即便 4 个方法是纯转发。只要允许一个例外，lint 规则就无法强制 |

## 5. domain 拆解方案

### 5.1 为什么删

四个 `createXxx` 构造器的校验是**死代码**：

```ts
// domain/ota-hotel.ts（49 行），唯一的"规则"：
export function createOtaHotel(input: OtaHotelCreateInput): OtaHotel {
  if (input.credentialId.length === 0) throw new InvalidOtaHotelError('credentialId 不能为空');
  return { ...逐字段拷贝... };
}
```

`credentialId: OtaCredentialId` 是 branded type，只能由 `toOtaCredentialId()` 产生，
而那个函数已校验非空 → **该分支永远不可达**。
`ota-credential.ts` / `rms-hotel.ts` / `rms-ota-account.ts` 同一模子，四文件约 165 行净产出为零。

桌面端的复杂度在**集成**（窗口/cookie/session/抓取/进程边界），不在业务规则本身，
不存在需要充血模型的 core domain。

### 5.2 逐文件去向

| 原文件 | 行 | 去向 |
|---|---|---|
| `identity.ts` | 86 | → `main/ids.ts`（**保留全部逻辑**，见 §5.4） |
| `ota-hotel.ts` `ota-credential.ts` `rms-hotel.ts` `rms-ota-account.ts` | 153 | 类型 → `shared/types/`；**删 4 个 `createXxx` + 4 个 `InvalidXxxError`** |
| `calendar.ts` `json.ts` | 53 | 类型 → `shared/types/` |
| `ota-bind-extra.ts` | 19 | → `main/channels/bind-extra.ts`（渠道知识） |
| `policy/*.ts` | 122 | 见 §5.3 |
| `ports/repositories.ts` | 48 | **删除**。三个 Repository 各只有 1 个实现；文件头注释所述前提（rms 接管后数据权威挪云端）经确认**不会发生** |
| `ports/rms-gateway.ts` | 40 | → `main/gateway/rms/types.ts`。**保留接口**：mock + 真实实现两个实现并存 |
| `ports/discovery.ts` | 14 | → `main/channels/types.ts`。**保留接口**：三个渠道各一实现 |
| `features/ota-hotel-prob/hotel-prob-port.ts` | — | → `main/channels/types.ts`。同上 |

### 5.3 policy/ 解散去向

| 原文件 | 新位置 | 依据 |
|---|---|---|
| `partition-policy.ts` | `main/browser/partition.ts` | 三个调用方中两个在 `browser/` |
| `cookie-scope-policy.ts` | `main/cookie-import/cookie-scope.ts` | 本应被该模块调用（当前是死代码，见 §7） |
| `ota-channel-landing-url-policy.ts` | `main/channels/landing-url.ts` | 本就是渠道知识 |
| `startup-automation-policy.ts` | `main/config.ts` | 18 行、读一次 env、单一调用方 |

去掉 `-policy` 后缀，按主题命名。

### 5.4 为什么 ids.ts 必须保留

`identity.ts` 的校验是**真约束**，与四个 `createXxx` 性质完全不同：

```
标识符 → 拼进 partition 名 → 落到磁盘 → persist: 分区永不自动清理
```

- 空串 → 用户磁盘留下永久坏目录
- 大小写混用 → macOS（文件系统大小写不敏感）通过，Linux 失败

调用方全在主进程（browser-manager / session-factory / cookie-import / database /
channels / ipc），**renderer 零引用** → 放 `main/`，不放 `shared/`。

## 6. 关键代码骨架

### 6.1 `composition/window-scope.ts`

```ts
export type WindowScope = Readonly<{ window: BrowserWindow; dispose(): void }>;

export function createWindowScope(app: AppScope): WindowScope {
  const disposers: (() => void)[] = [];
  const track = <T>(value: T, dispose: () => void): T => {
    disposers.push(dispose);
    return value;
  };

  const window = createMainWindow();
  const browserManager = track(
    new BrowserManager(window, app.logger, app.sessionFactory),
    () => browserManager.destroy(),
  );

  wireOta({ app, window, browserManager, track });
  wireCalendar({ app, window, track });
  wireHotelManagement({ app, window, track });

  return {
    window,
    dispose() {
      for (const d of disposers.reverse()) d();   // 逆序，单一清理路径
    },
  };
}
```

消除：15 行 `unregisterXxx?.(); unregisterXxx = null;`、5 个 `if (!x) throw '...not initialized'`、
`closed` 与 `will-quit` 两份**不一致**的清理清单（现状 `discoverAndCreate` 只在 `will-quit` 清理）。

### 6.2 `ipc/create-handler-registry.ts`

```ts
type HandlerRegistry = Readonly<{
  handle<A extends unknown[]>(
    channel: string,
    argumentsSchema: ZodType<A>,
    invalidInputMessage: string,
    listener: (...args: A) => unknown,
  ): void;
  dispose(): void;
}>;

export function createHandlerRegistry(
  options: Readonly<{ window: Readonly<{ webContents: unknown }>; logger: AppLogger }>,
): HandlerRegistry;
```

信任校验（`event.sender !== window.webContents`）现复制在 **6 个文件**里 ——
安全代码重复，漏改一处即漏洞。收敛后一份实现、一份测试。

### 6.3 `channels/registry.ts`

```ts
export type ChannelAdapter = Readonly<{
  channel: ChannelId;
  loginUrlMatcher: LoginUrlMatcher;
  discovery: Discovery;
  hotelProbe: HotelProbe;
}>;

export function createChannelRegistry(logger: AppLogger): ReadonlyMap<ChannelId, ChannelAdapter>;
```

新增渠道 = 建 `channels/<name>/` + `registry.ts` 加一行。不碰 service、不碰 composition。

### 6.4 `ota-tab/` 拆分

```ts
// ota-tab-service.ts —— 意图 → partition 策略 → BrowserManager
export class OtaTabService {
  open(env, channel, url): Promise<BrowserTab>;              // 新建账号
  createFromCookie(env, channel, url): Promise<BrowserTab>;  // 导入 cookie 登录
  openExisting(credentialId, intent?): BrowserTab;           // 打开已有账号
  openView(channelId, url): BrowserTab;                      // 仅查看
}

// login-detector.ts —— 订阅 tab:navigated，判定登录 → 触发探测 → 广播
export class LoginDetector {
  register(tabId: string, channel: ChannelId): void;
}
```

**必须保留的时序约束**（历史踩坑，见 `split-ota-hotel-prob-feature`）：
`tab:credential-checked` 必须等 `triggerDiscovery` 写库完成后才广播。提前广播会让
`OtaHotelProbService` 查到 null 并永久错过探测机会（携程场景下标签页只导航一次）。

### 6.5 远端访问分层

```
services/  ──► gateway/rms/types.ts（接口）
                     ▲
                     │ 实现
              gateway/rms/*-gateway.ts  ──使用──► server-client/trpc-client.ts
                                                        │
                                                        ▼
                                                 packages/api（共享 contract）
```

传输层独立于 `gateway/rms/` 的理由：`AuthService` 也要用它，有两个消费者。

## 7. IPC 层直连基础设施 — 违规清单

| # | 位置 | 依赖 | 性质 |
|---|---|---|---|
| 1 | `calendar-handlers.ts:51-63` | `CalendarRepository`，4 个 channel 全直接转发 | 纯 CRUD 转发 |
| 2 | `browser-handlers.ts:140` | `OtaCredentialRepository.listByChannel` | 单查询转发 |
| 3 | `browser-handlers.ts:142-179` | `BrowserCookieImporter` + `store` + `cookie-import` | **30 行业务编排** |
| 4 | `auth-handlers.ts:64-90` | `TRPCClient` + `safeCall` 错误映射 + 登出清 cookie | **远端调用与事务** |

第 4 条尤其需要抽出：登出是「先调远端、再清本地 cookie」的有序事务（`finally` 里的
`cookies.remove`），漏掉即「远端已登出但本地 cookie 仍在」。写在 handler 里无法单独测试。

**顺序约束**：删 ports 与补 service 必须同批完成。现状 `calendar-handlers.ts:3` import
的是接口；若先删 ports 而不补 service，会退化成 import `SqliteCalendarRepository` ——
IPC 层直接依赖 SQLite 实现类，比现状更糟。

## 8. 测试策略

现状 7501 行测试 / 12729 行源码（0.59）。目标约 3600 行（0.28）。

| 处置 | 范围 | 行数 | 理由 |
|---|---|---|---|
| **保留** | `unit/domain/*`（迁至新路径）、渠道解析、持久化、cookie 导入解析、安全边界配置 | ~2800 | 锁的是**外部现实**：渠道响应格式、DB schema、Electron 安全配置 |
| **保留** | `e2e/app.spec.ts`（8 场景） | 428 | 唯一端到端证据，**不修改**，作为验收基线 |
| **删除** | `tests/component/` 全目录（11 文件） | 1133 | 锁 CSS 常量 / 文案 / `data-*` 属性 / jsdom 时序；`AppRouting` 44 处 mock 且与 E2E 重复 |
| **删除** | `logging.test.ts`、`ipc-logging.test.ts`（50 处 mock）、`renderer-font`、`renderer-logging` | ~880 | 锁日志文案与字体栈字符串，最脆的一类断言 |
| **重写** | 编排层：ota-tab-opener / discover-and-create / browser-manager×2 / 各 handlers / preload api | 1929 → ~800 | 4 份 handler 测试合并为 1 份 registry 测试 |

已识别问题：`shared/calendar.ts` 的 `AssertExtends<A, B> = [A, B] extends [B, A] ? true : true`
两分支同值，**永不报错** —— 无效守卫，给出类型安全的错觉。

## 9. 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | E2E 8 场景全绿，用例未修改 | `npm run test:e2e:desktop` |
| 2 | 类型检查与 lint 通过 | `npm run check:desktop && npm run lint:desktop` |
| 3 | 分层约束可执行 | eslint `import/no-restricted-paths` 报错而非注释约定 |
| 4 | `main/index.ts` 无任何 `new` | 人工 review |
| 5 | `main/ipc/` 无任何 repository / 基础设施 import | grep + lint |
| 6 | 无行为变更 | 上述 1-2 + 保留的 unit 测试全绿 |
