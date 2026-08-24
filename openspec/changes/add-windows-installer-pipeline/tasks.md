# Tasks

## 1. 修复打包缺陷

- [x] 1.1 postPackage 重签改判目标平台（`forge.config.ts`）— `84a1cb5`
- [x] 1.2 开发服务器证书改惰性读取（`vite.renderer.config.mts`）— `c971d5a`
- [x] 1.3 禁止 `@electron/rebuild` 重编 better-sqlite3（`forge.config.ts`）— `6137466`
- [x] 1.4 补 MakerSquirrel 的 `authors`（`forge.config.ts`）— `b09fb63`

## 2. 流水线

- [x] 2.1 新增 `.github/workflows/build-windows.yml`，手动触发、可选 env 与 variant — `d81a1cc`
- [x] 2.2 `npm ci --ignore-scripts` 绕开隐式 node-gyp — `8f72339`
- [x] 2.3 补跑被跳过的必需安装脚本（7z / esbuild / svelte-kit）— `49457a0`
- [x] 2.4 修正产物路径，补上 `buildIdentifier` 目录层 — `eddb04c`

## 3. 验证

- [x] 3.1 本地 macOS 无证书环境下 `--target=win64 --package-only` 打包成功
- [x] 3.2 `check:desktop` 通过（1256 文件 0 错误）
- [x] 3.3 `lint:desktop` 通过
- [x] 3.4 CI 在 windows-latest 上产出 Squirrel 安装包（run #8，288 MB）
- [x] 3.5 核对产物环境标识为 online、无 dev/pre 串味
- [ ] 3.6 **真 Windows 上安装并启动**（本地无 Windows，未执行）

## 4. 收尾

- [x] 4.1 同步 8 个 commit 到 Codeup（`d10db23..eddb04c`，快进）
- [ ] 4.2 `specs/` delta 合并进 `openspec/specs/desktop-build-environments/`（待 3.6 通过后）
