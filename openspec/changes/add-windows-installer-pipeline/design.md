## Context

动机见 `proposal.md - Why`。这里记录塑造实现路径的现状约束与踩坑。

**出发点**：本地 macOS(arm64) 打不出 Windows 安装包。三条候选路径的取舍：

| 方案 | 成本 | 可靠性 | 结论 |
|---|---|---|---|
| Mac 装 Mono + Wine | 3.5 GB，半小时 | arm64 经 Rosetta 跑 x86 Squirrel，成功率存疑；cask 8 天后停用 | 否决 |
| Docker + Mono/Wine | 同上，且 arm64 要 QEMU 模拟 x86 | 更差 | 否决 |
| GitHub Actions `windows-latest` | 私有仓 Free 额度每月 1000 Windows 分钟，单次约 20-40 分钟 | 真 Windows，原生路径 | **采用** |

云效流水线（远端本在 Codeup，不必外推代码）需要 Windows 构建节点，账号是否具备未确认，
未纳入本次。

**远端拓扑**：`origin` 仍是 Codeup（团队主远端），新增 `github` 远端只用于跑 CI。
Codeup 不识别 `.github/workflows/`，该目录在主仓库中是惰性文件。

```
origin (Codeup)  ← 团队主远端，日常协作
github           ← 仅跑 CI，产出安装包
```

## Goals / Non-Goals

**Goals:**

- 在真 Windows 上产出 Squirrel 安装包，产物含 `.exe` / `.nupkg` / `RELEASES`
- 复用仓库现成的 `make:desktop:<env>:win64`，CI 里不另写一套打包逻辑
- 手动触发：出包是发布动作，不该由 push 隐式触发，也省额度

**Non-Goals:**

- 不做代码签名（Squirrel 产物未签名，Windows 会有 SmartScreen 提示）
- 不做自动发布 / 自动更新服务端（`.nupkg` + `RELEASES` 已收，为将来留口）
- 不改动 macOS 打包与 `npm run dev` 的任何现有行为

## 缺陷清单

六个缺陷按暴露顺序排列。**关键观察：其中两个的影响面远超 Windows。**

| # | 缺陷 | 位置 | 影响面 |
|---|---|---|---|
| 1 | postPackage 重签判宿主平台 | `forge.config.ts` | macOS 上打任何非 mac 包必挂 |
| 2 | node-gyp 编译 better-sqlite3 | CI `npm ci` | 任何无 Visual Studio 的 Windows |
| 3 | 无条件读开发 HTTPS 证书 | `vite.renderer.config.mts` | **任何干净检出都打不了包** |
| 4 | electron/rebuild 重编原生模块 | `forge.config.ts` | 任何无 VS 的机器 |
| 5 | Squirrel 缺 `authors` | `forge.config.ts` | **Windows 安装包从未打成过** |
| 6 | 产物路径漏 `buildIdentifier` 层 | workflow | CI |

### 1. postPackage 判错平台

```
if (process.platform !== 'darwin') return;   // 宿主平台
```

在 macOS 上打 Windows 包时宿主仍是 darwin，hook 照常执行，去 `codesign` 一个不存在的
`.app`——**packaging 已经成功，却被收尾 hook 弄挂**。判据应是 hook 入参里的目标平台：

```ts
postPackage: async (_forgeConfig, { platform, outputPaths }) => {
  if (platform !== 'darwin' || process.platform !== 'darwin') return;
```

宿主也要判：`codesign` 只有 macOS 才有。

### 2 & 4. 两处多余的原生模块编译

`better-sqlite3` 随包发布全平台预编译产物，`lib/binding.js` 的解析优先级是：

```
prebuilds/<platform>-<arch>.node     ← 优先
build/Debug/better_sqlite3.node
build/Release/better_sqlite3.node    ← 兜底
```

本地 macOS 的 `build/Release/` 里只有 `obj.target`，没有 `.node`——**说明本地一直走
prebuilds，从未真正编译过**。但有两处会触发无谓的编译：

| 触发点 | 机制 | 处理 |
|---|---|---|
| `npm ci` | 包带 `binding.gyp`，npm 隐式跑 node-gyp（该包连 `install` 脚本都没有） | `--ignore-scripts` |
| Forge 打包 | `@electron/rebuild` 为 Electron ABI 重编 | `rebuildConfig.onlyModules: []` |

runner 上的失败信息有迷惑性：

```
gyp ERR! find VS unknown version "undefined" found at
         "C:\Program Files\Microsoft Visual Studio\18\Enterprise"
```

**不是缺工具链，是 node-gyp@10 认不出镜像自带的 VS 18。** 但既然编译本就多余，不必去
折腾 node-gyp 版本。

`onlyModules: []` 的行为经源码确认（`@electron/rebuild/lib/rebuild.js:80`）：
`options.onlyModules || null` 对空数组返回 `[]` 而非 null，后续
`this.onlyModules.includes(modulePath)` 恒为 false，等于不重编任何模块。

### 3. 打包不该依赖开发证书

`vite.renderer.config.mts` 在模块顶层无条件读证书：

```ts
server: {
  https: {
    cert: readFileSync(path.join(certificateDirectory, 'cert.pem')),  // 打包也会执行
    key:  readFileSync(path.join(certificateDirectory, 'dev.pem')),
  },
}
```

`server.https` 只有 `vite dev` 用得到，但写在配置对象里 → `vite build` 加载配置时就执行
→ **任何没跑过 `https:setup` 的干净检出都打不了包**。CI 只是第一个撞上的。

改为 `defineConfig` 的函数形式，按 command 惰性读取：

```ts
export default defineConfig(({ command }) => ({
  server: {
    ...(command === 'serve' ? { https: developmentServerHttps() } : {}),
  },
}));
```

### 5. Squirrel 缺 authors

```
Attempting to build package from 'xiaozhi-hotel.nuspec'.
Authors is required.
```

NuGet 规范要求 `authors` 必填，`apps/desktop/package.json` 里没有 `author` 字段。补在
maker 里而非 package.json——不为一个 Windows 打包细节去动通用包元数据。

**这个缺陷证明该项目的 Windows 安装包此前从未被产出过**：任何一次真 Windows 上的
`make` 都会撞上它。

### 6. 产物路径

`forge.config.ts` 设了 `buildIdentifier: authVariant`，产物落在 `out/<variant>/make/`
而非 `out/make/`。Forge 收尾会打印真实位置：

```
› Artifacts available at: ...\apps\desktop\out\staff\make
```

## npm 脚本的精确跳过

`--ignore-scripts` 是全局的，会连带跳过**必需**的安装脚本。npm 没有"只禁某个包"的选项，
因此全禁之后显式补回：

| 脚本 | 作用 | 缺了会怎样 |
|---|---|---|
| `electron-winstaller/script/select-7z-arch.js` | 把 `vendor/7z-<arch>.exe` 拷成 `7z.exe` | Squirrel 报 `The system cannot find the file specified` |
| `esbuild/install.js` | 就位 esbuild 原生二进制 | Vite 构建失败 |
| `@hotel-butler/server` 的 `prepare` | 生成 `.svelte-kit/` 类型 | desktop 的 check 读不到 |

第一条是本次踩的坑：先加了全局 `--ignore-scripts` 解决 node-gyp，反而引入了 7z 缺失。

## 流水线形状

```
workflow_dispatch (手动，选 env + variant)
  │
  ├─ checkout
  ├─ setup-node 24            ← 跟随 engines 约束
  ├─ npm ci --ignore-scripts  ← 绕开 better-sqlite3 隐式编译
  ├─ 补跑必需的安装脚本        ← 7z / esbuild / svelte-kit
  ├─ npm run make:desktop:<env>:win64   ← 复用现成脚本，不另写逻辑
  └─ upload-artifact
       out/<variant>/make/squirrel.windows/x64/{*.exe,*.nupkg,RELEASES}
```

`.nupkg` 与 `RELEASES` 一并收取：只留 `.exe` 会丢掉将来做增量更新的能力。

## 决策记录

| 决策 | 取舍 | 结论 |
|---|---|---|
| 触发方式 | push 触发省事 vs 手动可控 | 手动。出包是发布动作，且 Windows runner 按 2 倍计费 |
| CI 里的打包命令 | 另写 forge 调用 vs 复用 npm script | 复用。避免 CI 与本地两套逻辑漂移 |
| `authors` 放哪 | package.json vs maker 配置 | maker。不为 Windows 细节动通用元数据 |
| 跳过 node-gyp | 修 node-gyp 版本 vs 跳过编译 | 跳过。编译本就多余，prebuilds 优先级更高 |
| 远端拓扑 | 迁移到 GitHub vs 双远端 | 双远端。Codeup 仍是团队主远端 |
