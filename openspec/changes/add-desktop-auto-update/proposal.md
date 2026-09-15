## Why

应用即将打包分发给客户，但目前没有任何升级通道——客户装上之后，新版本只能靠人工发包、
逐台重装。仓库里 `autoUpdater` / `electron-updater` 零命中，forge 也没配 publisher。

`add-windows-installer-pipeline` 已把 Squirrel 的 `.nupkg` + `RELEASES` 一并产出并注明
「为将来做增量更新留口」，现在把这个口接上。

## What Changes

- 构建期新增「更新源地址」，与既有的 RMS / server 地址同样按环境固化
- 主进程新增更新器：登录后拉取灰度名单，命中才启动 Electron `autoUpdater`
- 灰度名单是 OSS 上一份静态 JSON，存手机号的加盐哈希，不存明文
- 新增上传脚本，把打包产物推到 OSS
- macOS 与 Linux 不启动更新器（无代码签名，Squirrel.Mac 无法完成替换）
- 仅 online 环境启用；dev / pre 的更新源地址为 `null`，更新器静默关闭

**不做**：代码签名与公证、macOS 自动更新、server 侧任何改动、CI 自动上传、版本回滚
（Squirrel 只升不降，见 design）。

## Capabilities

### New Capabilities

- `desktop-auto-update`: 桌面应用自动更新的规则——何时检查、灰度名单如何判定、
  取不到身份时的保守行为、哪些平台与环境 MUST NOT 启动更新器、更新失败 MUST NOT
  影响应用可用性

### Modified Capabilities

- `desktop-build-environments`: 「服务端地址随环境固化」目前覆盖 RMS API / RMS web /
  hotel-butler server 三个地址。新增要求：更新源地址同样随环境固化，且 `null` MUST
  表示「该环境不启用自动更新」而非构建失败——dev 与 pre 不分发给客户，没有更新源

## Impact

**desktop 代码**

| 层 | 影响 |
|---|---|
| 构建期 | 新增 `updateFeedUrl` profile 字段与 `__UPDATE_FEED_URL__` 常量 |
| `main/updater/` | 新建：名单拉取、哈希判定、feed 地址 resolver |
| `main/services/` | 新建 `UpdaterService` |
| `main/ipc/` | 新增更新状态通道（渲染进程展示「已就绪待重启」） |
| `main/composition/` | 更新器注册在 app scope；登录触发接线在 window scope |
| `renderer/` | 更新就绪提示 |

**仓库工程**

- 新增 OSS 上传脚本（`scripts/`）
- `apps/desktop/package.json` 的 `version` 从此需要随发布递增（此前恒为 `1.0.0`）

**刻意不改**

- `apps/server/` —— 灰度名单是 OSS 静态文件，server 不参与
- `packages/api/` —— 不新增跨端契约
- `forge.config.ts` —— 不配 publisher，上传由独立脚本负责

**外部依赖（不在本仓库实施）**

- 阿里云 OSS bucket（公共读）需开通，bucket 地址填入 profile 表
- 打包仍在 GitHub Actions 手动触发，产物下载后由人工跑上传脚本

**未验证的前置**

`add-windows-installer-pipeline` 的「真 Windows 上安装并启动」至今未打勾——自动更新
的端到端验证依赖真 Windows 环境，本次同样无法在开发机上完成。
