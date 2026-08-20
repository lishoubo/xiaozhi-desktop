# 验证记录：按 userType 分流 desktop 界面功能

日期：2026-08-20

## 结论摘要

自动化验证（5.1–5.3）**全部通过**。真机验证（5.4–5.8）**尚未执行**——缺三类测试账号，原因见下。**本变更尚不满足完成门禁，不得声称「已验证通过」。**

## 已执行

### 5.1 类型与 Svelte 检查 — 通过

```
$ npm run check --workspace @hotel-butler/desktop

> tsc --noEmit --project tsconfig.node.json
> svelte-check --tsconfig ./tsconfig.renderer.json
1787207172639 START "/Users/lishoubo/p/projects/xiaozhi-desktop/apps/desktop"
1787207172642 COMPLETED 1254 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

### 5.2 Lint — 通过

```
$ npm run lint --workspace @hotel-butler/desktop
> eslint --ext .ts,.tsx,.mts .
（无输出，即无告警）
```

### 5.3 全量单测 — 通过，无回归

```
$ npm run test:unit --workspace @hotel-butler/desktop

 Test Files  98 passed (98)
      Tests  700 passed (700)
   Duration  2.71s
```

四个 hotel-management 相关测试文件均在通过之列，`createHotel` / `deleteHotel` 的五层调用链与其测试未被改动（`git status` 确认 main 进程与 preload 无文件变更）。

### 契约层类型收窄 — 已单独核验

`StaffIdentity['userType']` 推导为 `'STAFF' | 'HOTEL' | undefined`。用一次性 `tsc --noEmit --strict` 探针验证：`'HOTEL'` 与 `undefined` 可赋值，`'PARTNER'` 被 `@ts-expect-error` 捕获（即类型层确实拒绝未知值）。探针文件已删除。

### `.catch(undefined)` 运行时降级 — 已用仓库实际 zod 版本验证

在 `packages/api` 下以仓库实际依赖（zod v4）跑过：`'HOTEL'` 正常保留；键缺失、未知值 `'PARTNER'`、`null` 三种情况**均解析成功且降级为 `undefined`**，不抛错。

对应固化用例见 `tests/unit/main/rms-auth-client.test.ts`（新增 2 例，该文件 15 例全通过）与 `tests/unit/renderer-permissions.test.ts`（新增 6 例，共 11 例全通过）。

## 真机验证（2026-08-20，dev 变体 / `localhost:8080`）

测试账号：`13693214089`（`user_type='HOTEL'`，短信登录，`loginUserId=3`）。

### 5.4 酒店用户主流程 — ✅ 通过

用户观察：手机号登录后**侧栏看不到「酒店管理」**。

日志侧佐证（`dev2.log`）：整个会话从 `sms/login` 到改房态，`/api/v1/app/hotels`
请求次数为 **0**。对比同机上一轮 STAFF 会话（`dev.log`）——登录后立即出现 2 次该请求
（第 85、117 行），差异明确。

浏览器工作区可正常打开携程后台并作业（改房态两次，见 5.8）。

### 5.5 酒店用户 URL 兜底 — ⚠️ 部分验证

已确认：酒店用户全程 `/api/v1/app/hotels` 为 0 次，即**不主动进入就不会发请求**。

**尚未验证**：主动导航到 `/hotels` 时是否被重定向拦回。需在 DevTools Console 执行
`location.hash = '#/hotels'`，确认界面回到工作区且 `app/hotels` 仍为 0 次。
这一步才是「重定向先于 load」的正面判据。

### 5.6 直属员工 — ⚠️ 部分验证

首轮会话（`dev.log`）恢复的是一个 STAFF 身份，酒店管理页正常加载
（`app/hotels` + `app/ota-accounts` 并发拉取，均 200），证明 **STAFF 可进入该模块**。

**尚未验证**：页内按钮显隐——三个写入口（新增绑定账号/解绑/重新认证）应在，
新增酒店与删除酒店应不在。需人工目视确认。

### 5.7 OPERATOR 范围收敛 — ⛔ 未执行

缺 OPERATOR 账号（需后台授权 2–3 家酒店）。

### 5.8 改价上报未受影响 — ✅ 通过

酒店用户在携程后台改房态两次，两次均成功上报并走到最理想终态：

```
15:12:19.856 › Ctrip hotel id replaced with masterHotelId {
  payloadHotelId: '115348672',   ← 携程报文里的（预付/现付其中一侧）
  masterHotelId:  '85068938'     ← 账号维度稳定 ID，用它上报
}
15:12:19.898 › Amount change reported to RMS {
  rmsChangeId: 49, rmsStatus: 'DISPATCHED', rmsItems: 1
}
15:12:52.199 › Amount change reported to RMS {
  rmsChangeId: 50, rmsStatus: 'DISPATCHED', rmsItems: 1
}
```

`DISPATCHED` 意味着 RMS 完成门店反查、房型匹配，并通过订阅与模块门控派发了跟价任务
——整条链路打通，不止是"请求发出去了"。`loginUserId: 3` 表明身份查询正常。

**结论：关闭酒店管理不影响酒店用户作业**，与 design Context 的分析一致。

#### 附：`otaHotelId` 归一的一次澄清

肉眼在日志里会看到两个 ID，容易误判：

| 值 | 位置 | 含义 |
|---|---|---|
| `115348672` | `changeRaw` 内的 `hotelID` | 携程**原始报文**，有意原样保留，不修改 |
| `85068938` | 上报体的 `otaHotelId` | **实际发给 RMS 的值**，归一已生效 |

RMS 反查读外层 `otaHotelId`，不读 `changeRaw`。行为符合 `632f5d3` 的修复预期。

#### 附：一次环境干扰（非代码缺陷）

首轮 14:58:32 起 `/api/v1/me` 连接被拒（`durationMs: 3`），导致 token 取不到，
后续上报全部 `RmsSessionMissingError`，重试一次后放弃。本地 RMS 短暂不可达所致，
服务恢复后重测即全部 `DISPATCHED`。**上报的失败重试与放弃行为符合既有设计**
（不落盘补报，见 `amount-change-report-service.ts:48-55`）。

首轮另有一次 `rmsStatus: 'HOTEL_UNRESOLVED'`（`rmsChangeId: 47`），
是当时该门店在本地库尚缺 `ota_account` 绑定/房型镜像，属数据准备问题；
补齐后重测即为 `DISPATCHED`。

## 待办

- [ ] 5.5 补验重定向正面路径（DevTools 执行 `location.hash = '#/hotels'`）
- [ ] 5.6 补验页内按钮显隐（三个写入口在、新增/删除酒店不在）
- [ ] 5.7 需要 OPERATOR 账号（后台授权 2–3 家酒店）
- [ ] 上述补齐后方可执行任务组 6（合并 specs delta 并归档）
