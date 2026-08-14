# 美团房态房量监听

## Why

价量态监听已覆盖三渠道改价与携程房态（`ctrip-room-status-watch`）。美团的房态房量已完成踩点（`docs/踩点/美团/单房态房量01.md`），页面与端点都落在现有监听链路射程内，接入成本只是适配器加两个端点分支 —— 上一个 change 铺好的 `changeType` 契约与 `isSuccessful(responseBody, endpointId)` 形参本次直接复用，无需再动契约。

## What Changes

- **美团适配器新增两个端点**，二者都上报 `changeType: 'roomStatus'`：

  | endpointId | 端点 | 用户操作 |
  |---|---|---|
  | `inventory-status-switch` | `/api/gw/v1/product/goods/inventory/status/switch` | 单独改房态（开/关某房型某日期） |
  | `inventory-update` | `/api/gw/v1/product/goods/inventory/update` | 改房量（同一请求里**顺带带房态**） |

- **`inventory/check` 明确不拦**：踩点确认它与 `inventory/update` 的请求体**逐字节相同**，是提交前的预检。两个都拦会把一次改动上报两遍 —— 与抖音「只收 `save_*` 不收 `check_*`」、美团改价「靠 `createFlag` 分流」是同一类问题、同一种解法。
- **`changeRaw` 完全原样透传，不做任何裁剪**，不新建 payload 模型函数。与抖音改价同一做法。房量语义字段（`countType` 的 1526/1020/1620/1720、`invSwitch`、`limitChangeValue`、`count`）含义尚未踩清，**看不懂正是不能剔的理由** —— 剔了永久丢失，留着 RMS 日后踩清了就能直接用。
- **`inventory/update` 一次请求同时含房态与房量时，只发一条上报**，不拆分。一次 `update` 就是用户的一次操作；拆成两条会生成两个 `operationId`，让 RMS 以为发生了两次改动。这正是 `changeType` 当初定为「意向标记而非精确分类」的场景，本次验证了那个决定。

**非目标**：抖音房态房量（需放开 `WATCH_PATH`，是三渠道里唯一需要改页面路径的）、契约变更、机制层改动、`countType` 等字段的语义踩点。

## Capabilities

### New Capabilities

- `ota-amount-change-report`: 价量态改动上报的跨模块契约与各渠道解读规格。该 capability 的 delta 首见于 `ctrip-room-status-watch`（尚未合并进 `openspec/specs/`），本次在同一 capability 下补充美团量态相关的行为要求。两个 change 的 delta 在归档时合并。

### Modified Capabilities

（无）

## Impact

| 范围 | 影响 |
|---|---|
| `apps/desktop/src/main/channels/meituan/amount-change-adapter.ts` | 加两个端点常量 + `parse` 分流 + `isSuccessful` 按端点分支 |
| `apps/desktop/tests/unit/main/meituan-amount-change-adapter.test.ts` | 补房态房量用例 |
| 页面路径 `WATCH_PATH` | **不改** —— 房态房量的 referer 是 `/ebooking/merchant/product`，现有前缀已覆盖；`#/index` 是 hash 路由，不参与 `pathname` 匹配 |
| 契约 `shared/types/amount-change.ts` | **不改** —— `changeType` 与 `OtaChangeType` 已就位 |
| `channels/types.ts`、机制层 | **不改** —— `isSuccessful` 的 `endpointId` 形参已就位 |
| 新建 payload 模型文件 | **不新建** —— 原样透传，无需转换函数 |
| rms-server（外部系统） | 会开始收到 `changeType: 'roomStatus'` 且 `source: 'meituan'` 的上报。服务端接收不在本次范围 |
