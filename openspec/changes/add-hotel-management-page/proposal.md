## Why

登录用户目前缺少一个按酒店查看和管理 OTA 绑定关系的统一入口，无法快速判断各酒店的渠道覆盖、账号可用性和最近同步情况。新增酒店管理页可先用客户端 mock 数据验证信息架构和交互，并为后续与服务端双向同步 OTA 账号（尤其是登录 cookie）建立稳定的展示模型。

## What Changes

- 在登录后的左侧应用导航中新增“酒店管理”入口。
- 新增酒店列表页面，按酒店展示名称、城市、已绑定 OTA 账号和酒店级操作。
- 每家酒店使用单行高密度布局；将 OTA 账号展示为紧凑的 `bound-ota-account` 模块，行内优先呈现渠道与状态，详细字段按需展开或悬停查看。
- 提供“新增绑定账号”“绑定账号管理”入口，并为登录失效账号提供“去登录”操作；当前迭代使用本地 mock 交互，不接入服务端。
- 定义与服务端 `OtaAccount` 可映射的客户端只读展示模型；密码和 cookie 等敏感凭证不进入 renderer mock 或页面。

## Capabilities

### New Capabilities

- `hotel-management`: 登录用户查看其管理的酒店列表、OTA 账号绑定状态与相关操作入口。

### Modified Capabilities

无。

## Impact

- 影响 renderer 路由、左侧导航、酒店管理页面、展示组件与 mock 数据。
- 新增组件测试与路由测试，不新增第三方依赖。
- 本次不修改 main/preload IPC、数据库或服务端 API；后续同步接入应以 preload 为边界，敏感 cookie 不得暴露给 renderer。
