## Part A: RMS models, Gateway ports, hotel management CRUD（tasks.md 第 2、3 节）

范围：`RmsHotel`/`RmsOtaAccount` 领域模型、`RmsHotelGateway`/`RmsOtaAccountGateway` port
与有状态 mock、酒店管理 IPC/preload、renderer 页面从静态 mock 切换为真实加载 +
新增酒店 + 删除酒店 + 解绑 OTA 账号。不含 OTA 绑定探测流程（Part B，另行验证）。

### 自动化测试

```
$ npx vitest run --config vitest.unit.config.mts
 Test Files  55 passed (55)
      Tests  255 passed (255)

$ npx vitest run --config vitest.component.config.mts
 Test Files  11 passed (11)
      Tests  41 passed (41)

$ npm run check
> tsc --noEmit --project tsconfig.node.json   (0 errors)
> svelte-check --tsconfig ./tsconfig.renderer.json
  822 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

新增/修改的测试文件：

- `tests/unit/domain/rms-hotel.test.ts`（新增）
- `tests/unit/domain/rms-ota-account.test.ts`（新增）
- `tests/unit/main/hotel-management-handlers.test.ts`（新增）
- `tests/unit/preload/api.test.ts`（追加 hotelManagement 用例）
- `tests/unit/renderer-hotel-management.test.ts`（改造为消费 `RmsOtaAccountDto`，去掉旧
  `MOCK_MANAGED_HOTELS` 依赖）
- `tests/component/HotelManagementPage.test.ts`（改造为 mock `window.hotelButler.hotelManagement`，
  精简为 2 个核心用例：数据加载渲染 + 错误态；不做多步骤 Dialog 交互的细粒度测试）
- `tests/component/AppRouting.test.ts`（补充 `hotelManagement` mock 与
  `otaCredential.onDiscoveryCompleted` mock，修正断言以匹配真实 IPC 数据流）

### 既有失败测试处理

`tests/component/BrowserWorkspace.test.ts`（6 个用例）在本次改动前已经因为缺少
`otaCredential.onDiscoveryCompleted` mock 而失败（用 `git stash` 验证过基线同样失败，
与酒店管理功能无关，是另一次 `otaCredential` 命名空间收敛改动遗留的测试缺口）。
经用户确认后直接删除该测试文件，不在本 change 里修复。

### Code review（inline，非独立 pass）

- 修正 `hotel-management-handlers.ts` 里 `try/catch` 无法捕获异步 `listener` rejection 的
  bug（改用 `Promise.resolve(...).catch(...)`），否则 Gateway 拒绝时不会记录
  `Hotel management operation failed` 日志。
- 删除死代码 `assertValidRmsHotelCreateInput`（未被任何调用点使用）。
- 修正"删除酒店"按钮误用 `Building2`（酒店）图标，改为 `Trash2`。
- 修正 `BoundOtaAccountCard` 点击"解绑"未收起详情弹出层的问题。

### 未覆盖 / 遗留给 Part B

- OTA 绑定探测流程（intent 总线、`HotelBindingFeature`、`OtaHotelProbFeature` 改造、
  候选确认、Cookie 导出）：tasks.md 第 4–7 节。
- UI 截图验证（8.3）与独立 code-review pass（8.4）：待 Part B 完成、页面具备完整绑定
  入口后一并做，避免过早截图验证一个功能不完整的页面。
