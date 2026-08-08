# 验证证据

验证时间：2026-08-08 16:20 – 16:46
验证人：Claude（Opus 5）

## 静态检查

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 + Svelte | `npm run check --workspace @hotel-butler/desktop` | ✅ `COMPLETED 828 FILES 0 ERRORS 0 WARNINGS` |
| Lint | `npm run lint --workspace @hotel-butler/desktop` | ✅ 通过，无输出 |

新增的 5 条 `channels/` zone **未报出任何既有违规**——`channels/` 此前已是零 `services`/`database`/`gateway`/`ipc`/`composition` 依赖，本次是把既成事实写进 lint，而非新增约束。

## 单元测试

```
Test Files  49 passed (49)
     Tests  224 passed (224)
```

与 Change 1 完成时**数量完全一致**（49 files / 224 tests），本次不新增不删除用例——符合「纯结构调整、零行为变化」的预期。

## lint 规则反向验证

临时在 `src/main/channels/registry.ts` 顶部加入一行 `import type { OtaHotelRepository } from '../database/ota-hotel-repository';`：

```
/Users/lishoubo/.../src/main/channels/registry.ts
  1:41  error  Unexpected path "../database/ota-hotel-repository" imported in restricted zone.
               channels/ 不直接落库；持久化由 composition root 注入的回调完成  import/no-restricted-paths

✖ 2 problems (2 errors, 0 warnings)
```

规则确实生效，且 message 是设计时写的那一条。临时改动已撤销（`git diff` 确认该文件只剩预期内的注释改名）。

## 零行为变化的证据

`hotel-probe-dispatcher.ts` 的 diff 中，剔除注释与 import 后的全部实质改动：

```
-export type OtaHotelProbFeatureDependencies = Readonly<{
+export type HotelProbeDispatcherDependencies = Readonly<{
-export class OtaHotelProbService {
-  constructor(private readonly deps: OtaHotelProbFeatureDependencies) {
+export class HotelProbeDispatcher {
+  constructor(private readonly deps: HotelProbeDispatcherDependencies) {
```

**方法体零差异**——只有类型名与类名变化。三个文件移动均由 `git mv` 完成，`git diff -M` 识别为重命名，历史可追溯。

## 运行时验证

应用于 16:26:21 启动，16:46:19 关闭（运行约 20 分钟，期间开了 5 个标签页）。

```
[16:26:21.535] Application logging initialized { appVersion: '1.0.0', isPackaged: false, platform: 'darwin' }
[16:26:21.700] Application initialization started
[16:26:21.704] Application database initialized { migrationsApplied: 0, mockEventsSeeded: 8 }
[16:26:21.853] Main window created
[16:26:21.855] Application initialization completed
[16:26:23.633] Renderer logging initialized
[16:46:19.336] Browser workspace closed { tabCount: 5 }
[16:46:19.341] Application shutdown completed
```

- **全程零 error、零 warn**
- `migrationsApplied: 0`——本次不含 migration，符合预期
- 装配链路正常：`HotelProbeDispatcher` 在 `window-scope.ts` 构造时订阅总线，若 import 路径或类名有误，启动即崩

关闭后数据库状态：`ota_hotel=0`、`ota_credential=3`、`migrations=7`（与 Change 1 完成时一致，本次未触碰数据）。

## 未能验证

**探测链路未被实际触发**（tasks 5.6 的后半部分）。本次运行期间日志中没有出现 `Discovery triggered` / `discovery outcome` / `Hotel probe found candidates`——用户开了 5 个标签页但未走导入 Cookie 或打开渠道账号的路径，登录判定未命中，因此 `tab:credential-checked` 未广播，重构后的 `HotelProbeDispatcher` **没有在真实运行中被调用过**。

已有的替代证据：

1. 8 个单元测试覆盖 dispatcher 的全部分支（订阅、选渠道、URL 判断、outcome 分支、异常、重复触发）
2. 方法体零 diff（见上），行为不可能改变
3. 启动时装配成功，说明订阅注册本身没问题

**结论**：静态与单元层面证据充分，真实探测路径的端到端确认留待下次自然使用时观察。本次是纯位置调整，风险集中在 import 正确性上，而这一点已由 tsc 全量类型检查覆盖。
