## Why

小智平台目前只向服务商用户开放。业务希望将完整的统一改价能力授权给指定酒店用户，并沿用 RMS 已有的权限集合与可访问酒店范围，不引入 OSS 名单或第二份酒店授权列表。

## What Changes

- RMS 为指定酒店用户提供个人级小智平台授权；`GET /api/v1/me` 继续通过现有 `permissions` 和 `accessibleHotelIds` 返回有效授权，不增加响应字段。
- RMS 对统一改价页面所需接口执行与返回值一致的个人权限、当前酒店访问校验，支持授权与撤销。
- Desktop 保留服务商入口，将酒店用户入口改为同时要求小智平台权限和至少一家可访问酒店，并在打开及恢复内部页面时执行相同判定。
- 在本 change 中单独记录 RMS 项目的交付需求；RMS 代码只在其自身项目的任务中实施。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-internal-page-access`: 将“仅服务商开放”改为“服务商或已获个人授权且有可访问酒店的酒店用户开放”，并要求主进程复核。

## Impact

影响 Desktop 的能力派生、内部页面打开和标签恢复逻辑；依赖 RMS 扩展个人授权计算及业务接口校验。`GET /api/v1/me` 的字段形状保持不变，现有 `permissions: string[]` 与 `accessibleHotelIds: number[]` 继续使用。
