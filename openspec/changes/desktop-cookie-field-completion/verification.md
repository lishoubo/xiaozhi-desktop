# 验证证据

**验证日期**：2026-09-07
**验证环境**：macOS / Electron 43.2.0 / Chrome 150.0.7871.129 / desktop dev 环境（本机 rms-server）

---

## 一、自动化验证

| 项目 | 命令 | 结果 |
|---|---|---|
| 全量单测 | `npx vitest run --config vitest.unit.config.mts` | **841 passed (108 files)** |
| 受影响模块 | 见下表 | 110 passed |
| 类型检查 | `tsc --noEmit --project tsconfig.node.json` | 通过（exit 0） |
| Lint（含分层边界） | `npm run lint` | 通过（exit 0） |

受影响模块明细：

| 测试文件 | 用例数 |
|---|---|
| `cookie-snapshot/to-snapshot-entry.test.ts` | 19（新增） |
| `cookie-snapshot/cdp-source.test.ts` | 9（新增） |
| `cookie-snapshot/collect-cookie-snapshot.test.ts` | 6（新增） |
| `browser-manager-partitions.test.ts` | 16（含新增 4） |
| `browser-manager.test.ts` | 32 |
| `hotel-management-service.test.ts` | 18 |
| `rms-ota-account-gateway-http.test.ts` | 8 |
| `window-capability-registry.test.ts` | 2 |

---

## 二、真机验证（抖音绑定）

**操作**：dev 环境绑定抖音账号 → 选定门店「Alan·银际酒店(九原区政府店)」→ 确认。

采集日志（原文）：

```
12:28:54.147 › Cookie snapshot collected { source: 'cdp', count: 56, partitionedCount: 0 }
12:28:54.150 › RMS HTTP request started  { endpointPath: '/api/v1/app/ota-accounts', method: 'POST' }
12:28:54.302 › RMS HTTP request completed{ endpointPath: '/api/v1/app/ota-accounts', method: 'POST', status: 200 }
```

### 验收项对照

| 验收项 | 期望 | 实测 | 结论 |
|---|---|---|---|
| 采集方式 | CDP，无降级 | `source: 'cdp'`，无 `degraded` 日志 | ✅ |
| 每条含 `secure`/`httpOnly`/`sameSite`/`expires` | 是 | 是 | ✅ |
| 快照条数 | 40~50 | 56 | ✅ |
| 绑定流程 | 不因采集失败 | POST 200，门店入库 | ✅ |
| **CHIPS 分区 cookie** | **≥10 条** | **0 条** | ❌ 见第三节 |
| `ttwid` ≥2 条 | 待观察项 | 未达成（design 已列为非硬性目标） | ⚠️ |

**结论**：字段补齐目标达成，分区 cookie 目标未达成，原因见下。

---

## 三、分区 cookie 为 0 的根因（已定位，非本次代码缺陷）

### 排查过程

**① 先排除采集代码**——直接查 desktop partition 的 cookie 数据库：

```sql
-- partition: xiaozhi:dev:douyin:3807854c
select count(*) from cookies;                          -- 53
select count(*) from cookies where top_frame_site_key != '';  -- 0
```

磁盘上就没有分区 cookie，CDP 如实上报了浏览器拥有的全部。

**② 再验证 `Network.getAllCookies` 的能力**——在探针 partition（磁盘确认有 13 条分区
cookie）上，**不登录、不导航**（仅 `about:blank`）跑同一条命令：

```
=== Network.getAllCookies 结果 ===
总条数: 37
分区条数: 13
 sessionid_ls | .life.douyin.com | {"hasCrossSiteAncestor":false,"topLevelSite":"https://douyin.com"}
 sid_tt_ls    | .life.douyin.com | {"hasCrossSiteAncestor":false,"topLevelSite":"https://douyin.com"}
 ...（13 条全部取到，partitionKey 完整）

=== 对照 session.cookies.get({}) ===
总条数: 37
有 partitionKey 字段的: 0
```

**关键结论**：`Network.getAllCookies` 与浏览路径、页面停留位置**无关**，罐子里有就能取到。
采集侧无问题。

**③ 定位到写入侧**——对比两个 partition 的 `.life.douyin.com` cookie 名单：

| | 登录票据份数 |
|---|---|
| 探针 partition | 每个名字**两份**（`sessionid_ls` ×2、`sid_tt_ls` ×2 …）一份普通、一份带分区键 |
| desktop partition | 每个名字**一份**，全是普通 |

抖音**下发了** `Partitioned` cookie，但 desktop 会话没有存。

**④ 找到差异根源**——查两边的 canary cookie 与 DIPS 访问记录：

```sql
-- 探针 partition：canary 有 4 条（2 普通 + 2 分区）
is_hit_partitioned_cookie_canary | .life.douyin.com | (空)
is_hit_partitioned_cookie_canary | .life.douyin.com | https://douyin.com   ← 分区

-- desktop partition：canary 只有 2 条，全无分区键
```

```
DIPS（浏览器记录的顶级站点）
  探针 partition  : douyin.com
  desktop partition: （空）
```

### 根因

**CHIPS 分区 cookie 只在顶级站点为 `douyin.com` 时写入。**

| | 顶级站点轨迹 | 分区 cookie |
|---|---|---|
| 探针 | 登录重定向经过 `douyin.com` | 13 条 |
| desktop 绑定 | 全程 `life.douyin.com` | 0 条 |

desktop 的抖音落地页写死为 `life.douyin.com/p/login`（`main/channels/landing-url.ts`），
登录后跳 `life.douyin.com/p/home?groupid=...`，顶级站点**始终是 `life.douyin.com`**，
从未变成 `douyin.com`。抖音下发的 `Partitioned` cookie 因此找不到对应的分区上下文。

### 待服务端确认的问题

**RPA 写回 cookie 后，是在哪个顶级站点下操作的？**

- 若同样在 `life.douyin.com` 下操作 → 分区 cookie 不会被携带，RPA 用不上，
  服务端「CHIPS ≥10 条」的验收项是基于其自身登录路径定的，不适用于 desktop
- 若需要 `douyin.com` 上下文 → desktop 需改登录落地页使流程经过 `douyin.com`，
  但这会触及已稳定的登录判定逻辑（`douyinLoginUrlMatcher` 要求 `/p/home` 且带
  `groupid`），属独立变更，需单独评估

---

## 四、本次改动的实际收益

即使分区 cookie 未达成，相对改造前仍是实质改善：

| | 改造前 | 本次 |
|---|---|---|
| 每条字段数 | 3（`name`/`value`/`domain`） | 最多 9 |
| 有效期 | **全部缺失** → 远端当作会话 cookie | 完整上送 `expires` |
| `sameSite` | 缺失 → 浏览器按默认 `Lax` 处理 | 完整上送 |
| 条数 | 44 | 56 |

服务端原判断「44/44 全是会话 cookie、无长期有效期」是最可能的掉线主因，该项已修复。
分区 cookie 是独立问题，不阻塞本次发布。

---

## 五、遗留事项

- [ ] 服务端跑只读核验工具比对本次快照，确认字段落库正确
- [ ] 观察 24 小时是否复发 `LOGIN_EXPIRED`（最终验收标准）
- [ ] 与服务端确认 RPA 的顶级站点上下文，据此决定是否需要单独处理分区 cookie
- [ ] `ttwid` 条数（design Open Questions，非硬性目标）
- [ ] 未观察到降级采集（`degraded: true`），故 design 中「是否需要重试策略」暂无数据支撑，维持现状
