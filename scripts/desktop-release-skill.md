---
name: desktop-release
description: 发布 Windows 桌面客户端新版本——bump 版本号、引导用户打包、上传安装包到 OSS、管理灰度名单。当用户说"发版""发布新版本""上传安装包""调整灰度""放开全量"时使用。
---

# 桌面客户端发布

把 Windows 安装包发到 OSS，并用灰度名单控制哪些客户会自动升级。

## 先读这一节：这套机制的三条硬约束

违反任何一条都会导致**静默失败**——没有报错，只是客户永远收不到更新。

| 约束 | 违反后果 |
|---|---|
| `RELEASES` 必须与 `.nupkg` 一起上传 | 只传包不传清单，客户端永远发现不了新版本 |
| 灰度名单的盐必须与打包时一致 | 哈希对不上，表现为"所有人都不升级" |
| 版本号必须递增 | Squirrel 只升不降，版本号没变就什么也不会发生 |

**还有一条不可逆的**：Squirrel 没有降级路径。把名单改回去只能阻止"尚未升级的机器继续升级"，已经升上去的不会退回——那只能人工重装。**所以灰度必须真的灰：先给一家，确认没问题再放量。**

## 平台范围

| 平台 | 行为 |
|---|---|
| Windows | 静默下载，退出时自动安装 |
| macOS | **只提示**「发现新版本 x.y.z」+ 下载按钮，用户自己装 |
| Linux | 同 macOS（实际没有 Linux 客户） |

macOS 不做自动更新——更新替换要求新旧产物签名身份一致，而本项目不做代码签名。买了 Apple Developer 账号（$99/年）做签名+公证后才能改。

只有 **online** 环境有更新源。dev / pre 的 `updateFeedUrl` 是 `null`，更新器静默关闭。

## OSS 布局

```
xiaozhi-desktop-release/
├── update-manifest.json        灰度名单（平台无关）
├── win32/                      Squirrel feed
│   ├── RELEASES
│   ├── xiaozhi-hotel-<版本>-full.nupkg
│   └── 小智酒店管家-setup.exe
└── darwin/                     macOS 安装包，只供人工下载
    ├── 小智酒店管家-darwin-arm64-<版本>.zip
    └── 小智酒店管家-darwin-x64-<版本>.zip
```

**按平台分目录是有意的**：Squirrel.Windows 与 Squirrel.Mac 都用 `RELEASES` 这个文件名，混在一起两者没法共存。而 feedUrl 写死在已发布产物里改不了——等将来做 Mac 自动更新时再分目录，装着老版本的客户就接不上了。

---

## 流程一：发布新版本

### 步骤 1 — 确认本地与远端一致

CI 从 GitHub 上的分支打包，**不是从本地文件**。本地改了没推，打出来的就是旧代码。

⚠️ **这个仓库有两个远端，而 `dev` 分支只跟踪 `origin`（Codeup）**：

```
origin   Codeup，团队主远端，日常协作      ← dev 跟踪的是这个
github   只用于跑 CI，打包读的是这个        ← 但 CI 用的是这个
```

**`git push` 默认只推 Codeup，GitHub 那边不会自动跟上。** 这是最容易踩的坑——本地干净、`git status` 什么都不说，但 GitHub 上还是几天前的代码。

必须显式检查 GitHub：

```bash
git fetch github                      # 本地可能没有 github/dev 这个 ref
git log --oneline github/dev..HEAD    # 必须是空的
```

有输出就说明 GitHub 落后，**停下来告诉用户差了哪些提交**，问是否要 `git push github dev`。不要自己推。

另外确认工作区干净：

```bash
git status --short
```

### 步骤 2 — bump 版本号

```bash
# 看当前版本
node -p "require('./apps/desktop/package.json').version"
```

改 `apps/desktop/package.json` 的 `version` 字段。语义化版本：修 bug 改第三位，加功能改第二位。

**改完要提交并推送**，否则 CI 打出来的还是旧版本号。这一步要问用户确认后再做。

### 步骤 3 — 提示用户打包

打包在 GitHub Actions 上跑，**你不能替用户触发**。告诉用户：

> 去 GitHub Actions → "构建 Windows 安装包" → Run workflow
> 分支选 `dev`，环境选 `online`
> 跑完下载 artifact（约 20-40 分钟）

如果用户已经有打好的包，让他给出目录路径，直接跳到步骤 4。

### 步骤 4 — 检查产物

用户给的是 zip 就先解压：

```bash
unzip <下载的zip> -d /tmp/win-release
ls -la /tmp/win-release
```

**必须看到三个文件**：

```
RELEASES                          几十字节，带 UTF-8 BOM
xiaozhi-hotel-<版本>-full.nupkg    约 150 MB
小智酒店管家-setup.exe              约 150 MB，给新客户首次安装
```

核对版本号是否与步骤 2 改的一致：

```bash
cat /tmp/win-release/RELEASES
```

输出形如 `<SHA1> xiaozhi-hotel-1.0.1-full.nupkg <字节数>`。**如果版本号不对，说明 CI 打的是旧代码**，回到步骤 1 查为什么。

### 步骤 5 — 上传

```bash
# 先 dry-run 看要传什么
node scripts/oss-uploader.mjs --dir=/tmp/win-release --dry-run

# 确认无误再真传
node scripts/oss-uploader.mjs --dir=/tmp/win-release
```

有 macOS 包就一起传（`--mac-dir` 只收文件名含 `darwin` 的 zip/dmg，防止把 Windows 的 zip 误传进去）：

```bash
node scripts/oss-uploader.mjs --dir=/tmp/win-release --mac-dir=/tmp/mac-release
```

脚本会：
- 校验 `RELEASES` 与 `.nupkg` 同时存在，缺一个就拒绝
- **`RELEASES` 最后传**——它是 Squirrel 的"开关"，先传包再传清单，客户端不会在包还没传完时就读到指向它的清单
- 旧版本的 `.nupkg` 不删（Squirrel 做增量更新时可能回读）

### 步骤 6 — 验证上传成功

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
  https://xiaozhi-desktop-release.oss-cn-beijing.aliyuncs.com/win32/RELEASES
```

**必须是 200**。403 说明 bucket 不是公共读——Squirrel 匿名下载会全部失败，而这个失败在客户端只体现为"没更新"，很难查。

---

## 流程二：管理灰度名单

名单是 OSS 根目录下的 `update-manifest.json`，决定哪些客户会自动升级。

```jsonc
{
  "allowAll": false,      // true = 全量放开，忽略 allowlist
  "allowlist": [          // sha256(手机号 + 盐) 的 hex，不存明文
    "8cde03e3..."
  ]
}
```

### 生成名单

```bash
# 灰度：只让指定手机号升级
node scripts/gray-release.mjs set --phone=13800138000 > /tmp/update-manifest.json

# 多个手机号
node scripts/gray-release.mjs set --phone=138xxx --phone=139xxx > /tmp/update-manifest.json

# 全量放开
node scripts/gray-release.mjs set --all > /tmp/update-manifest.json

# 停止发放（已升级的不会退回）
node scripts/gray-release.mjs set --none > /tmp/update-manifest.json
```

**带上 macOS 的提示**（Windows 不读这几个字段，它看 `RELEASES`）：

```bash
node scripts/gray-release.mjs set --phone=138xxx \
  --version=1.0.1 \
  --mac-arm64=https://xiaozhi-desktop-release.oss-cn-beijing.aliyuncs.com/darwin/小智酒店管家-darwin-arm64-1.0.1.zip \
  --mac-x64=https://xiaozhi-desktop-release.oss-cn-beijing.aliyuncs.com/darwin/小智酒店管家-darwin-x64-1.0.1.zip \
  > /tmp/update-manifest.json
```

不填 `--version` 就不会提示 Mac 用户。填了但缺对应架构的地址，则只报版本号、不给下载按钮——**给错架构的包比不给更糟**，用户下回来打不开还以为是应用坏了。

### ⚠️ 名单是全量覆盖，不是追加

每次 `set` 都产出一份完整名单。**要加人就得把已有的人一起重新列出来**，漏掉谁，谁就被踢出名单了。

```bash
# 原来名单里有 138xxx，现在要再加 139xxx —— 两个都要写
node scripts/gray-release.mjs set --phone=138xxx --phone=139xxx > /tmp/m.json
```

**而且名单存的是哈希，反推不出手机号。** 拉下来只能看出"名单里有几个人"，看不出"是谁"：

```bash
curl -s https://xiaozhi-desktop-release.oss-cn-beijing.aliyuncs.com/update-manifest.json
```

所以改名单前**先问用户当前名单里有哪些手机号**，不要假设、不要凭上下文猜。用户自己也需要在仓库外维护一份记录（名单是加盐哈希，这是有意的设计，不是缺陷）。

判断办法：把用户给的手机号逐个算哈希，与线上名单比对，确认覆盖后没有意外少人：

```bash
node scripts/gray-release.mjs digest --phone=138xxx   # 哈希打 stdout，手机号打 stderr
```

### 上传名单

```bash
# 先看一眼这份名单意味着什么
node scripts/oss-uploader.mjs --manifest=/tmp/update-manifest.json --dry-run

# 确认后上传
node scripts/oss-uploader.mjs --manifest=/tmp/update-manifest.json
```

脚本会校验 JSON 结构，并回显"这份名单意味着什么"（几个手机号 / 全量放开 / 空名单）。结构不对直接拒绝——名单传错的后果是静默的，客户端读不懂就当"不命中"，表现为所有人都不升级，没有任何报错。

发版和灰度可以一次做完：

```bash
node scripts/oss-uploader.mjs --dir=/tmp/win-release --manifest=/tmp/update-manifest.json
```

传完验证：

```bash
curl -s https://xiaozhi-desktop-release.oss-cn-beijing.aliyuncs.com/update-manifest.json
```

### 为什么存哈希不存明文

更新源 bucket 是公共读的（Squirrel 匿名下载），明文名单等同于公开客户手机号。加盐是必需的——手机号只有 11 位且号段有限，无盐 sha256 可被穷举反查。

盐随包分发、拆包可得。它挡的是"拿到一个公开 URL 就能还原全部客户手机号"，**不是加密，是提高门槛**。

---

## 客户端行为（排查时需要知道）

更新检查发生在**登录之后**，判定顺序是：

```
平台是 win32？ → 有更新源？ → 有手机号？ → 拉到名单？ → 命中名单？ → 启动 Squirrel
```

任一不满足即**静默跳过**，不报错、不提示。

几个容易被误判成 bug 的正常行为：

| 现象 | 原因 |
|---|---|
| 用户没登录就收不到更新 | 灰度判据是手机号，登录前拿不到 |
| 服务商员工收不到更新 | 他们用用户名密码登录，可能没有手机号；身份不足以判定灰度时保守不升 |
| macOS 完全没反应 | 设计如此，不做 macOS 自动更新 |
| 同一次运行只检查一次 | 三个触发点（登录 / 验证码登录 / 冷启动恢复会话）共用一个标志 |

下载完成后会弹一条常驻提示「新版本已就绪」，安装发生在**用户下次退出应用时**，不会主动重启打断操作。

日志在客户端的 `logs` 目录，关键字 `Update check`、`Auto update`、`gray release`。

---

## 凭证

`scripts/.oss.env`（已在 .gitignore），模板 `scripts/oss-env.example`。

脚本按「环境变量 → `.oss.env`」的顺序取值。

⚠️ **这个 key 能改写更新源。泄露等于可以给所有客户推任意程序**——应用没有代码签名，Squirrel 不校验发布者身份，唯一的信任来源就是"这个 URL 上的东西是我们放的"。不要打印、不要贴进对话、不要写进代码。

---

## 需要停下来问用户的时刻

- 本地有未推送的提交
- 要改版本号（改之前确认）
- 要往灰度名单加人——**先问清当前名单里有哪些手机号**。名单是全量覆盖且存的是
  哈希，线上那份看不出是谁；漏掉一个人就等于把他踢出名单
- 要执行 `--all` 全量放开（影响所有客户，且不可回滚）
- 产物里的版本号与预期不符
- 上传验证返回非 200
- 用户要求"回滚"——**必须说明**：Squirrel 只升不降，改名单只能阻止未升级的机器，已升级的要人工重装

## 不要做的事

- 不要自己 `git push`（包括 `git push github dev`）
- 不要自己触发 GitHub Actions
- 不要绕过 `oss-uploader.mjs` 直接调 OSS API（校验逻辑都在脚本里）
- 不要手写 `update-manifest.json`，用 `gray-release.mjs` 生成（盐值一致性靠它保证）
- 不要在未确认的情况下上传 `--all` 的名单
- 不要打印或回显 `.oss.env` 的内容
