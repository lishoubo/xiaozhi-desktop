# 内嵌浏览器实现方案

## 目标效果

桌面 App 不是外部打开 Chrome，而是在 App 主窗口内嵌一个受控浏览器区域：

```text
RMS Desktop App
├─ 左侧菜单
│  ├─ 首页
│  ├─ OTA 账号
│  ├─ 酒店管理
│  ├─ 任务中心
│  └─ 数据分析
├─ 顶部导航
│  ├─ 当前酒店
│  ├─ 当前 OTA 平台
│  ├─ 当前账号
│  ├─ 添加/删除酒店
│  └─ 登录态状态
└─ 主内容区
   └─ 内嵌 OTA 浏览器
      ├─ 用户像普通浏览器一样登录
      ├─ 用户可以人工操作 OTA 后台
      ├─ App 监听网络请求和响应
      ├─ App 捕获 Cookie/profile
      └─ App 识别改价、改库存、切换酒店等关键动作
```

核心不是“模拟一个浏览器 UI”，而是把一个 Chromium 页面容器嵌进自己的桌面界面，并由主进程控制它。

## WebContentsView 是什么

`WebContentsView` 是 Electron 提供的网页内容容器。它可以渲染和控制一个网页，底层使用 Electron 自带的 Chromium。

可以理解为：

```text
Chrome Tab 的核心渲染能力
+ Electron 主进程控制能力
- Chrome 浏览器产品本身的完整外壳
```

它不是：

- 不是外部启动的 Google Chrome。
- 不是系统默认浏览器。
- 不是简单 iframe。
- 不是一个普通 DOM 节点。

它是：

- Electron 窗口里的一个独立网页视图。
- 由 Electron 主进程创建、定位、加载 URL、监听事件。
- 拥有自己的 `webContents`、`session`、Cookie、缓存、localStorage。
- 可以监听导航、请求、响应、下载、新窗口、权限请求等事件。

Electron 官方目前更建议使用 `WebContentsView`，而不是 `<webview>`。`<webview>` 是渲染进程里的标签，Electron 官方文档提醒其架构稳定性和未来兼容性不如 `WebContentsView`。

## 和 Chrome 有什么区别

### 相同点

`WebContentsView` 和 Chrome 非常接近的部分：

| 能力 | WebContentsView | Chrome |
| --- | --- | --- |
| 渲染引擎 | Chromium | Chromium |
| JS 引擎 | V8 | V8 |
| DOM/CSS | Chromium 实现 | Chromium 实现 |
| 网络栈 | Chromium 网络栈 | Chromium 网络栈 |
| Cookie | 支持 | 支持 |
| localStorage/sessionStorage | 支持 | 支持 |
| IndexedDB | 支持 | 支持 |
| Service Worker | 支持 | 支持 |
| DevTools Protocol | 支持 | 支持 |
| 多进程渲染 | 支持 | 支持 |

对普通网站来说，它就是一个 Chromium 浏览器页面。

### 不同点

差异主要在“浏览器产品外壳”和“环境指纹”：

| 维度 | WebContentsView / Electron | Google Chrome |
| --- | --- | --- |
| 浏览器品牌 | Electron/Chromium | Google Chrome |
| User-Agent | 默认可能包含 Electron 或特定 Chromium 信息 | 标准 Chrome UA |
| Chrome 服务 | 没有完整 Google Chrome 产品服务 | 有 Chrome 产品集成 |
| 扩展生态 | 可支持部分扩展，但不是完整用户 Chrome 环境 | 完整 Chrome 扩展生态 |
| Profile 目录 | App 自己管理 | Chrome 用户 profile |
| 自动更新 | 跟随 App 更新 | Chrome 自己更新 |
| 安全策略 | 由 Electron App 配置 | Chrome 产品默认策略 |
| API 暴露 | 可被 App 控制和隔离 | 普通网站不能被外部 App 这样控制 |
| 窗口外壳 | App 自己的 UI | Chrome 地址栏、标签页、设置页 |

所以更准确的说法是：

```text
WebContentsView 是真实 Chromium 页面，不是假的浏览器；
但它不是完整 Google Chrome 产品。
```

## 会不会被反爬识别

有可能。是否被识别取决于目标平台的风控强度。

Electron 内嵌浏览器比 `curl` / 纯 HTTP 请求更像真实浏览器，因为它真的运行 Chromium、执行 JS、保存 Cookie、运行页面脚本。但它不等于普通用户的 Google Chrome。强风控平台可能通过多种信号识别环境差异。

### 风控可能看的信号

| 信号 | 风险 |
| --- | --- |
| User-Agent | 默认 UA 可能和普通 Chrome 不同 |
| `navigator.webdriver` | 自动化控制时可能暴露 |
| 浏览器特性 | 某些 Chrome/Electron 特性差异 |
| 字体/插件/语言/时区 | 用户环境画像异常 |
| WebGL/Canvas/Audio 指纹 | 设备指纹不稳定或异常 |
| IP 地址 | 云服务器、代理、频繁切换 IP 风险高 |
| 行为节奏 | 点击、输入、访问间隔太机械 |
| Cookie 生命周期 | 多账号共享、频繁迁移、异常复用 |
| 请求顺序 | 未按真实页面流程访问 |
| Header 细节 | Sec-Fetch、Origin、Referer、Accept-Language 等异常 |
| 并发行为 | 多账号、多酒店同时操作异常 |

### 反爬风险判断

| 方案 | 风控风险 |
| --- | --- |
| 纯 `curl` / `requests` 硬拼接口 | 最高，除非接口简单且 token 规则稳定 |
| Electron WebContentsView 人工登录和操作 | 较低，更接近真实用户 |
| Playwright/DrissionPage 自动化完整操作 | 中等，取决于自动化痕迹和行为节奏 |
| 浏览器登录 + HTTP 抓数据 | 中等偏低，前提是请求上下文真实 |
| 真实 Chrome 人工操作 | 最低，但不方便嵌入和监听 |

结论：

```text
WebContentsView 能显著降低“非浏览器请求”的异常感；
但不能保证绕过强反爬。
```

如果目标平台风控很强，可以考虑两级方案：

1. 普通场景使用 Electron WebContentsView。
2. 高风险平台或登录阶段允许外部真实 Chrome 接管，再把 Cookie/profile 同步回来。

## 与现有 DrissionPage 有头方案的风控差异

现有 `/Users/lishoubo/p/projects/xiaozhi-rms-workspace` 里的 RPA worker 已经做了不少反自动化处理：

- DrissionPage `auto_port()` 启动 Chromium。
- 有头模式下保留真实浏览器窗口。
- 设置 `--disable-blink-features=AutomationControlled`。
- 设置 Mac Chrome User-Agent。
- 设置 `--lang=zh-CN`、窗口尺寸、语言偏好。
- 通过 CDP `Network.setUserAgentOverride` 覆盖 UA 和语言。
- 注入 stealth init script，处理 `navigator.webdriver`、`navigator.plugins`、`navigator.mimeTypes`、`navigator.languages`、`window.chrome` 等常见检测点。
- 通过页面上下文里的 `browser_post_json` / `browser_fetch_json` 发接口，而不是完全用外部 HTTP client 硬拼。

这解释了为什么“不是无头，基本没事”：有头 Chromium + 页面上下文请求，已经比纯 `curl` / headless 自动化自然很多。

### WebContentsView 和现有 DrissionPage 有头方案对比

| 维度 | 现有 DrissionPage 有头 | Electron WebContentsView |
| --- | --- | --- |
| 浏览器内核 | Chromium | Electron 内置 Chromium |
| 是否真实渲染页面 | 是 | 是 |
| 是否执行页面 JS | 是 | 是 |
| Cookie/localStorage | 支持 | 支持 |
| 页面上下文发请求 | 支持 | 支持 |
| 是否外部 Chrome 产品 | 通常是 Chromium/Chrome 进程，取决于 DrissionPage 配置 | 不是 Google Chrome 产品，是 Electron Chromium |
| 默认 UA | 可通过参数/CDP 改成 Chrome UA | 需要主动改，默认可能暴露 Electron/Chromium 差异 |
| 自动化特征 | 有 remote debugging、auto_port、可能有自动化痕迹 | App 嵌入环境、Electron 特征、可被识别 |
| UI 体验 | 弹独立浏览器窗口 | 嵌在 App 主窗口内，产品体验更好 |
| 监听能力 | 通过 DrissionPage/CDP/页面脚本 | 通过 Electron webRequest、webContents、CDP |
| 用户手动操作 | 可以，但不在 App 内 | 可以，且在 App 内和账号/酒店上下文绑定 |
| 多账号管理 | 需要自建 profile/cookie 管理 | 可以用 session partition 做产品化隔离 |
| 风控风险 | 有头时较低，取决于启动参数和行为 | 中等偏低，但默认不应假设低于真实 Chrome |

### 被发现概率的实际判断

不能给出“百分之几”的准确概率，因为 OTA 平台的风控规则不可见，而且会变化。更有用的判断是相对风险：

```text
真实 Chrome 人工操作
  < DrissionPage 有头 + 真实 Chrome UA + stealth + 页面上下文请求
  ≈ 调优后的 Electron WebContentsView + 持久 profile + 用户真实操作
  < headless 浏览器自动化
  < 纯 curl / requests 硬拼接口
```

其中 `≈` 不是严格等于。对某些平台，Electron 环境可能比现有 DrissionPage 有头更容易被识别；对另一些平台，如果用户真的在内嵌浏览器里登录和操作，且 UA、语言、profile、行为节奏都正常，差异可能不明显。

### 关键风险点

如果直接用 Electron 默认配置，风险会比现有 DrissionPage 有头方案更高：

- 默认 User-Agent 可能不是目标平台熟悉的 Chrome UA。
- Electron 运行环境可能存在可检测差异。
- 新 profile 太干净，没有正常用户长期使用痕迹。
- App 监听/注入脚本如果过度，会改变页面环境。
- 如果用程序批量操作，行为节奏仍可能机械。

如果要降低风险，Electron 内嵌浏览器至少要做到：

- 使用普通 Chrome UA，并同步 `sec-ch-ua`、语言、平台等相关 client hints。
- 使用持久 profile，不要每次新建干净环境。
- 登录、验证码、关键高风险操作优先让用户手动完成。
- 不在页面里注入大量容易被检测的业务脚本。
- 监听优先放在 Electron 主进程的 `webRequest` / CDP 网络层，不污染页面 JS 环境。
- 自动化任务和用户可见浏览器分离，避免用户窗口突然被脚本接管。
- 保留“外部真实 Chrome 登录/接管”作为高风险平台兜底。

## 安全边界是什么意思

“安全边界”指的是：内嵌 OTA 后台是第三方网页，不能把它当成自己可信的前端页面。

第三方网页在 App 里运行时，如果边界没设计好，可能带来这些风险：

- OTA 页面或其第三方脚本拿到本地文件权限。
- 远程网页调用 Electron/Node API。
- 远程网页访问本地 API，例如 `127.0.0.1` 上的任务接口。
- 恶意跳转到钓鱼页面，诱导用户输入账号密码。
- 新窗口打开不受控页面。
- 下载恶意文件。
- 通过 IPC 调用敏感能力，例如读取 Cookie、导出数据、执行 RPA 任务。

所以原则是：

```text
React 管理端是可信页面；
OTA 后台是第三方不可信页面；
二者必须隔离。
```

必须做：

- OTA WebContents 禁用 `nodeIntegration`。
- 开启 `contextIsolation`。
- 开启 `sandbox`。
- 不向 OTA 页面暴露业务 preload API。
- 本地 API 只监听 `127.0.0.1`，并加随机 token。
- IPC 按来源校验，不允许第三方页面调用敏感 IPC。
- 限制导航域名和新窗口。
- Cookie、账号、酒店、任务权限在主进程统一管理。

## 签名、公证、代码签名、自动更新是什么意思

这些是桌面 App 分发阶段必须处理的问题。

### macOS 签名和公证

macOS 用户下载 App 后，如果没有正确签名和公证，常见结果是：

- 系统提示“无法打开，因为无法验证开发者”。
- Gatekeeper 拦截。
- 自动更新后的新版本打不开。
- App 访问本地文件、网络、辅助能力时体验不稳定。

需要做：

- 申请 Apple Developer ID。
- 对 App、helper、内置二进制、Python sidecar 做签名。
- 提交 Apple notarization。
- 分发 `.dmg` 或 `.pkg`。

### Windows 代码签名

Windows 上如果没有代码签名，常见结果是：

- SmartScreen 提示风险。
- 杀毒软件误报概率上升。
- 企业用户安装阻力大。
- 自动更新包不可信。

需要做：

- 购买代码签名证书。
- 对安装包、exe、更新包签名。
- 建立发布流水线。

### 自动更新

桌面 App 不能靠用户手动替换文件。自动更新需要提前设计：

- 更新源。
- 版本号策略。
- 差分包或全量包。
- 更新包签名校验。
- 失败回滚。
- 数据库 migration。
- Python/RPA/浏览器依赖升级。

这不是第一天必须全部完成，但架构上要预留，否则后面补会很痛。

## Cookie 和登录态能不能保存

可以。

Electron 的 session 可以保存：

- Cookie。
- localStorage。
- sessionStorage。
- IndexedDB。
- Cache Storage。
- Service Worker。
- 浏览器缓存。
- 站点权限。

推荐按业务维度隔离 session：

```text
persist:rms_douyin_hotel_1001_account_a
persist:rms_douyin_hotel_1001_account_b
persist:rms_meituan_hotel_1001_account_a
persist:rms_ctrip_hotel_2002_account_c
```

切换酒店或账号时，不要清空全局浏览器，而是切换到对应 profile。

### 推荐 profile 设计

```text
userData/
└─ profiles/
   ├─ electron/
   │  ├─ douyin/hotel_1001/account_a/
   │  ├─ douyin/hotel_1001/account_b/
   │  └─ meituan/hotel_1001/account_a/
   └─ rpa/
      ├─ douyin/hotel_1001/account_a/
      └─ meituan/hotel_1001/account_a/
```

原则：

- 一个 OTA 平台、一个酒店、一个账号，对应一个独立 profile。
- 不同账号不要共用 Cookie。
- 不同平台不要共用 Cookie。
- 不同酒店如果 OTA 后台上下文容易串，也要隔离。
- profile 目录要支持备份、迁移、清空、重新登录。

## 如何监听用户操作

不要把“监听用户操作”理解成主要监听鼠标点击。真正稳定的方案是监听业务请求。

用户在 OTA 后台手动改价时，页面最终会发请求，例如：

```http
POST /api/price/update
POST /hotel/rate/save
POST /calendar/batchUpdate
```

App 应该监听：

```text
用户点击改价
→ 页面发起价格更新接口
→ Electron 捕获请求 URL、method、headers、body
→ Electron 捕获响应状态和结果
→ 平台规则解析为 PRICE_UPDATE 业务动作
→ 写入本地操作审计
→ 触发价格数据刷新
→ 必要时通知 Agent 重新分析
```

### 可监听内容

| 类型 | 说明 |
| --- | --- |
| 页面导航 | 用户进入哪个 OTA 页面 |
| 网络请求 | URL、method、headers、部分 request body |
| 网络响应 | 状态码、headers，响应体可通过 CDP 获取 |
| Cookie 变化 | 判断登录态建立、过期、退出 |
| 下载 | 报表导出、文件保存 |
| 新窗口 | 登录授权、支付、跳转页 |
| 权限请求 | 剪贴板、通知、定位等 |
| DOM 状态 | 可作为辅助判断，不作为唯一依据 |

### 不推荐的判断方式

```text
用户点了某个按钮 = 改价成功
```

这个不可靠，因为：

- 按钮点击后接口可能失败。
- 可能还有二次确认。
- 页面可能弹验证码。
- 请求参数可能没有变化。
- 用户可能取消操作。
- 页面文案和 DOM 结构可能变化。

推荐判断方式：

```text
识别价格更新接口
+ 解析请求参数
+ 解析响应结果
+ 必要时重新抓取价格校验
= 确认改价动作
```

## 实现结构

```text
Electron Main Process
├─ 创建主窗口 BrowserWindow
├─ 创建 WebContentsView 作为 OTA 浏览器
├─ 管理 session partition
├─ 监听 webContents 导航事件
├─ 监听 session.webRequest 请求事件
├─ 使用 CDP 获取更完整 network 信息
├─ 管理 Cookie/profile
└─ 通过 IPC 把业务事件发给 React UI

React Renderer
├─ 左侧菜单
├─ 顶部酒店/账号导航
├─ 浏览器区域占位和布局
├─ 任务状态展示
└─ 操作审计展示
```

### 示例：创建内嵌浏览器

```ts
const win = new BrowserWindow({
  width: 1400,
  height: 900,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
  },
});

await win.loadURL("app://rms-ui");

const otaView = new WebContentsView({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    partition: "persist:rms_douyin_hotel_1001_account_a",
  },
});

win.contentView.addChildView(otaView);

otaView.setBounds({
  x: 240,
  y: 64,
  width: 1160,
  height: 836,
});

await otaView.webContents.loadURL("https://life.douyin.com/merchant");
```

### 示例：监听价格相关请求

```ts
const ses = otaView.webContents.session;

ses.webRequest.onBeforeRequest(
  { urls: ["https://*.douyin.com/*", "https://*.meituan.com/*"] },
  (details, callback) => {
    if (details.method === "POST" && details.url.includes("price")) {
      recordPossibleAction({
        kind: "PRICE_UPDATE_REQUEST",
        url: details.url,
        method: details.method,
        uploadData: details.uploadData,
      });
    }

    callback({});
  }
);

ses.webRequest.onCompleted(
  { urls: ["https://*.douyin.com/*", "https://*.meituan.com/*"] },
  (details) => {
    if (details.method === "POST" && details.url.includes("price")) {
      recordPossibleAction({
        kind: "PRICE_UPDATE_RESPONSE",
        url: details.url,
        statusCode: details.statusCode,
      });
    }
  }
);
```

实际项目中不应该只用 `url.includes("price")`，而应该为每个平台维护明确规则：

```ts
{
  platform: "douyin",
  action: "PRICE_UPDATE",
  match: {
    method: "POST",
    urlPatterns: [
      "/calendar/batchUpdate",
      "/rate/save"
    ]
  },
  parseRequest: "parseDouyinPriceUpdateRequest",
  parseResponse: "parseDouyinPriceUpdateResponse",
  verifyAfterSuccess: true
}
```

## WebContentsView 与 RPA Worker 的关系

建议分工：

| 模块 | 职责 |
| --- | --- |
| WebContentsView | 用户登录、人工操作、人工接管、查看 OTA 后台、捕获登录态 |
| RPA Worker | 自动爬数据、定时任务、批量操作、失败重试、截图/trace |
| Local API | 任务编排、数据入库、操作审计、Agent 调用 |

不要让内嵌浏览器承担所有 RPA 任务。

原因：

- 用户可见浏览器需要保持稳定和响应。
- RPA 任务可能失败、卡住、重启。
- 自动任务需要独立超时、重试、并发控制。
- 自动任务的诊断材料要独立保存。
- 后续可能把 RPA worker 扩展到远程节点。

推荐关系：

```text
内嵌浏览器负责登录态建立和人工接管
RPA worker 负责自动化执行
二者通过 profile/cookie/storageState 同步上下文
```

## 实际浏览器差异的应对策略

为了让 WebContentsView 更接近普通用户浏览器，需要做：

- 使用正常的 User-Agent，不暴露 Electron 特征。
- 设置合理的 Accept-Language、locale、timezone。
- 使用持久化 profile，不要每次都是全新环境。
- 不频繁清空 Cookie。
- 避免多个账号共享同一个 profile。
- 避免机械化点击和固定间隔。
- 尽量让用户完成首次登录和验证码。
- 数据抓取优先复用真实页面产生的上下文。
- 对高风险操作做人工确认。
- 操作后做结果校验，而不是只相信请求成功。

但不要过度承诺：

```text
WebContentsView 更像真实浏览器，但不是反爬免疫方案。
```

如果某个平台风控特别强，可以保留兜底策略：

- 外部 Chrome 登录。
- 手动导入 Cookie。
- 账号级暂停和重新验证。
- 降低抓取频率。
- 改用平台开放 API。
- 必要时让用户人工执行高风险动作，App 只监听和记录结果。

## 结论

推荐第一版：

```text
Electron WebContentsView
+ session partition 隔离账号/酒店
+ webRequest/CDP 监听业务接口
+ 本地 profile 保存登录态
+ RPA worker 独立执行自动任务
+ 平台规则识别用户操作
```

它和 Chrome 的关系：

```text
底层浏览器能力接近 Chrome，因为都是 Chromium；
产品外壳和环境指纹不同，因为它不是 Google Chrome。
```

它可以保存 Cookie 和登录态，也可以让用户像普通浏览器一样登录。但反爬风险不能完全消除，产品设计上要把“人工登录 + 请求监听 + 结果校验 + 失败接管”作为基础能力。
