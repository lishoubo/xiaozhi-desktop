# 验证记录

> 日期：2026-09-09 ｜ 分支：`dev`

## 结论

**自动化验证与真机验证均已通过，端到端联调成功。**

统一改价页在 desktop 内正常渲染（房型 × 日期网格），说明服务端 `server-feedback.md` §2
的需求**已经落地**。剩余未验证项见 §2.2。

---

## 1. 已执行并通过

| 项 | 命令 | 结果 |
|---|---|---|
| 全量单测 | `npx vitest run --config vitest.unit.config.mts` | **888 passed / 112 files**，0 失败 |
| 分层边界 lint | `npx eslint src --ext .ts,.svelte` | exit 0，无输出 |
| 主进程/共享类型 | `npx tsc --noEmit -p tsconfig.json` | 无新增错误（既有 15 条见 §3） |
| 渲染层类型 | `npx svelte-check --threshold error` | 无新增错误（既有 1 条见 §3） |

### 本次新增的 41 条用例

| 文件 | 条数 | 守什么 |
|---|---|---|
| `tests/unit/build/rms-web-origin.test.ts` | 9 | web 地址取值优先级、回落、HTTPS 强制与豁免 |
| `tests/unit/main/internal-page-url.test.ts` | 7 | URL 拼装；**不带 refreshToken / hotelId** |
| `tests/unit/renderer-internal-channel-entry.test.ts` | 8 | 内部页面与 OTA 列表的隔离 |
| `tests/unit/main/internal-page-login-guard.test.ts` | 11 | ⭐ 会话过期拦截的完整决策链（方案 E） |
| `tests/unit/main/browser-manager.test.ts`（追加 3 条） | 3 | 守卫确实挂在 `will-navigate` 上、非法 URL 不问守卫 |
| `tests/unit/main/partition-cleanup.test.ts`（追加 2 条） | 2 | ⭐ partition 不被孤儿回收、命名恰为 4 段 |
| `tests/unit/main/channel-registry.test.ts`（追加 1 条） | 1 | `xiaozhi` 未注册为渠道 |

### ⭐ 反向验证：partition 守卫确实有效

不是只跑绿就完事 —— 把 `INTERNAL_PAGE_PARTITION` **故意改成 5 段**
（`persist:xiaozhi:dev:internal:pricing`）后复跑：

```
❯ tests/unit/main/partition-cleanup.test.ts (14 tests | 2 failed)
```

两条断言如期失败，随后已改回 4 段并复跑通过（14/14）。这条守的是「用户数据每次启动
被静默清空」，一个永远不会失败的测试等于没有。

### ⭐ 反向验证：导航守卫确实接在 `will-navigate` 上

同样不只看绿灯。把 `browser-manager.ts` 里调用守卫那两行**故意注释掉**后复跑：

```
❯ tests/unit/main/browser-manager.test.ts (35 tests | 1 failed)
```

接线用例如期失败，随后已恢复并复跑通过（35/35）。

### 构建期取值实测（对真实 PROFILES，非 mock）

```
dev   : http://localhost:5173     ← rms-admin dev server
pre   : http://47.96.144.176      ← 回落到 rmsOrigin（nginx 同源托管）
online: http://47.96.144.176      ← 同上
```

未声明豁免时构建被拦截：`远端 RMS 地址必须使用 HTTPS: http://47.96.144.176` ——
回落来的地址同样过校验。

---

## 2. 真机验证（tasks 5.3）：已执行

环境：dev 产物 + rms-admin dev server。

### ⚠️ 先踩到一个真问题：端口漂移

首次启动**页面加载失败**。排查结果：

```
profile 里写的   rmsWebOrigin: http://localhost:5173   ← 无人监听
rms-admin 实际起在                          :5177
desktop renderer 自己占了                   :5174
```

根因：dev 的 `serverOrigin`（`https://localhost:5173`）与 `rmsWebOrigin` 同端口，
Vite 撞端口就自动 +1，rms-admin 那边为此专门加了 `npm run dev:safe`（先杀残留再起）。

⇒ 这不是本次改动的 bug，但**写死 5173 在本机不可靠**。已在 profile 注释里记录该风险
与覆盖方式（`XIAOZHI_RMS_WEB_URL=http://localhost:<实际端口>`），本次即用该方式联调。

### 验证结果

| # | 项 | 结果 |
|---|---|---|
| 1 | 点入口能开 tab | ✅ `Internal page tab opening` → `Browser tab created` |
| 2 | ⭐ **页面正常渲染** | ✅ **统一改价页（房型 × 日期网格）**，非登录页 |
| 3 | 重复点击复用 tab | ✅ 连点 4 次全部 `Internal page tab reused`，未叠开 |
| 4 | partition 命名 | ✅ `persist:xiaozhi:dev:internal`（4 段） |
| 5 | 反复打开不新增 partition | ✅ 首次 20→21，此后恒为 21 |
| 6 | 账本无新增记录 | ✅ 全程 18 条，`internal` 条目数 **0** |
| 7 | ⭐ **重启后未被清空** | ✅ 见下 |
| 8 | 日志不含令牌/URL | ✅ 两轮日志 grep `token=` / `eyJ` / `unified-pricing` 命中 **0** |

### ⭐ 第 7 项：在真实清理发生的同一次启动中存活

重启那一轮的日志：

```
20:44:03.623 › Orphan partitions cleared { cleared: 6 }
20:44:06.360 › Browser tab created { partitionName: 'persist:xiaozhi:dev:internal' }
```

**孤儿回收这次真的清了 6 个 partition**，而 internal partition 完好无损
（重启前后均为 32M）。这不是「清理没跑所以侥幸存活」，是清理跑了、且正确地跳过了它 ——
决策 4 的 4 段命名在真机条件下确认有效。

### 2.2 仍未验证：会话过期拦截路径（tasks 5.3b）

方案 E 的核心路径**未在真机验证**：需要一枚已过期的 access token 才能触发，
本次联调用的是新鲜令牌。

⭐ 拦截逻辑的**决策链**已由 11 条单测覆盖（拦/放行、续期、会话失效关 tab、超限关 tab、
日志不含令牌），另有 3 条覆盖「守卫确实挂在 `will-navigate` 上」，且两处都做过反向验证。
未覆盖的只是「真实 Electron 里这条链路端到端跑通」。

## 3. 既有问题（非本次引入）

已用 `git stash` 对照确认，改动前后完全一致：

| 问题 | 数量 | 位置 |
|---|---|---|
| `tsc` 报错 | 15 条（前后均为 15） | `renderer/components/ui/{alert,button}/index.ts`、`tests/e2e/config/vite.renderer.config.mts` |
| `npm run build:e2e` 失败 | — | `Cannot merge config in form of callback`，同一个 e2e 配置文件 |

⇒ **e2e 构建链在本次改动前就是坏的**，因此 e2e 未纳入本次验证范围。

---

## 4. 待办

1. ~~端到端联调受阻于外部依赖~~ → **已解除**：页面正常渲染，说明
   `server-feedback.md` §2 的需求已落地。

2. **会话过期拦截路径待真机验证**（见 §2.2）：需要一枚已过期的 access token。
   可在下次令牌自然过期后（约 8 小时）复验，或由服务端提供短 TTL 令牌。

3. 归档前需同步 `openspec/specs/`（tasks 5.6）：新增 `desktop-internal-web-pages`，
   合并另两个 capability 的 delta。

4. dev profile 的 `rmsWebOrigin` 与 `serverOrigin` **端口相同、协议不同**，本次联调
   已实际踩到（见 §2）。已在 profile 注释里写明风险与覆盖方式；未改 `serverOrigin`
   本身（属既有配置，动它影响面更大）。若后续频繁踩到，建议把 dev 的
   `rmsWebOrigin` 改成一个不与任何本地服务冲突的端口。
