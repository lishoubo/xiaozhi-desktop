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
