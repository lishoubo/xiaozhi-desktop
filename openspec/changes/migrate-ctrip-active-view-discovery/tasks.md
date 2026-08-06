## 1. 携程当前页面发现

- [x] 1.1 为受信任当前页面、单酒店临时 credential 身份、多酒店和不受信任页面补充定向失败测试
- [x] 1.2 在 `main/ota/ctrip/` 实现当前 `webContents` DOM 发现、URL 校验和携程结果映射

## 2. 落库编排与模块迁移

- [x] 2.1 为携程单酒店 credential 创建/刷新以及多酒店不落库补充编排测试
- [x] 2.2 将携程显式接入 `DiscoverAndCreate` 的带身份落库流程，并保持其他渠道行为不变
- [x] 2.3 更新 composition root，删除旧隐藏 View 携程 probe 及其过期测试/依赖

## 3. 验证与规范收敛

- [x] 3.1 运行携程发现和发现落库的定向测试
- [x] 3.2 运行 desktop 受影响模块完成态验证并执行独立 verification 与 code-review pass
- [x] 3.3 同步 `local-ota-credentials` 稳定规范并记录验证证据
