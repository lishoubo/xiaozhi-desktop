# 验证记录

## TDD 证据

- 账号身份测试首次运行因 `account-identity` 模块尚不存在而失败，随后实现解析器与当前 View 读取表达式。
- 编排测试首次运行时，抖音 credential 创建与刷新两个用例因尚未接入显式发现分支而失败，随后完成接入。
- 受信任域名测试首次运行发现非抖音页面仍会执行身份读取脚本，随后增加当前 View HTTPS 域名校验，并改为从当前 URL 读取 `groupid`。

## 定向验证

- 命令：`npm run test:unit -- tests/unit/main/douyin-account-identity.test.ts tests/unit/main/douyin-discovery.test.ts tests/unit/main/discover-and-create.test.ts`
- 结果：3 个测试文件、25 个测试全部通过。

## 完成态门禁

- `npm run check`：通过，TypeScript 与 Svelte 均为 0 errors / 0 warnings。
- `npm run lint`：通过。
- `npm test`：unit 45 个文件、225 个测试全部通过；component 中 9 个文件、28 个测试通过，另有 3 个文件共 24 个测试因测试环境没有提供 `localStorage` 而失败，报错包含 `localStorage is not defined` 与 `--localstorage-file was not provided`。该问题未由本次抖音改动引入。
- 受影响代码的 Prettier 检查：通过。
- `git diff --check`：通过。

## Verification pass

- 当前可见 View 同源调用 `GET /life/gate/v1/user/login_info/`，只携带账号与商户组参数并复用现有登录态。
- `groupId` 来自当前 URL，`accountId` 来自 `getAccountDetail.data.account_id`，实际请求成功返回完整身份。
- `user_id` 正规化为 credential 的渠道账号 ID；附加信息只包含登录 ID、名称、角色名称和角色类型。
- 身份缺失或格式无效时，本次发现失败且不创建或更新 credential/account。
- 既有 CDP 酒店发现结果继续保存酒店 ID、名称和商户组上下文，并与同一 credential 关联。
- 当前页面不是 `https://life.douyin.com` 时，不执行登录信息请求。

## Code-review pass

- 已修复 review 中发现的安全问题：身份请求前校验当前 View 的协议和主机，并避免使用过期 landing URL 推导商户组。
- 未发现阻塞交付的新增问题。
- 真机结构日志确认 `PartnerPrefetchStorage` 不含 `getLoginInfo`，实现已改用页面实际调用的同源登录信息接口。

## 真机验收

- 抖音发现结果为 `found`，保存 1 家酒店。
- credential 实际保存 `channelAccountId`、`loginId`、`name`、`roleName` 和 `roleType`。
- 酒店账号保存酒店 ID、名称与 `merchantGroupId`，并关联本次创建的 credential。
