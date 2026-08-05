## Context

客户端已经使用 Svelte 5、`svelte-spa-router`、Tailwind 设计令牌和 lucide 图标构建登录后的多工作区界面，左侧导航当前为图标式入口。现有 renderer 已有 OTA 渠道目录与图标，但尚无按酒店聚合 OTA 账号的视图。服务端 `OtaAccount` 是账号聚合根，包含 `hotelId`、`orgId`、`source`、`username`、`otaHotelId`、`otaHotelName`、`status`、登录/初始化时间、`bindError` 与 JSON `bindExtra`，同时包含不能暴露给 renderer 的密码和 cookie 密文。

本次设计以 proposal 和 `specs/hotel-management/spec.md` 为行为边界，先用静态 mock 验证信息结构，不建立新的 IPC 或持久化链路。

## Goals / Non-Goals

**Goals:**

- 让用户在一个页面中快速扫视多个酒店及其 OTA 账号健康度。
- 建立与服务端字段可映射、同时对 renderer 安全的展示模型。
- 让正常、登录失效、处理中和初始化异常状态在视觉与操作上有明确差异。
- 保持页面与现有应用的间距、色彩、动效、按钮和导航交互一致。

**Non-Goals:**

- 不接入服务端 API、数据库或 cookie 双向同步。
- 不实现新增绑定、编辑、解绑、登录或初始化的真实工作流。
- 不在 renderer 模型中包含服务端密码或 cookie 密文字段。

## Decisions

### 1. 页面采用高密度单行酒店表格

酒店列表是主层级，每家酒店严格占据一行：左侧固定展示酒店名称和城市，中间是横向紧凑 OTA 账号模块，右侧是酒店级操作。账号模块默认只显示渠道图标/名称、状态点和必要的恢复操作；账号、OTA 酒店 ID/名称、扩展字段与刷新时间放入 hover/focus 浮层。超出行宽的账号折叠为“+N”入口，不增加酒店行高度。目标是在常规桌面窗口首屏同时扫描约 8—12 家酒店。

替代方案是原有的大卡片网格，但实测一到两家酒店就占满首屏，不适合一个运营人员管理几十家酒店的场景。完全隐藏到账号弹窗也会丢失健康状态，因此保留紧凑的行内状态摘要。

### 2. 建立 renderer 专用的安全展示模型

新增 `ManagedHotel`、`BoundOtaAccount` 和 `OtaAccountStatus`。`BoundOtaAccount` 直接使用服务端 `OtaAccount` 的非凭证字段名：`id`、`hotelId`、`orgId`、`source`、`username`、`otaHotelId`、`otaHotelName`、`status`、`lastLoginAt`、`lastInitAt`、`createdAt`、`updatedAt`、`deletedAt`、`bindError`、`bindExtra`，不再增加 `extraFields`、`lastRefreshedAt` 等服务端不存在的字段。页面通过纯展示函数读取 `bindExtra` 中服务端已定义的 `merchantGroupId`、`otaPartnerId`、`loginMethod` 和 `loginPhone` 并转换为中文标签。

`passwordCiphertext`、`cookieCiphertext` 虽属于服务端领域实体，但禁止进入 renderer 展示模型；后续 Cookie 同步必须通过 main/preload 的受控接口处理，不能经由本页面模型透传。

替代方案是直接复用现有 domain `OtaAccount`，但该模型服务于本地浏览器账号与 session partition，语义和服务端酒店绑定聚合并不相同，强行合并会造成边界混淆。

### 3. 状态语义集中映射，页面只消费展示结果

用一个无框架依赖的 formatter 将服务端状态码映射为中文标签、说明、视觉 tone 和动作类型。mock 覆盖 `BOUND`、`LOGIN_EXPIRED`、`IN_PROGRESS`、`PENDING_LOGIN` 与初始化异常，用少量代表性状态验证设计。

替代方案是在 Svelte 模板里散布条件分支；集中映射更利于以后接入服务端且便于裸 Vitest 测试。

### 4. Mock 操作使用应用通知反馈

“新增绑定账号”“绑定账号管理”“去登录”等按钮在本次使用统一通知中心说明这是设计预览，并带上目标酒店或渠道上下文。这样按钮具备可验证反馈，也不会伪装成已经实现的真实业务能力。

### 5. 使用现有设计系统，不新增依赖

页面复用全局令牌、Button、页面进入动效、lucide 图标和已有 OTA 图标资源。列表使用表头、约 56—64px 行高、细分隔线和低饱和状态色；账号模块使用小尺寸胶囊，不使用大面积卡片、说明段落或重复字段标题。

## Risks / Trade-offs

- [mock 与服务端未来 DTO 可能漂移] → mock 账号字段直接跟随服务端 `OtaAccount` 非凭证字段，并在接入时用共享 schema/IPC contract 验证输入。
- [隐藏次要字段会降低可发现性] → 账号模块支持 hover 与键盘 focus，浮层集中展示完整字段并保留明确的可交互样式。
- [账号过多挤占操作区] → OTA 区设置固定可用宽度，超出部分折叠为“+N”，酒店级操作始终可见。
- [当前按钮被误解为完整能力] → 点击后明确提示“设计预览，暂未连接服务端”，不做假成功状态变更。
- [服务端状态继续扩展] → 未知状态使用中性“状态待确认”回退，不让页面渲染失败。

## Migration Plan

本次仅增加 renderer 页面和 mock 数据，无数据迁移。回滚时移除路由、导航入口和新增页面模块即可，不影响现有 OTA 浏览器账号与 cookie 存储。
