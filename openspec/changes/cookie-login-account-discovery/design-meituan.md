## Context

`design.md` 决策 5/9 已经把 `DiscoveryProbe` 接口定稿、抖音已实现、携程已实现（决策 2、9），美团当时明确是 Non-Goals（"接口未踩点，现在写就是猜"）。现在有了踩点依据：`rms-rpa-worker/rms_rpa_worker/ota/step/meituan/poi_fetch.py` + `selectors.py` 是已在 RPA 场景里跑通的实现，本文档只补美团这一个渠道，不改 `DiscoveryProbe` 接口本身，也不改 `design.md` 已有内容。

## Decision 10：美团门店探测——同源 XHR 调用 `poiInfos` 接口，不用 DOM 解析

**接口**（抄自 `poi_fetch.py` + `selectors.py`，已在 RPA 里验证过）：

```
GET https://me.meituan.com/api/gw/v1/ampaccount/accountpoi/poiInfos
    ?key=auth-info-poilist&bizLine=3&permissionSpace=30&permissionCode=0
    &hasAccess=true&pageSize=50
    &poiFields=poiId,poiName,partnerId,partnerName,mtCityId,mtCityName
    &resultType=2&displayAll=false&tagSources=crossPartner&searchCondition=

Headers:
  Accept: application/json
  X-Requested-With: XMLHttpRequest
  M-APPKEY: fe_com.sankuai.fetalos.web.hotelfeme
  locale: zh-CN
  logintype: Epassport

成功响应：{ code: 10000, data: { twoLevelList: [{ poiList: [{ poiId, poiName, partnerId, partnerName, ... }] }] } }
```

`me.meituan.com` 是登录态的权威 shell 域（cookie 认证 + 上述固定 header，不依赖 `root_life_account_id` 这类需要二次换取的中间 ID，也不依赖页面已渲染出的 DOM），与携程的"DOM 兜底"和抖音的"两步换 ID"都不同——**这是三个已知渠道里最直接的一种**，同源 `XMLHttpRequest`（`withCredentials`）在页面上下文里发起，与携程/抖音同一机制（`executeJavaScript`）。

**执行流程**：

```
URL 判定命中登录成功（Decision 11）
        ↓
WebContentsView（同 partition）加载 me.meituan.com 任意已登录页面
  （复用 landingUrl 即可，不需要专门再导航——登录成功时标签页已经在 me.meituan.com 域下）
        ↓
executeJavaScript：同步 XHR 调 poiInfos，解析 code === 10000
        ↓
data.twoLevelList[].poiList[] 拍平
  为空 → none
  1 条 → single（otaHotelId = poiId, otaHotelName = poiName || partnerName）
  多条 → multiple（每条同样映射）
```

**不做的**：
- 不做 `hotel_name_hint` 模糊匹配选店（RPA 那套是"已知目标门店名，从多店里挑一个"，探测层职责是"列出这份登录态能看到的所有门店"，多店场景交给 `multiple` 分支，由用户在既有 UI 里选，见 `design.md` 决策 2 的 "探测到多个门店 → 弹出列表由用户选择"）
- 不处理"选择角色"弹层（`.choose-role-title` / `.choose-role-list`，RPA 在拉 POI 前会先点掉）——那是 RPA 要继续自动化操作页面才需要处理的交互状态；探测只读 `poiInfos` 接口数据，cookie 认证在弹层出现前就已经生效，弹层不影响这次 XHR 调用是否成功
- 不做 RPA 里 `_BROWSER_FETCH_MAX_ATTEMPTS = 3` 那种内部重试——参照携程决策 8.1 的结论：先写 1 轮，等真机验证暴露具体问题再决定要不要加

**字段映射**（门店身份判定完全由 cookie 决定，不像抖音需要 `groupid` 参与免登录跳转，因此 `channelContext` 不用于跳转；但复用该字段存 `partnerId`/`partnerName`——集团/加盟商信息，`poiInfos` 接口原生返回、有留存价值，序列化成 JSON 字符串）：

```
DiscoveredOtaHotel {
  otaHotelId: poi.poiId,
  otaHotelName: poi.poiName || poi.partnerName,
  channelContext: (poi.partnerId || poi.partnerName)
    ? JSON.stringify({ partnerId: poi.partnerId, partnerName: poi.partnerName })
    : null,
}
```

## Decision 11：登录 URL 判据——抄 `LOGIN_SUCCESS_URL_KEYWORDS`，不是简单"离开 /login/"

**决策**：`meituanLoginUrlMatcher.isPastLogin(url)` 命中以下任一路径关键字才算登录成功（抄自 `rms_rpa_worker/ota/step/meituan/selectors.py:44-48` 的 `LOGIN_SUCCESS_URL_KEYWORDS`，RPA 注释明确写了"勿用 /new-workbench/ alone，避免 eb 文档未换票就判成功"）：

```
/ebooking/merchant/ebIframe
/ebooking/index.html
```

**不采用**"只要不含 `/login/`"这种携程式判据——理由直接引用 RPA 已踩过的坑：美团登录成功后地址栏可能先落到只是壳页面的中间态（`eb.meituan.com` 相关 URL 在 iframe/子文档内加载，主文档地址栏未必变化），用"离开 `/login/`"判定会在换票未完成时就误判为登录成功。用更严格的白名单关键字，与 RPA 已验证过的判据完全一致，不重新发明。

## Decision 12：接入点——`meituan-discovery.ts` + `meituan-login-url-matcher.ts`，登记进两个 registry

**决策**：新增两个文件，均照抄 `ctrip-discovery.ts` / `ctrip-login-url-matcher.ts` 的结构：

- `src/main/account-discovery/meituan-discovery.ts` — `MeituanDiscoveryProbe implements DiscoveryProbe`，`channel = toChannelId('meituan')`
- `src/main/account-discovery/meituan-login-url-matcher.ts` — `meituanLoginUrlMatcher: LoginUrlMatcher`

登记进已有两个 registry（各加一行，不改结构）：
- `discovery-probe.ts` 的 `createDiscoveryProbes()`
- `login-url-matcher.ts` 的 `LOGIN_URL_MATCHERS`

`MeituanDiscoveryProbe.discover()` 复用 `landingUrl`（登录标签页当前 URL 已经在 `me.meituan.com` 域下，见 Decision 10），不像携程那样需要重新导航到一个固定管理页——`WebContentsView` 用同一 `landingUrl` 加载即可发起同源 XHR。

## Risks / Trade-offs

- **[风险] `poiInfos` 接口本次未做真机验证** —— 完全照抄 RPA 已验证实现，但探测时机（URL 判定刚命中 `/ebooking/merchant/ebIframe`）与 RPA 原场景（`_login_success_result` 里，已经过 `finalize_meituan_session` + 角色选择处理之后）不完全相同，cookie 生效时机是否已经足够早，需要真机验证才能确认，本次不假设已验证可用
- **[风险] "选择角色"弹层可能挡住登录后的第一次探测时机** —— 若该弹层在 URL 判定命中之前就已出现且 `poiInfos` 恰好依赖弹层选择完成后才生效（未验证，理论上不需要），会导致这一轮 `none`；按 `design.md` 决策 8 的"未绑定则允许下次导航重新触发"兜底，不单独处理
