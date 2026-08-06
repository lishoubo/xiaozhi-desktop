## 1. 登录会话与账号控制

- [x] 1.1 确认 `BrowserTab` 与账号记录均可取得 `channelId`、`partitionName` 和账号显示字段。
- [x] 1.2 在 renderer 内实现按当前渠道和 `partitionName` 聚合 `LoginSessionOption`，同 Session 多门店只展示一项。
- [x] 1.3 实现当前登录账号控件与账号列表，展示当前状态、账号标签及关联门店数量。
- [x] 1.4 打开账号列表前隐藏 WebContentsView；取消选择时恢复原活动标签。
- [x] 1.5 切换账号时先打开目标 partition，成功后关闭当前渠道旧 partition 的标签。
- [x] 1.6 账号区 `＋` 打开账号列表；列表内“登录新渠道账号”才创建新登录 partition。

## 2. 两层头部布局

- [x] 2.1 渠道导航改为 64px 图文入口行，背景 `#F4F6FA`，入口高 40px，并增加 UI 短名称。
- [x] 2.2 页面工作栏改为 64px 三列布局，背景 `#FAFBFC`，浏览器控制、标签区与账号区垂直居中。
- [x] 2.3 标签区支持 132–200px 标签宽度和横向滚动；账号区保持 220–300px 并固定在右侧。
- [x] 2.4 标签区 `＋` 使用当前账号的现有 partition 新建标签，不关闭原标签。
- [x] 2.5 从 `BrowserWorkspace` 移除旧 `AccountsNav` 挂载。
- [ ] 2.6 UI 验收后删除不再引用的旧 `AccountsNav` 组件文件。

## 3. 验证与后续

- [x] 3.1 核心组件测试保留 3 项：两层头部、同 Session 新标签、切换账号关闭旧标签。
- [x] 3.2 定向组件测试通过：`tests/component/BrowserWorkspace.test.ts`，3/3 passed。
- [x] 3.3 desktop TypeScript 与 Svelte 检查通过：0 errors、0 warnings。
- [x] 3.4 `git diff --check` 通过。
- [ ] 3.5 启动 desktop，手工验证常规宽度与窄窗口布局并保存截图。
- [ ] 3.6 手工验证账号列表取消、切换失败恢复、新账号登录与真实同 Session 多标签。
- [ ] 3.7 独立执行 verification pass。
- [ ] 3.8 独立执行 code-review pass，重点检查 partition 去重、WebContentsView 恢复路径、可访问性和无关改动。
