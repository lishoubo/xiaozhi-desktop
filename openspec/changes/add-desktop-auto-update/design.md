## Context

动机见 `proposal.md - Why`，行为契约见 `specs/`。这里记录塑造实现路径的现状约束。

**Squirrel 是什么，以及它不做什么。** 项目已在用 `@electron-forge/maker-squirrel`，产物
里的 `.nupkg` + `RELEASES` 就是 Squirrel.Windows 的更新源格式。它不需要服务端程序——
`autoUpdater.setFeedURL(url)` 之后，它只发两个 GET：

```
GET <feedUrl>/RELEASES                      读版本清单，与 app.getVersion() 比对
GET <feedUrl>/xiaozhi-hotel-1.0.1-full.nupkg  下载，校验 SHA1，解压安装
```

纯静态文件，所以 OSS 就够，server 零改动。

**但 Squirrel 只认 feed，不认名单。** 一旦 `checkForUpdates()` 被调用，它读到
`RELEASES` 里有新版本就会升，没有「这次别升」的开关。灰度只能做在它外面：

```
名单层（我们写）                    Squirrel 层（Electron 内置）
──────────────────                 ─────────────────────────────
拉 update-manifest.json
算 sha256(phone + salt)
在名单里？
   ├─ 否 → 结束，autoUpdater 从不启动
   └─ 是 → setFeedURL + checkForUpdates() ──→ 读 RELEASES
                                              下载 .nupkg
                                              校验 SHA1
                                              quitAndInstall 时安装
```

**手机号不是本地数据。** `<userData>/staff/staff-auth.json` 只存 token
（`token-store.ts:18-24`）。手机号来自 `GET /api/v1/me` 的返回，且
`packages/api/src/contracts.ts:43` 标注 `phone: z.string().nullable().optional()`——
服务商员工可能没有。所以取手机号 = 一次网络请求 + 一个可能为空的字段。

**主进程没有「登录成功」事件。** `StaffAuthService` 是纯请求-响应，登录结果直接作为 IPC
返回值交给渲染进程，主进程不留痕。要在登录后触发更新，只能在 IPC handler 那一层挂钩。

## Goals / Non-Goals

**Goals:**

- 更新器的失败在任何路径上都不影响应用启动与使用
- 灰度名单可由一次文件编辑调整，不需要发版、不需要服务端改动
- 名单泄露不等于客户手机号泄露

**Non-Goals（超出 `proposal.md` 已声明范围的部分）:**

- 不做多版本并存的灰度（A 升 1.0.2、B 停 1.0.1）。一份 `RELEASES` 只能表达一个最新
  版本，要做得按分组存多份目录，本次不值得
- 不做更新进度条。下载在后台静默进行，用户只在完成时看到一次提示
- 不做「立即重启」按钮。提示即可，安装发生在用户自然退出时

## Decisions

### 1. 灰度判据放 OSS 静态文件，不放 server

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| server 加 tRPC 接口 + 管理页 | 可按酒店/集团配置，有 UI | 要动 server、要建表、要写管理页 | 否决（本次） |
| OSS 放一份 JSON | 零服务端改动，改名单=改文件 | 手工编辑，无 UI | **采用** |
| 不做灰度，一传全员升 | 最简单 | 新版本有 bug 全员中招，且降不了级 | 否决 |

决定因素是**降级不可行**（见决策 5）：没有回滚手段时，灰度是唯一的安全网，不能省。
而 server 那套的增量价值只是「有 UI」，等客户多起来再补。

### 2. 名单存哈希不存明文

更新源 bucket 必须公共读（Squirrel 匿名下载），明文名单等于公开客户手机号。

```
存储形态：sha256(phone + SALT) 的 hex
SALT：编译期常量，与 feed 地址同源注入
```

加盐是必需的——手机号空间只有 11 位且号段有限，无盐 sha256 可被穷举反查。盐值随包
分发，攻击者拆包可得，但那需要先拿到安装包，门槛高于拿到一个公开 URL。

⚠️ **这不是加密，是提高门槛。** 真正的敏感数据不能这么处理，手机号在此场景下的
泄露代价可接受。

### 3. 触发点覆盖三条路径

```
staff-auth-handlers.ts
├── login                → 服务商用户名密码登录
├── loginWithPhoneCode   → 酒店手机验证码登录
└── currentSession       → 冷启动恢复会话   ⚠️ 最常见，最容易漏
```

只挂 `login` 会让「客户每天开机打开应用」永远触发不到检查——客户不会每天重新登录。
三条都要覆盖，且用一次性标志保证单次运行只检查一次。

挂法取 handler 层可选回调，不改 `StaffAuthService`：

```ts
// ipc/staff-auth-handlers.ts
export function registerStaffAuthHandlers(options: {
  window: BrowserWindow;
  service: StaffAuthOrchestrator;
  logger: AppLogger;
  onIdentityResolved?: (identity: StaffIdentity) => void;  // 新增
}): () => void
```

| 方案 | 结论 |
|---|---|
| handler 加可选回调 | **采用**。`StaffAuthService` 不动，三条路径显式调用，看得见 |
| `StaffAuthService` 注入 `onIdentityResolved` 依赖 | 备选。与 `OtaCredentialService.onAccountBound` 风格一致，但要改 service 构造 |
| 主进程新建 EventEmitter | 否决。为一个消费者引入事件总线，过度 |

### 4. 更新器注册在 app scope，IPC 在 window scope

`app-scope.ts:3-7` 的分界判据是「能不能在关窗后继续存在」。更新器有后台下载任务，
且「已下载待重启」的状态不能因关窗重开而丢失 → app scope。

```
app-scope.ts        UpdaterService              进程级，跨关窗存活
window-scope.ts     registerUpdaterHandlers     IPC + 向渲染进程推送
                    registerStaffAuthHandlers   ← 登录触发接线在这里
```

### 5. 只升不降，不做回滚

Squirrel.Windows 的安装是「解压到 `app-<新版本>/` 并改快捷方式指向」，没有降级路径。
把 `RELEASES` 改回旧版本，已升级的机器不会退回——`autoUpdater` 比对后发现远端版本更低，
直接不动作。

**所以「回滚」的真实含义是「阻止尚未升级的机器继续升级」**：把手机号从名单移除，
未升的不再升，已升的只能人工重装。

这条必须写进 spec（已写），否则实施时容易误以为改名单能撤回升级。

### 6. 环境缺更新源 = 静默关闭，不是构建失败

照抄 `sentry-dsn.ts` 的范式（`null` → 空串 → 运行时静默跳过），不照 `rmsOrigin` 的
范式（`null` → 构建失败）。

理由：dev / pre 不分发给客户，没有更新源是常态。按 `rmsOrigin` 那样处理会让本地
`npm run make:desktop:dev` 直接挂掉。

### 7. 上传是独立脚本，不配 forge publisher

| 方案 | 结论 |
|---|---|
| 独立上传脚本 | **采用**。打包在 GitHub Actions、上传在本地，两件事本就分离 |
| forge publisher | 否决。要把 OSS 凭证喂进打包流程，而打包在 CI 上跑 |

⚠️ **脚本必须整目录上传**：`RELEASES` 每次打包都会重写。只传 `.nupkg` 不传
`RELEASES`，客户端永远发现不了新版本。

## 数据与模块形状

### OSS bucket 布局

```
<bucket>/
├── update-manifest.json          灰度名单
└── updates/
    ├── RELEASES                  Squirrel 版本清单（打包产出，勿手改）
    ├── xiaozhi-hotel-1.0.0-full.nupkg
    └── xiaozhi-hotel-1.0.1-full.nupkg
```

`feedUrl` 指向 `<bucket>/updates/`，`manifestUrl` 指向 `<bucket>/update-manifest.json`。
两者由同一个 profile 字段派生，不各配一个。

### update-manifest.json

```jsonc
{
  "allowAll": false,           // true = 全量放开，忽略 allowlist
  "allowlist": [               // sha256(phone + SALT) 的 hex
    "e2fc714c4727ee9395f324cd2e7f331f..."
  ]
}
```

全量放开用显式的 `allowAll` 布尔，不用 `["*"]` 这类魔法字符串——后者会让「名单里恰好
有个哈希等于 `*`」这种边界变得可疑。

### 新增模块

```
apps/desktop/
├── vite-plugins/
│   └── update-feed.ts                  __UPDATE_FEED_URL__ / __UPDATE_SALT__
├── src/main/
│   ├── updater/
│   │   ├── update-endpoint.ts          单行 resolver，照 rms-endpoint.ts
│   │   ├── gray-release-manifest.ts    拉名单 + 解析 + 判定
│   │   └── phone-digest.ts             sha256(phone + salt)
│   ├── services/
│   │   └── updater-service.ts          UpdaterService
│   └── ipc/
│       └── updater-handlers.ts
└── scripts/
    └── oss-uploader.mjs               整目录上传 OSS
```

### UpdaterService 骨架

```ts
export type UpdaterElectron = Readonly<{
  // 只声明用到的能力，便于测试替换（照 SystemService.SystemApp 的做法）
  getVersion: () => string;
  setFeedURL: (options: Readonly<{ url: string }>) => void;
  checkForUpdates: () => void;
  on: (event: 'update-downloaded' | 'error', listener: (...args: never[]) => void) => void;
}>;

export type UpdaterServiceDependencies = Readonly<{
  autoUpdater: UpdaterElectron;
  feedUrl: string | null;          // null = 本环境不启用
  manifestUrl: string | null;
  platform: NodeJS.Platform;
  fetchManifest: (url: string) => Promise<GrayReleaseManifest>;
  digestPhone: (phone: string) => string;
  onUpdateReady: () => void;       // 通知渲染进程
  logger: AppLogger;
  reportError: ErrorReporter;
}>;

export class UpdaterService {
  private checked = false;         // 单次运行只检查一次

  constructor(private readonly deps: UpdaterServiceDependencies) {}

  /** 登录后调用。任何失败都只记录，不抛。 */
  async checkOnce(identity: StaffIdentity): Promise<void>;
}
```

`checkOnce` 的判定顺序（任一不满足即静默返回）：

```
platform === 'win32'  →  feedUrl 非空  →  identity.phone 非空
   →  拉 manifest 成功  →  allowAll 或 digest 命中
   →  setFeedURL + checkForUpdates
```

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **真 Windows 上从未验证过**——`add-windows-installer-pipeline` 的 3.6 至今未打勾，安装包是否能正常安装启动都还是未知 | 本次不承诺端到端可用。tasks 里把真机验证单列，未完成前不得声称完成 |
| 灰度名单误配（哈希算错、盐不一致）导致全员不升或全员升 | 提供一个本地算哈希的脚本，与运行时用同一份实现；上传前可自测 |
| `RELEASES` 未随 `.nupkg` 一起上传，客户端发现不了新版本 | 上传脚本整目录同步，不提供「只传某个文件」的选项 |
| 无代码签名，首次安装被 SmartScreen 拦 | 与自动更新无关（更新不经 SmartScreen），但分发时需提前告知客户 |
| 手机号哈希可被拆包取盐后穷举 | 接受。见决策 2 |
| 更新包 250MB+，客户带宽差时下载长期占用 | OSS 支持断点续传；下载在后台不影响使用。本次不做限速 |
| online 与 pre 当前共用同一个 RMS 后端（`app-env-profiles.mjs` 已注明） | 与本变更无关，但在分发给客户前应单独处理 |

## Migration Plan

```
1. 实现 + 单测                            本仓库
2. 开 OSS bucket（公共读），地址填进 profile   人工，仓库外
3. bump version → 1.0.1
4. GitHub Actions 打包 online/win64
5. 下载产物，跑上传脚本 → OSS
6. manifest 只放 1 个试点手机号哈希          灰度开始
7. 真 Windows 验证 1.0.0 → 1.0.1 全流程     ⚠️ 阻塞项，无 Windows 环境
8. 观察无异常 → allowAll: true            全量
```

**回滚**：把 `allowAll` 改回 `false` 并清空 `allowlist`，阻止后续升级。已升级机器
无法自动退回（见决策 5），只能人工重装。

## Open Questions

- OSS bucket 的具体地址与 bucket 名待开通后填入 profile 表
- 盐值的具体取值待定；它是编译期常量，确定后写入 profile 同源注入
