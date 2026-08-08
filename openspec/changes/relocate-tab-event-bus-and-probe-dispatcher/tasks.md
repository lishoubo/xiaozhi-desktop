## 1. 总线归位

- [x] 1.1 `git mv src/main/services/tab-event-bus.ts src/main/ota-tab/tab-event-bus.ts`（用 git mv 保留历史）
- [x] 1.2 修正该文件顶部注释：删除对已不存在的 `main/features/ota-credential/` 的引用，改为指向 `main/services/ota-credential-service.ts`；补一句「本总线与唯一发射方 `login-detector.ts` 同居」
- [x] 1.3 `src/main/ota-tab/index.ts` 导出 `TabEventBus` 与 `TabCredentialCheckedEvent`、`CredentialCheckOutcome` 类型
- [x] 1.4 `src/main/ota-tab/login-detector.ts`：import 路径由 `../services/tab-event-bus` 改为 `./tab-event-bus`
- [x] 1.5 `src/main/composition/window-scope.ts`：import 路径改为从 `../ota-tab` 导入
- [x] 1.6 `src/main/services/ota-credential-service.ts`：注释中 `main/services/tab-event-bus.ts` 的路径引用更新为新位置

## 2. 探测调度器移位与改名

- [x] 2.1 `git mv src/main/services/ota-hotel-prob-service.ts src/main/channels/hotel-probe-dispatcher.ts`
- [x] 2.2 类名 `OtaHotelProbService` → `HotelProbeDispatcher`；依赖类型 `OtaHotelProbFeatureDependencies` → `HotelProbeDispatcherDependencies`
- [x] 2.3 该文件 import 路径调整：`../ids` → `../ids` 不变；`../../shared/logging` 不变；`../services/tab-event-bus` → `../ota-tab`；`../channels/types` → `./types`
- [x] 2.4 顶部注释更新：说明它只做分发（订阅事实 → 选 probe → 调用 → 记日志），探测逻辑在各渠道 `hotel-prob.ts`；保留 Change 1 关于「不写库、不早退」的说明
- [x] 2.5 `src/main/composition/window-scope.ts`：import 路径与类名更新为 `HotelProbeDispatcher`

## 3. eslint 约束固化

- [x] 3.1 `apps/desktop/.eslintrc.json` 的 `import/no-restricted-paths` 增加 5 条 zone（target 均为 `./src/main/channels`，from 分别为 `services`/`database`/`gateway`/`ipc`/`composition`），message 按 design.md 决策 4 逐条写明
- [x] 3.2 在 zones 上方加注释说明：`ota-tab/` 是有意放行的唯一外部依赖（`channels/` 需订阅 tab 生命周期事实），不是遗漏
- [x] 3.3 `npm run lint --workspace @hotel-butler/desktop` 通过；**若报出本次改动之外的既有违规，暂停并报告，不擅自扩大修改范围**

## 4. 测试

- [x] 4.1 `git mv tests/unit/main/ota-hotel-prob-service.test.ts tests/unit/main/hotel-probe-dispatcher.test.ts`
- [x] 4.2 该文件内 import 路径与类名更新（`HotelProbeDispatcher`、`../../../src/main/channels/hotel-probe-dispatcher`、总线从 `ota-tab` 导入）；`describe` 名称同步改为 `HotelProbeDispatcher`
- [x] 4.3 `tests/unit/main/tab-event-bus.test.ts`：import 路径改为 `../../../src/main/ota-tab/tab-event-bus`
- [x] 4.4 `tests/unit/main/login-detector.test.ts`：import 路径改为从 `ota-tab` 导入
- [x] 4.5 全仓搜索 `ota-hotel-prob-service`、`OtaHotelProbService`、`services/tab-event-bus` 残留引用（含注释与文档），确认为 0

## 5. 验证

- [x] 5.1 `npm run check --workspace @hotel-butler/desktop`（tsc + svelte-check）通过
- [x] 5.2 `npm run lint --workspace @hotel-butler/desktop` 通过
- [x] 5.3 迭代期定向测试：`npm run test:unit:desktop -- hotel-probe-dispatcher`、`-- tab-event-bus`、`-- login-detector`
- [x] 5.4 完成态跑一次单元测试全量：`npm run test:unit:desktop`，确认仍为 224 tests 全绿（本次不新增不删除用例）
- [x] 5.5 反向验证 lint 规则真的生效：临时在 `channels/` 某文件加一行 `import ... from '../database/ota-hotel-repository'`，确认 `npm run lint` 报错，然后**撤销该临时改动**
- [x] 5.6 启动应用确认无报错、装配正常，`git diff` 确认方法体零改动（**探测链路本次未被实际触发，见 verification.md「未能验证」**）
- [x] 5.7 将验证证据写入 `openspec/changes/relocate-tab-event-bus-and-probe-dispatcher/verification.md`
