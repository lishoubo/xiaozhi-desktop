# 验证记录

- 定向测试：`amount-change-report-service.test.ts`、`rms-api-call-reporting.test.ts`、`rms-amount-change-gateway-http.test.ts`，31/31 通过。
- 桌面端单元测试：`npm run test:unit --workspace @hotel-butler/desktop`，140 个文件、1397 个用例通过。
- 类型检查：`npm run check:types --workspace @hotel-butler/desktop` 通过。
- 本次修改文件的 ESLint 检查通过。
- OpenSpec：`openspec validate retry-ota-change-report --strict` 通过；差量已同步到 `openspec/specs/ota-amount-change-report/spec.md`。
- 全量 desktop lint 未通过：并行单测期间生成的边界探针文件产生 9 个预期的限制错误，另有两个未修改的库存测试文件中 4 个 `_omitted` 未使用错误；测试结束后探针文件已清除。本次修改文件单独 lint 通过。
