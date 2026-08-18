# 验证证据

## 静态验证（已完成）

### 类型与 Svelte 检查

```
$ npm run check
> tsc --noEmit --project tsconfig.node.json
> svelte-check --tsconfig ./tsconfig.renderer.json
COMPLETED 1253 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

### Lint

```
$ npm run lint
> eslint --ext .ts,.tsx,.mts .
（无输出，通过）
```

### 单元测试

定向（`renderer-permissions.test.ts`）：

```
✓ tests/unit/renderer-permissions.test.ts (5 tests) 1ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

5 条覆盖 spec 的能力派生要求：含 `hotel:manage` → true；只读码 → false；
空数组 → false；`null` 会话 → false；phone 变体（无 `permissions` 字段）→ false。

完成态全量（desktop 单测）：

```
 Test Files  1 failed | 97 passed (98)
      Tests  1 failed | 687 passed (688)
```

**唯一失败项与本次改动无关**：`tests/unit/main/app-env.test.ts > resolveRmsOriginForBuild >
online 地址未确定时构建失败`。已用 `git stash` 把本次全部改动移出工作区后复跑，
该用例**在干净树上同样失败**，确认为既有失败，非本次引入。本次改动只触及
renderer 三个文件，不涉及 `main/app-env`。

### 入口覆盖核对

| # | 入口 | 位置 | 收口方式 |
|---|---|---|---|
| 1 | 新增酒店 | `HotelManagementPage.svelte:281` | `{#if canManage}` |
| 2 | 删除酒店 | `HotelManagementPage.svelte:371` | `{#if canManage}`（与入口 3 同一容器） |
| 3 | 新增绑定账号 | `HotelManagementPage.svelte:371` | 同上 |
| 4 | 解绑账号 | `BoundOtaAccountCard.svelte:150` | `{#if canManage}` 包住整条操作栏 |
| 5 | 重新认证 | `BoundOtaAccountCard.svelte:150` | 同上 |

`BoundOtaAccountCard` 全仓唯一使用方是 `HotelManagementPage.svelte:353`，已传
`canManage`；prop 为必填，漏传会编译失败。

## 真机验证（待执行）

以下三项需要启动应用并用两个真实账号登录，**尚未执行**：

- [ ] 5.3 酒店用户 `13693214089` 短信登录 → 酒店管理页 → 截图确认 5 个入口均不可见、
      只读信息（酒店名、已绑定账号、状态）正常展示
- [ ] 5.4 服务商 `admin` 密码登录 → 同页面 → 截图确认 5 个入口均照常出现
- [ ] 5.5 以酒店用户登录后**重启应用**（走 `restoreSession` 而非登录路径），
      确认写入口仍不出现

5.5 是最易漏的一条：spec 明确要求登录与会话恢复两条路径行为一致。
