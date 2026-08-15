# 需求：让 desktop 能修复「没有 otaHotelId」的历史绑定

> 提给 rms-server。desktop 侧发现于 2026-08-15，真机复现。
> 相关 change：`openspec/changes/reauth-intent-and-legacy-binding/`

## 1. 问题

线上存在 `ota_hotel_id` 为空的 `ota_account` 记录。**不是个例**，同一家酒店
「Alan·银际酒店(九原区政府店)」的 **CTRIP 与 DOUYIN 两条绑定都为空**（2026-08-15
真机复现，两条都报同一个错）。这类记录**没有任何入口可以修复**：

```
现状两条路，都走不通
─────────────────────────────────────────────────────────────
POST /api/v1/app/ota-accounts        ❌ 被拒
   AppOtaBindAppService:182  findActiveBinding(hotelId, source) 命中
   → "该酒店的 CTRIP 渠道已存在绑定，请先解除现有绑定后再试"
   （这条没有门店的记录本身就占着「酒店+渠道」这个位）

PUT  /api/v1/app/ota-accounts/{id}   ⚠️ 能调通，但补不上门店
   AppUpdateOtaBindingRequest 只有 { operationId, bindExtra, cookies }
   → 没有 otaHotelId 字段，服务端也无写门店的逻辑
   → 调完 status 会变 BOUND，但 ota_hotel_id 仍为空
```

用户唯一能做的是**先解绑再重新绑定**，但那会丢掉这条记录上的其他信息，且解绑是
破坏性操作 —— 对「只是缺个字段」的记录代价过高。

### 1.1 为什么 POST 这条路是彻底封死的

占位判据只看「酒店 + 渠道」，**既不看 `ota_hotel_id`，也不看 `status`**：

```java
// AppOtaBindAppService:393
private Optional<OtaAccount> findActiveBinding(Long hotelId, String source) {
    return otaAccountRepository.findByHotelIds(List.of(hotelId)).stream()
            .filter(a -> source.equalsIgnoreCase(a.getSource()))
            .findFirst();
}
```

所以只要这条脏记录还在，那个「酒店 + 渠道」就被**永久占住** —— 无论它有没有门店。
desktop 侧无论怎么放宽本地判断都绕不过去（试过：本地放行只会让用户走到提交那一步
才被远端拒，比不给入口更糟）。

**结论：修复能力只能加在 PUT 上**，因为 PUT 按 id 定位既有记录，不经过这条拒绝规则。

## 2. 影响

| | |
|---|---|
| 用户看到 | desktop 显示「登录已失效」，点「去登录」走完流程也修不好 |
| 根因 | 远端 `status` 只描述登录态，不表达「这条绑定不完整」 |
| desktop 已做的兜底 | 识别出 `otaHotelId` 为空时改显示「未绑定成功」，引导到「重新绑定」——但那条路最终仍会撞上 POST 的拒绝规则 |

## 3. 需求

**让 `PUT /api/v1/app/ota-accounts/{id}` 支持补写 `otaHotelId` / `otaHotelName`。**

### 3.1 请求体新增字段

`AppUpdateOtaBindingRequest` 增加两个**可选**字段，与 `AppBindOtaAccountRequest` 同名同约束：

```java
/** OTA 平台侧酒店 id。仅用于补全历史上缺失该字段的绑定，见 3.2 的限制。 */
@Size(max = 64, message = "otaHotelId 长度不能超过 64")
private String otaHotelId;

/** OTA 平台侧酒店名称，可空。 */
@Size(max = 128, message = "otaHotelName 长度不能超过 128")
private String otaHotelName;
```

不传时行为与现在完全一致（只换 cookie + 合并 bindExtra），**不影响存量调用方**。

### 3.2 🔴 关键限制：只允许「从空补到有」，不允许改已有值

| 库里现值 | 请求带 otaHotelId | 期望行为 |
|---|---|---|
| 空 | 有值 | ✅ 写入 |
| 空 | 不传 | ✅ 保持空，与现状一致 |
| **有值** | **有值且不同** | ❌ **拒绝**（400），不静默覆盖 |
| 有值 | 有值且相同 | ✅ 幂等通过 |
| 有值 | 不传 | ✅ 保持原值 |

**为什么必须拒绝改已有值**：换门店是"改绑定关系"，不是"重新登录"。允许在这个端点上
改门店，等于给了一条绕过 `uk_ota_active` 唯一键与解绑流程的旁路 —— 一条绑定可以静默
指向另一家门店，用户与管理员都无从感知。这与 `AppOtaBindAppService:180` 那条注释
（"不覆盖——覆盖会静默丢掉既有绑定的 otaHotelId / bindExtra，用户无从感知"）是同一条
原则。

### 3.3 唯一键冲突要报友好错误

`uk_ota_active (org_id, hotel_id, source, ota_hotel_id)`（见 `V17__update_ota_account_unique_key.sql`）。
补写后可能与另一条既有记录撞键 —— 例如同酒店同渠道已有一条指向同一 `ota_hotel_id`
的正常绑定，而这条空的是脏数据。

期望：返回明确的业务错误（如"该门店已被同酒店同渠道的另一条绑定占用"），而不是
把 `DuplicateKeyException` 抛成 500。

### 3.4 兄弟 cookie 广播不受影响

`updateSiblingCookies` 按 `channelAccountId` 分组，与 `otaHotelId` 无关，逻辑不用动。

## 4. desktop 侧配合（本次需求通过后才实现）

```
用户点「重新绑定」
  → 走绑定流程的前半段：开标签页、登录、探测门店、用户确认选哪家
  → 收尾不调 POST（会被拒），改调 PUT，带上 otaHotelId + otaHotelName + bindExtra
  → 这条脏记录就地补全，不必解绑
```

即：**前半段是绑定（要用户选门店），后半段是更新（不新建记录）。**

## 5. 顺带订正一处 desktop 的错误认知（无需服务端改动）

desktop `apps/desktop/src/main/gateway/rms/types.ts:47` 注释写着：

> `bindExtra` 是**整体替换**而非合并，只发变化的键会把没发的键抹掉

**这与服务端实现不符。** `AppOtaBindAppService:251` 明确是合并：

```java
DeskBindExtra.of(account.getBindExtra())   // 读库里现值
        .applyFromDesktop(desktopExtra)     // 叠加本次传的
        .takeOverFromRpa();
// 判据是【合并后的最终结果】，本次没传但库里已有算通过。
```

desktop 侧会订正该注释，**此条仅供服务端确认结论无误**：按键合并、未传的键保留。

## 6. 待服务端确认

- [ ] 3.2 的「只允许从空补到有」是否认同？还是有别的处理偏好
- [ ] 3.3 撞唯一键时希望返回哪个 `ErrorCode`
- [ ] 存量有多少条 `ota_hotel_id` 为空？已知同一家酒店的两个渠道都中招，
      不像偶发 —— 若量大，值得一并做数据订正，而不只给单条修复入口
- [ ] 🔴 这类空记录**是怎么产生的**？只堵修复入口不堵源头，还会再出现。
      一条线索：涉事的携程账号 `credentialExtra.userName` 是「运营商赵经理」这类
      **人名/岗位名而非酒店名**，说明该账号管着多家门店 —— 多店账号在绑定时
      没能确定具体是哪一家，可能正是漏写 `ota_hotel_id` 的成因，建议往这个方向查
- [ ] `ota_hotel_id` 在库里是否该加 `NOT NULL` 约束（或应用层强校验），
      从源头杜绝写入空值
