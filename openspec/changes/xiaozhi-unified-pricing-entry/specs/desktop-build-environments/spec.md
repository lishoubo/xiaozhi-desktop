## MODIFIED Requirements

### Requirement: 服务端地址随环境固化且强制加密传输

系统 MUST 让每个环境有各自的 RMS 服务端地址，并在构建期固化进产物。

RMS 有两个各自独立的地址：**API 地址**（主进程发起业务请求的目标）与 **web 页面地址**
（应用内打开 RMS 自有页面的目标）。两者 MUST 各自取值、各自固化，MUST NOT 由其中一个
推导出另一个 —— 开发环境下 API 与 web 前端分处不同端口，复用同一个值会打开一个不存在
的页面；部署环境下两者恰好同源，但那是部署形态的巧合，不是可依赖的约束。

web 页面地址未配置时 MUST 采用与该环境 API 地址相同的值 —— 部署环境下两者同源是常态，
强制每个环境重复填写一遍徒增出错面。

在正式 HTTPS 域名启用前，online MAY 暂时复用 pre 的 RMS 地址。该例外 MUST 在 profile
中显式记录，打包入口 MUST 输出明文凭证传输与数据不隔离警告；正式域名启用后 MUST
移除此例外。

指向非本机地址时，该地址 MUST 使用 HTTPS。构建期检出明文 HTTP 的非本机地址时 MUST
失败，除非构建方显式声明豁免——凭证以明文传输的产物必须可事后追溯，不能藏在默认值里。
该校验 MUST 同等作用于两个地址：web 页面地址同样承载访问令牌。

#### Scenario: 非本机明文地址未豁免

- **WHEN** 构建时指定了明文 HTTP 的非本机 RMS 地址且未声明豁免
- **THEN** 构建失败并说明需要显式豁免

#### Scenario: 非本机明文地址已豁免

- **WHEN** 构建方显式声明了豁免
- **THEN** 构建继续，并输出该产物以明文传输凭证的警告

#### Scenario: online 暂时复用 pre RMS

- **WHEN** 未显式覆盖 RMS 地址而构建 online 产物，且正式 HTTPS 域名尚未启用
- **THEN** 构建使用 profile 中与 pre 相同的临时 RMS 地址
- **AND** 打包入口警告 online 与 pre 数据不隔离且 JWT 通过明文 HTTP 传输

#### Scenario: 开发环境下 API 与 web 地址不同

- **WHEN** 构建 dev 产物，且该环境的 API 与 web 前端运行在不同端口
- **THEN** 产物中两个地址各自为其配置值
- **AND** 打开内部页面使用 web 页面地址，发起业务请求使用 API 地址

#### Scenario: web 页面地址未单独配置

- **WHEN** 某环境未配置 web 页面地址
- **THEN** 该环境的 web 页面地址取其 API 地址的值

#### Scenario: web 页面地址为非本机明文且未豁免

- **WHEN** 构建时 web 页面地址是明文 HTTP 的非本机地址且未声明豁免
- **THEN** 构建失败并说明需要显式豁免
