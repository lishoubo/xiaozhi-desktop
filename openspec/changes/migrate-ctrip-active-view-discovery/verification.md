# Verification

## 结论

携程当前 View 酒店发现、受信任 URL 校验、单酒店临时 credential 身份和多酒店不落库行为均有
定向测试证据；类型检查、Svelte 检查、ESLint 和全部 desktop unit 测试通过。desktop component
全量套件存在与本次 main 进程改动无关的测试环境失败，未将该套件标记为通过。

## TDD 证据

### 携程渠道模块红灯

命令：

```text
npm run test:unit -- tests/unit/main/ctrip-discovery.test.ts
```

实现前结果：失败。Vitest 无法解析尚未创建的 `main/ota/ctrip/discover-ctrip` 模块。

### 落库编排红灯

命令：

```text
npm run test:unit -- tests/unit/main/discover-and-create.test.ts
```

实现前结果：16 个测试中 14 个通过、2 个失败；失败项分别证明携程单酒店尚未创建带身份的
credential、已有 credential 尚未刷新身份。

## 定向验证

命令：

```text
npm run test:unit -- tests/unit/main/ctrip-discovery.test.ts tests/unit/main/discover-and-create.test.ts
```

结果：2 个测试文件通过，20 个测试全部通过。

覆盖行为：

- 直接使用当前 `webContents`，不调用 `loadURL` 或 `close`。
- 只接受 `https://ebooking.ctrip.com/*`，相似恶意域名不执行页面脚本。
- 单酒店生成 `channelAccountId=hotelId` 和 `identitySource=hotel-dom`。
- 已有 credential 刷新临时身份和时间。
- 多酒店不创建或更新 credential/account。
- DOM 无有效酒店或脚本异常时安全返回 `none`。

## 完成态验证

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 通过；TypeScript、Svelte 均为 0 error / 0 warning |
| `npm run lint` | 通过 |
| `npm test` | 部分通过；unit 44/44 文件、219/219 测试通过；component 9 个文件通过、3 个文件失败 |
| `git diff --check` | 通过 |

component 失败共 24 项，集中在 `AppRouting.test.ts`、`BrowserWorkspace.test.ts` 和
`ProductUX.test.ts`，共同错误为测试运行时 `localStorage` 未提供，调用 `localStorage.clear()`
时读取到 `undefined`。运行器同时输出 `--localstorage-file was not provided` 警告。本次没有修改
renderer、component 测试或 Vitest 配置，因此该环境问题未在本 change 中扩展处理，也未重复运行
全量套件。

## Verification Pass

- 需求到代码映射完整：当前 View、域名校验、单酒店临时身份、多酒店不落库均有实现和测试。
- 旧 `CtripDiscoveryProbe`、隐藏 `WebContentsView` 和 `sessionForPartition` 携程依赖已删除。
- `credentialExtra` 只保存酒店 ID、名称和来源标记，不包含 Cookie、token 或个人信息。
- 稳定规范 `local-ota-credentials` 已同步对应行为变化。

## Code-review Pass

未发现阻断问题。保留的已知限制是：当前携程落地页在 15 秒内没有渲染目标酒店链接时返回
`none`；实现不会偷偷导航到固定页面，符合本次设计和用户确认的当前 View 约束。
