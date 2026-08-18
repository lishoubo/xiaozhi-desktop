# desktop-build-environments Specification

## Purpose

定义桌面应用的构建期环境概念（dev / pre / online）：取值与校验规则、它如何决定应用
标识与服务端地址，以及三套环境在同一台机器上并存安装且数据互不可见的保证。

## Requirements

### Requirement: 构建期环境是唯一环境事实来源

系统 MUST 在构建期确定应用所属环境，取值限定为 `dev`、`pre`、`online` 三者之一，并将
其固化进构建产物。系统 MUST NOT 在运行时从进程环境变量读取环境或服务端地址——打包
产物被双击启动时拿不到父进程环境，运行时读取会静默兜底成错误配置。

构建期收到非法环境值时，构建 MUST 失败并报错，MUST NOT 回退到任何默认值。未指定环境
值时 MUST 采用 `dev`，因为误打出连着本机的开发包，风险低于误打出连着生产的包。

#### Scenario: 未指定环境值

- **WHEN** 构建时未提供环境变量
- **THEN** 产物环境为 `dev`

#### Scenario: 非法环境值

- **WHEN** 构建时提供了三个合法值之外的环境值
- **THEN** 构建失败并提示合法取值清单
- **AND** 不产出任何构建产物

#### Scenario: 运行时环境变量不影响已打包产物

- **WHEN** 已打包的应用在设置了环境变量的 shell 中启动
- **THEN** 应用仍使用构建期固化的环境与服务端地址

### Requirement: 三套环境可并存安装且数据互不可见

系统 MUST 让 dev、pre、online 三套产物具备各不相同的应用标识（展示名称，以及各平台的
安装标识），使三者可同时安装在一台机器上而不互相覆盖。

三套环境的应用数据（业务数据库、登录凭证、渠道登录态、账本文件）与日志 MUST 完全隔离，
任一环境 MUST NOT 读取或写入其他环境的数据。

online 环境的展示名称 MUST 是不含环境标记的正式名称；dev 与 pre MUST 带可视区分标记。

#### Scenario: 三套环境同时安装

- **WHEN** 用户在同一台机器上安装 dev、pre、online 三个包
- **THEN** 三者作为独立应用共存，互不覆盖
- **AND** 用户可从名称区分出正式版与非正式版

#### Scenario: 环境间数据隔离

- **WHEN** 用户在 pre 环境绑定了某个渠道账号
- **THEN** online 环境看不到该账号
- **AND** online 环境的业务数据库与登录凭证不受影响

#### Scenario: 卸载单个环境

- **WHEN** 用户卸载 pre 环境
- **THEN** dev 与 online 的数据与登录态不受影响

### Requirement: 存储位置遵循各操作系统约定

系统 MUST 由运行时按当前操作系统约定派生应用数据目录与日志目录，MUST NOT 在代码中
硬编码平台相关路径分支。

系统 MUST NOT 将任何运行期产生的数据写入应用安装目录——安装目录在 macOS 上签名后
只读，在 Windows 上需要提升权限。

#### Scenario: 在 Windows 上运行

- **WHEN** 应用在 Windows 上启动
- **THEN** 应用数据写入该系统约定的用户数据位置
- **AND** 不写入安装目录

#### Scenario: 在 macOS 上运行

- **WHEN** 应用在 macOS 上启动
- **THEN** 应用数据与日志分别写入该系统约定的数据与日志位置

### Requirement: 服务端地址随环境固化且强制加密传输

系统 MUST 让每个环境有各自的 RMS 服务端地址，并在构建期固化进产物。

在正式 HTTPS 域名启用前，online MAY 暂时复用 pre 的 RMS 地址。该例外 MUST 在 profile
中显式记录，打包入口 MUST 输出明文凭证传输与数据不隔离警告；正式域名启用后 MUST
移除此例外。

指向非本机地址时，该地址 MUST 使用 HTTPS。构建期检出明文 HTTP 的非本机地址时 MUST
失败，除非构建方显式声明豁免——凭证以明文传输的产物必须可事后追溯，不能藏在默认值里。

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

### Requirement: 环境标识对使用者可见

系统 MUST 让运行中的应用暴露其构建期环境与服务端地址，使排查问题时可确认当前运行的
是哪套环境。

#### Scenario: 确认运行环境

- **WHEN** 需要判断某个安装实例属于哪套环境
- **THEN** 可从应用内或其日志中读到环境标识与服务端地址
