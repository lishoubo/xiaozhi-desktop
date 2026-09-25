## ADDED Requirements

### Requirement: 上报体携带门店名

上报体 SHALL 包含 `otaHotelName` 字段，表示与 `otaHotelId` **同一家**门店的名称，取不到时为 null。

`otaHotelName` SHALL 仅作记录用途：下游 MUST NOT 用它定位、分派或校验门店（门店名可改名、可重名）。

门店名 SHALL 只按已确定的 `otaHotelId` 精确查取；`otaHotelId` 为空时 `otaHotelName` SHALL 为 null，MUST NOT 为补全门店名而反推门店。

#### Scenario: 携程改价

- **WHEN** 携程账号改价，`otaHotelId` 已归一为账号的主酒店 ID
- **THEN** `otaHotelName` 为该账号登录时记录的酒店名

#### Scenario: 美团账号挂多家门店

- **WHEN** 美团账号下有多家门店，本次改动的 `otaHotelId` 为其中一家
- **THEN** `otaHotelName` 为该门店的名称，而不是账号下其他门店

#### Scenario: 抖音未暴露门店标识

- **WHEN** 抖音改动的 `otaHotelId` 为空串
- **THEN** `otaHotelName` 为 null，照常上报
