## 1. 登录会话与账号控制

- [x] 1.1 确认 `BrowserTab` 与 credential 均可取得 `channelId`、`partitionName` 和身份显示字段。
- [x] 1.2 renderer 按当前渠道直接列出 `OtaCredential`，不再从门店账号记录聚合登录 Session。
- [x] 1.3 实现当前登录账号控件与 credential 列表，展示当前状态和渠道身份标签。
- [x] 1.4 打开账号列表前隐藏 WebContentsView；取消选择时恢复原活动标签。
- [x] 1.5 切换账号时先打开目标 partition，成功后关闭当前渠道旧 partition 的标签。
- [x] 1.6 账号区 `＋` 打开账号列表；列表内“登录新渠道账号”才创建新登录 partition。
- [x] 1.7 新增按渠道读取和打开 `OtaCredential` 的 desktop IPC；账号列表不再由 `OtaAccount` 反推登录态。
- [x] 1.8 标签区 `＋` 和账号切换均直接使用 `credentialId` / `partitionName`，即使 credential 尚未关联门店也可使用。
- [x] 1.9 梳理标签关闭流程：关闭当前标签后激活相邻标签，关闭最后一个标签后进入当前渠道空态。
- [x] 1.10 账号列表增加“从 Cookie 导入”，复用现有导入组件，成功后直接使用当前渠道 Cookie 打开工作区。
- [x] 1.11 保留初始化导入后的设置页复核流程；工作区导入失败时保留原账号标签。
- [x] 1.12 同一渠道账号被多个 partition 重复发现时，账号列表按 `channelAccountId` 去重，并优先保留当前活动 credential。
- [x] 1.13 身份探测命中已有 `channelAccountId` 时复用原 credential ID，并更新其 `partitionName` 与身份刷新字段。
- [x] 1.14 被替换的旧 partition 在无标签引用后通过 Electron Session API 清空；清理失败不回滚 credential 更新。

## 2. 两层头部布局

- [x] 2.1 渠道导航改为 64px 图文入口行，背景 `#F4F6FA`，入口高 40px，并增加 UI 短名称。
- [x] 2.2 页面工作栏改为 64px 三列布局，背景 `#FAFBFC`，浏览器控制、标签区与账号区垂直居中。
- [x] 2.3 标签区支持 132–200px 标签宽度和横向滚动；账号区保持 220–300px 并固定在右侧。
- [x] 2.4 标签区 `＋` 使用当前账号的现有 partition 新建标签，不关闭原标签。
- [x] 2.5 从 `BrowserWorkspace` 移除旧 `AccountsNav` 挂载。
- [ ] 2.6 UI 验收后删除不再引用的旧 `AccountsNav` 组件文件。
- [x] 2.7 当前渠道没有可识别 credential 时，右上角账号区展示当前渠道名称。

## 3. 验证与后续

- [x] 3.1 核心组件测试覆盖 5 项：两层头部、同 Session 新标签、切换账号关闭旧标签、关闭最后标签、关闭后激活相邻标签。
- [x] 3.2 定向组件测试通过：`tests/component/BrowserWorkspace.test.ts`，5/5 passed。
- [x] 3.3 desktop TypeScript 与 Svelte 检查通过：0 errors、0 warnings。
- [x] 3.4 `git diff --check` 通过。
- [x] 3.5 启动 desktop，手工验证常规宽度与窄窗口布局并保存截图。
- [ ] 3.6 手工验证账号列表取消、切换失败恢复、新账号登录与真实同 Session 多标签。
- [ ] 3.7 独立执行 verification pass。
- [ ] 3.8 独立执行 code-review pass，重点检查 partition 去重、WebContentsView 恢复路径、可访问性和无关改动。
