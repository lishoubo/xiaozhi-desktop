# 重划 desktop main 分层

## Why

`main/` 的分层执行不彻底：`application.ts` 同时承担进程入口 / 对象装配 / 生命周期 / 业务决策四个角色；`features/` 混装了编排、渠道适配器和 mock；IPC handler 有的走 feature、有的直连 repository，边界靠约定而非强制。同时测试有 7501 行（源码 12729 行），其中约 2000 行锁的是日志文案、CSS 常量和组件时序，重构必然全红且无保护价值。

## What Changes

- `main/features/` → `main/services/`，只留业务编排；准入标准写进 AGENTS.md
- 渠道适配器从三个 feature 目录上提为 `main/channels/`，新增 `registry.ts` 统一注册
- `OtaTabOpener` 移出 features，拆为 `main/ota-tab/`（`OtaTabService` + `LoginDetector`）
- `application.ts` 拆为 `main/index.ts`（进程入口）+ `main/composition/`（app-scope / window-scope / wire-*）
- 6 份重复的 IPC 信任校验样板收敛为 `createHandlerRegistry`
- `browser-handlers.ts` 按 channel 分组拆为 4 个；`preload/api.ts` 拆为 namespaces
- 补齐 `CalendarService` / `CookieImportService` / `SystemService`，IPC 层禁止直连 repository（eslint 强制）
- domain 保留并明确定义；删除死代码与失效的编译期守卫
- 删除 `tests/component/` 全目录及锁日志/文案/常量的 unit 测试；编排层测试随重构重写

## Non-goals

- 不合并 `domain/` 与 `shared/`（见 design 决策 7）
- 不改任何业务行为；E2E 用例不修改，作为验收基线
- 不动 `apps/server/`、`packages/api/`、`renderer/` 的内部结构
