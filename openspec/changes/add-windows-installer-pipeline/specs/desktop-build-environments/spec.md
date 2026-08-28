# desktop-build-environments Specification (delta)

## ADDED Requirements

### Requirement: 构建产物不依赖开发期本地状态

构建 MUST 只依赖仓库内容与 lockfile，MUST NOT 要求本地开发环境才有的产物存在——
包括但不限于本地 HTTPS 证书、已生成的类型产物、开发者手工放置的文件。

仅开发服务器需要的配置（如本地 HTTPS 证书）MUST 惰性求值，MUST NOT 在配置模块顶层
无条件读取——配置对象在构建与开发两条路径上都会被求值，顶层读取会让构建凭空依赖
开发期状态。

#### Scenario: 干净检出直接打包

- **WHEN** 在从未运行过开发环境初始化的干净检出上执行打包
- **THEN** 打包成功
- **AND** 不因缺少本地开发证书而失败

#### Scenario: 开发服务器仍使用 HTTPS

- **WHEN** 启动本地开发服务器
- **THEN** 开发服务器仍以 HTTPS 提供服务

### Requirement: 跨平台打包不受宿主平台污染

平台相关的打包步骤 MUST 以**目标平台**为判据，MUST NOT 以宿主平台为判据。仅在宿主
具备该能力时才执行的步骤，MUST 同时判断目标平台与宿主平台。

#### Scenario: 在 macOS 上打 Windows 包

- **WHEN** 在 macOS 上以 Windows 为目标执行打包
- **THEN** macOS 专属的签名步骤被跳过
- **AND** 打包成功产出 Windows 可执行文件

#### Scenario: 在 macOS 上打 macOS 包

- **WHEN** 在 macOS 上以 macOS 为目标执行打包
- **THEN** 按目标 bundle id 重签的步骤照常执行

### Requirement: 原生模块使用随包预编译产物

对随包发布全平台预编译产物的原生依赖，打包流程 MUST NOT 触发重新编译——重编要求
打包机具备完整 C++ 工具链，而重编产物在模块解析顺序中优先级低于预编译产物，即使
生成也不会被加载。

#### Scenario: 在无 C++ 工具链的机器上打包

- **WHEN** 在未安装 Visual Studio 的 Windows 机器上执行打包
- **THEN** 打包成功
- **AND** 产物中包含目标平台的预编译原生模块

### Requirement: Windows 安装包在真 Windows 上产出

Windows 安装包 MUST 在 Windows 上产出。系统 MUST NOT 依赖 Mono + Wine 在非 Windows
宿主上生成 Squirrel 安装包。

安装包元数据 MUST 满足 NuGet 规范的必填项（至少包含 authors），否则安装包生成失败。

产出 MUST 同时包含安装程序、包文件与版本清单三类文件，使后续可基于同一产物实现
增量更新。

#### Scenario: 产出 Windows 安装包

- **WHEN** 在 Windows 上对指定环境与登录变体执行打包
- **THEN** 产出该环境的 Squirrel 安装程序
- **AND** 同时产出包文件与版本清单

#### Scenario: 安装包元数据缺失

- **WHEN** 安装包元数据缺少 NuGet 规范的必填项
- **THEN** 安装包生成失败并指出缺失项
