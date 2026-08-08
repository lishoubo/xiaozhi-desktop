# 验证记录

## A1 — 重构前基线（2026-08-08，分支 `refactor/main-layers`，起点 commit `6d1293d`）

**全部为真实命令输出，未经修饰。**

| 套件 | 命令 | 结果 |
|---|---|---|
| desktop unit | `npm run test:unit:desktop` | ✅ **55 文件 / 253 测试全绿**，1.63s |
| packages/api unit | `npm run test:unit:api` | ✅ 1 文件 / 11 测试全绿 |
| desktop component | `npm run test:component` | ❌ **1 文件失败 / 10 通过；2 测试失败 / 39 通过** |
| server unit | `npm run test:unit:server` | ❌ 14/15 文件通过，36 测试通过，**1 个 Unhandled Error** |
| desktop E2E | `npm run test:e2e:desktop` | ❌ **8 个场景全部失败**（各超时 30s） |

### 失败项归因（均为重构前既有状态，非本次改动引入）

**1. server unit —— 与本次重构无关**
```
Error: browserType.launch: Executable doesn't exist at
/Users/lishoubo/Library/Caches/ms-playwright/chromium_headless_shell-1234/...
```
Playwright 浏览器未安装。属环境问题，不在本次范围。

**2. desktop component —— 2 个失败**
重构前即为红色状态。此事实同时佐证了删除决定（长期红着无人处理）。

**3. desktop E2E —— 8 个全部失败**
根因：E2E 依赖一整套外部环境，当前全部未启动：
- `playwright.config.ts` 的 `webServer` 需要 server 构建并预览于 `https://localhost:4173`
- `globalSetup` 需要 PostgreSQL 容器（`e2ePostgresHostPort`）与 MySQL/RMS 容器（`e2eRmsHostPort`）
- 需先执行 `npm run https:setup` 生成本地 HTTPS 证书

失败表现为 8 个场景各超时 30s、定位器找不到元素 —— 应用未能启动的典型症状，
而非单个断言失效。

### 对验收标准的影响（已与用户确认）

design §9 原将「E2E 8 场景全绿」列为唯一验收标准，但该套件在重构前即无法运行。

**用户决策（2026-08-08）：采纳方案 C** —— 重构期间以「TypeScript 类型检查 + desktop
unit 253 测试」为回归保护，全部批次完成后再搭建 E2E 环境做一次性最终验收。

因此本次重构的**过程门禁**调整为：
```
npm run check:desktop && npm run lint:desktop && npm run test:unit:desktop
```
其中 `test:unit:desktop` 必须保持 **253 测试全绿**（减去本次主动删除的用例后的对应数值）。

E2E 最终验收记录见本文件末尾「最终验收」一节。

---

## A 批 — 测试瘦身（已完成）

### 删除内容

| 对象 | 规模 |
|---|---|
| `tests/component/` 整目录 | 11 文件 / 1133 行 |
| `tests/setup/component.ts` | component 专用 setup，删除后无引用 |
| `vitest.component.config.mts` | 1 个配置 |
| `tests/unit/main/logging.test.ts`、`ipc-logging.test.ts` | 361 行（后者含 50 处 mock） |
| `tests/unit/renderer-font.test.ts`、`renderer-logging.test.ts` | 68 行 |
| `package.json` 脚本（根 + desktop） | `test:component`、`test:component:watch` 及 `test`/`test:coverage` 中的引用 |
| devDependencies | `@testing-library/jest-dom`、`@testing-library/svelte`、`@testing-library/user-event`、`jsdom`（删除前已确认全项目零引用） |

### A7 门禁结果（真实输出）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm run check:desktop` | ✅ `COMPLETED 821 FILES 0 ERRORS 0 WARNINGS` |
| lint | `npm run lint:desktop` | ✅ 无输出（无违规） |
| unit | `npm run test:unit:desktop` | ✅ **51 文件 / 241 测试全绿**，1.28s |

测试数变化：253 → 241（−12，即 4 个已删 unit 文件所含用例）；文件数 55 → 51。

**新基准线：241 测试全绿。** 后续每批门禁以此为准。

E2E 未跑（按方案 C，留待最终验收）。

---

## B–I 批门禁结果

每批均执行 `npm run check:desktop && npm run lint:desktop && npm run test:unit:desktop`，
全部通过后才进入下一批。以下为各批完成时的真实测试数：

| 批次 | commit | 测试数 | 说明 |
|---|---|---|---|
| A 测试瘦身 | `d96485f` | 51 文件 / 241 | 删 1562 行测试 + 4 个依赖 |
| B IPC 样板收敛 | `65db320` | 52 文件 / 245 | registry 新增 5 个用例，删 1 个重复的信任校验用例 |
| C 目录重划 | `f558299` | 52 文件 / 245 | 纯移动，用例数不变 |
| D service 补齐 | `f6ccc64` | 52 文件 / 245 | handler 测试改为注入 service |
| E 拆掉 domain | `af605ca` | 51 文件 / 237 | −8 为已删的 cookie-scope-policy 用例 |
| F ota-tab 拆分 | `c58ddd2` | 52 文件 / 239 | 11 个用例重组为 13 个 |
| G+H composition + lint | `f499c08` | 52 文件 / 239 | 新 lint 规则抓到 1 处真实违规 |
| I preload 拆分 | `e29b4d7` | 52 文件 / 239 | 现有 preload 测试未改动即通过 |

类型检查全程 `0 ERRORS`（文件数 821 → 831，增量为新增的 preload namespace）。

## 计划外的发现与偏离

### 1. `createRmsHotel` / `createRmsOtaAccount` 不是死代码（design §5.1 判断有误）

design 原文称四个 `createXxx` 校验均为死代码。实测只有 `createOtaHotel` 成立：

| 函数 | 校验对象 | 结论 |
|---|---|---|
| `createOtaHotel` | `credentialId`（branded） | 死代码，已删 |
| `createOtaCredential` | `partitionName`（普通 string，会落磁盘） | **保留** |
| `createRmsHotel` | `id: number > 0`、`name` 非空 | **保留** |
| `createRmsOtaAccount` | `id`/`hotelId` 正数、`status` 非空 | **保留** |

branded 只保护 `ChannelId` / `OtaCredentialId` / `OtaHotelId` 这三类；
普通 number/string 字段仍需运行时校验。

### 2. `BrowserManager.create()` 未删除（tasks F5 偏离）

tasks 记为「已无调用方」。grep 后发现它仍被 `bindTabEvents` 的
`setWindowOpenHandler` 用于站内弹窗新开标签页（`browser-manager.ts:336`），
是真实用途，予以保留。原判断只查了外部引用，漏了类内部调用。

### 3. E8 结论：`isCookieHostInScope` 是重复实现，不是未修复的隐私缺陷

原担忧为「导入携程会把小红书/淘宝 cookie 一并读走」。实测
`cookie-import.ts` 的 `channelForCookieDomain` 只认三个域名
（`douyin.com` / `ctrip.com` / `meituan.com`），且带点比较子域
（`normalized.endsWith('.' + supported)`）——`evilctrip.com` 防护同样存在。

即：同一套子域匹配逻辑写了两遍，生产代码用的是 `cookie-import.ts` 那份，
`domain/policy/cookie-scope-policy.ts` 从未接入，仅测试引用。已连同测试删除。

### 4. `shared/calendar.ts` 的编译期守卫此前完全无效

原实现 `type AssertExtends<A extends B, B> = [A, B] extends [B, A] ? true : true`
三元两个分支同为 `true`，条件不影响结果，永不报错。

改为 `Expect<MutuallyExtends<...>>` 后**当场报出三处 false**，排查为
`z.infer` 产出可变对象、而类型侧包了 `Readonly<>` 的形式差异，非字段不一致。
最终采用只比字段结构、不比 readonly 修饰的写法。

**已验证守卫真实有效**：向 `shared/types/calendar.ts` 临时插入 `bogus: string`
字段后，`tsc` 报 `src/shared/calendar.ts(80,10): error TS2344: Type 'false'
does not satisfy the constraint 'true'`；移除该字段后恢复 0 错误。

### 5. 新增 `main/startup/`（design 之外）

`ctrip-check-in-automation.ts`（开机用 CDP 抓携程入住时间）与
`startup-automation-policy.ts`（是否启用的 opt-in 开关）原本分处
`main/automation/` 与 `domain/policy/`。这个开关是**安全开关**——其文件头
注释记录了历史上默认开启导致「装上应用即在全局共享 session 上无审批地
对携程执行自动化」的问题。开关与被它控制的危险操作分开放，改动方看不到
这段理由，故归拢为 `main/startup/{enabled,ctrip-check-in}.ts`。

同时撤销 design 中「startup-automation-policy → main/config.ts」的方案：
`server-client/config.ts` 解析的是 server origin，与启动自动化无关，
「都读环境变量」不构成归为一类的理由。

## 最终结构

```
apps/desktop/src/
├── shared/            zod 契约 + IPC 通道名 + types/（纯类型与 branded id 类型）
├── main/
│   ├── index.ts       进程入口，74 行，无业务对象 new
│   ├── composition/   app-scope（进程级）+ window-scope（窗口级，disposers 逆序）
│   ├── ids.ts         标识符构造与校验
│   ├── repositories.ts
│   ├── services/      8 个业务编排
│   ├── ota-tab/       OtaTabService + LoginDetector + index.ts
│   ├── channels/      ctrip|douyin|meituan + types.ts + registry.ts
│   ├── gateway/rms/   接口 + mock
│   ├── server-client/ tRPC 传输层
│   ├── startup/       开机自动化及其开关
│   ├── ipc/           10 个 handler + create-handler-registry
│   └── browser/ database/ cookie-import/ file-store/ security/ windows/ logging/ calendar/
└── renderer/
```

`domain/` 与 `domain/ports/` 已删除。

测试 5477 行 / 源码 13103 行（0.42）。原始比例为 7501 / 12729（0.59）。
未达 design §8 预估的 0.28，原因是编排层测试实际重写量小于预估
（多数改为注入 service 后即可复用），且按「不额外补测试」的要求未新增用例。

## 待办：E2E 最终验收

按方案 C，E2E 留至全部批次完成后一次性验证。需先满足其运行前提：

```
npm run https:setup                    # 生成本地 HTTPS 证书
npm run compose:local                  # 启动 PostgreSQL + MySQL(RMS) 容器
npm run test:e2e:desktop
```

E2E 用例自始至终未作任何修改，可直接作为行为回归的判据。
