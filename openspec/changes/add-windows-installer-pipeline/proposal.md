# 在真 Windows 上产出桌面端安装包

## Why

本地只有 macOS(arm64)，打不出 Windows 安装包：Squirrel 在非 Windows 上要 Mono + Wine，
而 `wine-stable` 已被 Homebrew 标记 deprecated（2026-09-01 停用），arm64 上还要经
Rosetta 模拟 x86。补齐这条链路时发现 **Windows 安装包此前从未被真正产出过**，打包配置
里积压了 6 个缺陷，其中 2 个影响的不只是 Windows。

## What Changes

- 新增 GitHub Actions 流水线，在 `windows-latest` 上产出 Squirrel 安装包
- 修复 6 个打包缺陷（详见 `design.md`），其中：
  - postPackage 重签判宿主平台而非目标平台 —— macOS 上打任何非 mac 包必挂
  - 渲染进程配置无条件读开发证书 —— **任何干净检出都打不了包**
  - Squirrel 缺 `authors` —— **Windows 安装包从来没打成功过**
- 不改动本地打包、`npm run dev` 与任何现有 npm 脚本的行为
