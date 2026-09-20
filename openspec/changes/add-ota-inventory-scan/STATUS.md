# 状态：OTA 价量态定时扫描（Change B）

**2026-09-20｜代码全部完成，47/54 任务，7 次提交未推送。剩余全是真机验证。**

分支：`feature/ota-inventory-snapshot`（Change A 与 B 在同一分支）

---

## 已完成

| 节 | 内容 | 新增测试 |
|---|---|---|
| 1 | ✅ **连通性验证（真机通过）** | — |
| 2 | 失效判据抽取（携程内部复用） | 既有 24 项未改仍全绿 |
| 3 | 取数层 `ctrip/inventory-scan.ts` | 18 |
| 4 | 调度器 `inventory-scan-dispatcher.ts` | 22 |
| 5-6 | 比对上报 + payload 规格 + 服务端需求文档 | 10 |
| 7 | 配置三层开关 + `mergeConfig` 深度 | 5 |
| 8 | 装配（app-scope） | — |

**新增 72 项全绿**；全量 1120 passed / 1 failed，与改动前基线一致
（那 1 个是既有的 `__SERVER_ORIGIN__` 构建常量问题，与本次无关）。
typecheck 干净，lint 12 个错误与基线持平。

### 新增文件

```
channels/ctrip/session-expiry.ts          失效判据（从 readback 抽出）
channels/ctrip/inventory-scan.ts          ⭐ 两步请求取数
channels/ctrip/inventory-scan-payload.ts  ⭐ 上报体规格（RMS 对接读这份）
channels/inventory-scan-dispatcher.ts     ⭐ 调度器（第六种触发模型）
inventory-snapshot/scan-to-report.ts      比对 → 上报
openspec/changes/add-ota-inventory-scan/服务端需求.md
```

---

## ✅ 连通性验证（2026-09-20，两个携程账号）

**结论：`session.fetch` 方案成立，不需要降级。** 这推翻了立项时设想的三层降级
（找已开标签 → 启隐藏浏览器 → 裸 HTTP）。

| 验证项 | 结果 |
|---|---|
| `credentials: 'include'` 对第三方域带 cookie | ✅ 返回真实数据，非登录页 |
| 携程认主进程发起的请求 | ✅ 200 + `application/json` |
| 需要补的头 | **只需 `Referer` + `Origin`**，无签名头 |
| 房型清单 | ✅ 31 / 13 个房型 |
| 取数（含价格） | ✅ `roomStatusResult` + `roomPriceResult` 都回来了 |
| 两 partition 互不串味 | ✅ 各返回自己酒店 |

**标签页开/关对照实验**（用户只开了云朵那个账号）：

```
第一轮 18:36  两个账号都没开标签页  → 31 / 13 房型
第二轮 18:38  只开了云朵            → 31 / 13 房型，bodyLength 逐字节相同
```

同一轮里开着的与没开的**表现一致** —— cookie jar 不受标签页状态影响。

**额外证实**：探针跑的两个时刻基线库**零写入**，同期 `page-read` 日志出现在手动开
标签页的时刻，与探针不重合 —— `session.fetch` 不经渲染进程，**不会被自己的 CDP 拦到**。

---

## ⚠️ 测试前必读

### 1. 总闸默认关闭

`inventoryScan.enabled` 默认 `false` —— 有外部副作用的周期性行为不该因装新版本就自己跑。
**测试前要先打开**，且 `idleMs` 默认 5 分钟，等一轮较久。

建议临时改 `app-config/defaults.ts`：`enabled: true` + `idleMs: 30_000`，验完撤回。

### 2. ⚠️ 正常情况下**绝大多数轮次应该零上报**（用户提出）

这不是 bug，是设计如此：

```
用户主动改 → 回读已经更新了基线 → 扫描比对时发现一致 → 不报   ← 绝大多数
有人在别处改 → 基线是旧的 → 扫描发现差异 → 上报              ← 立论场景，少见
```

**反过来说：如果每轮都在报，那才是有 bug。**

所以 9.3 那条验证（在**其他浏览器**改一次价）是唯一能证明链路有效的场景 —— 光看
"跑起来了没报错"说明不了任何问题。

### 3. 首轮只建基线不上报

库里没有基线的格子只写不报。所以**第一轮扫描必然零上报**，第二轮起才可能报。

---

## 剩余任务（全要真机）

| # | 内容 |
|---|---|
| 9.2 | 不开标签页等一轮 → 查库确认 `source_of_truth='scan'` 的格子出现 |
| 9.3 | ⭐ **在其他浏览器改一次价 → 下一轮应报出差异**（立论场景，必须验） |
| 9.4 | 无变化时连续两轮 → 第二轮零上报 |
| 9.5 | 首轮全新窗口 → 只建基线零上报 |
| 9.6 | cookie 失效（手动清 partition cookie）→ 跳过该账号 + GlitchTip 有记录 |
| 9.7 | 关掉某家店的开关 → 该店不扫，同渠道其余店照常 |
| 9.8 | 观察一轮耗时与请求数，确认 `idleMs` 5 分钟是否合适 |
| 10.1 | ⚠️ 回头处理 `issues.md` 的 ISSUE-1 |

### 查库命令

```bash
DB=~/Library/Application\ Support/小智酒店管家\[开发\]/hotel-butler.sqlite
sqlite3 -header -column "$DB" \
  "SELECT item_type, source_of_truth, COUNT(*) n FROM ota_inventory_snapshot GROUP BY 1,2;"
```

### 看日志

```bash
grep -a "Inventory scan\|Snapshot enqueued" ~/Library/Logs/Electron/staff/main.log | tail -20
```

---

## 未接线的一处

`lastWriteAt` 恒返回 `null`（app-scope），静默判据因此不生效。接线点已留，注释写明。
要接需要从改价监听那侧引出「上次用户写操作时刻」。

**影响**：用户正在改价时扫描不会被抑制，可能取到中间态或与回读抢数据。
真机若观察到误报，优先接这条。

---

## 待办（用户提出，未处理）

- **cells 组织方式**：目前房态房量一条、价格另一条（照携程读接口的原始结构）。
  美团的价格挂售卖房型（`goodsId`）、房量挂物理房型（`roomId`），ID 空间不同 ——
  **等美团踩点完再统一看**是否要调整结构。已写进服务端需求文档第 6 节
- **扫描窗口 15 天** 与自然读实测范围对齐（已改默认值），但未真机确认取数耗时
