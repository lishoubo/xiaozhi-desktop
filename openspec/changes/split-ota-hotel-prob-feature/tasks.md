## 1. 数据层：新表与 domain 模型

- [x] 1.1 `domain/ota-hotel-prob.ts`：新增 `OtaHotelProb` 类型（字段对齐设计决策7）、
      `OtaHotelProbCreateInput`、`OtaHotelProbDiscoveryUpdate`、`createOtaHotelProb()` 校验函数
- [x] 1.2 `domain/identity.ts`：新增 `OtaHotelProbId` branded type + 转换函数
- [x] 1.3 `domain/ports/repositories.ts`：新增 `OtaHotelProbRepository` 接口
      （`create`/`findByChannelAndHotelId`/`findByCredentialId`/`updateDiscovery`）
- [x] 1.4 `main/database/application-database.ts`：新增 migration（version 8），建
      `ota_hotel_prob` 表（SQL 见 design.md 决策7），唯一索引 `(channel, ota_hotel_id)`，
      外键 `credential_id → ota_credential(id)`
- [x] 1.5 `main/database/ota-hotel-prob-repository.ts`：`SqliteOtaHotelProbRepository`
      实现，对齐 `SqliteOtaAccountRepository` 的写法

## 2. 通用能力：TabEventBus 与 URL 校验

- [x] 2.1 `main/browser/tab-event-bus.ts`：新增 `TabEventBus`（继承 `EventEmitter`），
      `TabNavigatedEvent` 类型（tabId/partitionName/channel/url/webContents）；
      文件头部注释写明硬性边界（design.md 决策1）：这里广播的事件只表达"导航
      发生了"这一客观事实，不携带任何业务判断结果，不代表"登录成功"或任何业务
      语义
- [x] 2.2 `main/browser/browser-manager.ts`：构造函数新增 `tabEventBus` 参数（带
      默认值 `new TabEventBus()`，对齐 `sessionFactory` 参数写法）；
      `bindTabEvents()` 内 `did-navigate`/`did-navigate-in-page` 两处各新增一段
      `this.tabEventBus.emitNavigated(...)`，与现有 `checkUrlPastLogin` 调用并列，
      不改动任何现有逻辑分支
- [x] 2.3 `main/features/common/ota/trusted-hotel-url.ts`：新增
      `isTrustedHotelUrl(url, expectedHostname)` 通用校验函数

## 3. 目录迁移：main/account-discovery/ → main/features/ota-credential/

- [x] 3.1 `git mv main/account-discovery/discover-and-create.ts main/features/ota-credential/discover-and-create.ts`
- [x] 3.2 `git mv main/account-discovery/discovery-probe-port.ts main/features/ota-credential/discovery-probe-port.ts`
- [x] 3.3 `git mv main/account-discovery/discovery-probe.ts main/features/ota-credential/discovery-probe.ts`
- [x] 3.4 `git mv main/account-discovery/login-url-matcher.ts main/features/ota-credential/login-url-matcher.ts`
- [x] 3.5 `git mv main/account-discovery/ctrip-login-url-matcher.ts main/features/ota-credential/ota/ctrip/login-url-matcher.ts`
- [x] 3.6 `git mv main/account-discovery/douyin-login-url-matcher.ts main/features/ota-credential/ota/douyin/login-url-matcher.ts`
- [x] 3.7 `git mv main/ota/meituan/login-url-matcher.ts main/features/ota-credential/ota/meituan/login-url-matcher.ts`
- [x] 3.8 更新以上文件相互之间的 import 路径，以及 `main/application.ts`、测试文件
      等外部引用点（`main/ota/{ctrip,douyin,meituan}/discover-*.ts` 相关 import
      留到任务 4-6 一并处理，避免重复改动）
- [x] 3.9 `discover-and-create.ts` 文件头部补充注释（design.md 决策1）：本文件只
      处理登录判定和身份归并，不广播、不代替上层判断任何业务动作是否该发生；
      上层 Feature 要感知登录状态变化，去订阅 `TabEventBus` 的原始导航事件，
      不要依赖本文件的内部调用结果

## 4. 渠道探测拆分：携程（ota-credential 侧不拆；ota-hotel-prob 侧读 credential 翻译）

- [x] 4.1 `git mv main/ota/ctrip/discover-ctrip.ts main/features/ota-credential/ota/ctrip/discover-ctrip.ts`
- [x] 4.2 `git mv main/ota/ctrip/hotel-dom.ts main/features/ota-credential/ota/ctrip/hotel-dom.ts`
- [x] 4.3 `discover-ctrip.ts` 改用 `isTrustedHotelUrl`（common），替换内联的
      `isTrustedCurrentUrl`
- [x] 4.4 新增 `main/features/ota-hotel-prob/ota/ctrip/hotel-prob.ts`：实现
      `HotelProbe` 接口（与抖音/美团同一接口，无特殊旁路）；`isProbeableUrl()`
      恒返回 `true`；`probe()` 不操作页面，用 zod 校验并解析传入的
      `credential.credentialExtra`（`{hotelId, hotelName}`）翻译成
      `HotelProbeOutcome`

## 5. 渠道探测拆分：抖音（拆分身份/酒店两部分）

- [x] 5.1 `git mv main/ota/douyin/account-identity.ts main/features/ota-credential/ota/douyin/account-identity.ts`
- [x] 5.2 `main/features/ota-credential/ota/douyin/discover-douyin.ts`：新写，只保留
      "读 session storage 身份"部分，改用 `isTrustedHotelUrl`；确认
      `READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION` 内部已自行处理 `groupid` 缺失
      （返回 null），外层不需要重复校验
- [x] 5.3 新增 `main/features/ota-hotel-prob/ota/douyin/hotel-prob.ts`：从原
      `discover-douyin.ts` 拆出"点门店管理菜单 + CDP 抓包"部分，`isProbeableUrl()`
      判断落地页 + groupid 存在，`probe()` 返回结果里 `bindExtra` 携带 groupid
- [x] 5.4 `DslGetResponseCapture` 类 → 新增
      `main/features/ota-hotel-prob/ota/douyin/dsl-get-response-capture.ts`，
      保留原文件的踩坑注释（dsl/get 请求体格式、响应时序等背景说明）
- [x] 5.5 删除原 `main/ota/douyin/discover-douyin.ts`（内容已拆分完毕）

## 6. 渠道探测拆分：美团（拆分身份/酒店两部分）

- [x] 6.1 `git mv main/ota/meituan/account-identity.ts main/features/ota-credential/ota/meituan/account-identity.ts`
- [x] 6.2 `main/features/ota-credential/ota/meituan/discover-meituan.ts`：新写，只保留
      "读账号身份"部分，改用 `isTrustedHotelUrl`
- [x] 6.3 新增 `main/features/ota-hotel-prob/ota/meituan/hotel-prob.ts`：只读门店
      列表接口，不重复读身份
- [x] 6.4 `git mv main/ota/meituan/poi-infos.ts main/features/ota-hotel-prob/ota/meituan/poi-infos.ts`
- [x] 6.5 删除原 `main/ota/meituan/discover-meituan.ts`（内容已拆分完毕）

## 7. OtaHotelProbFeature 与组装

- [x] 7.1 新增 `main/features/ota-hotel-prob/hotel-prob-port.ts`：`HotelProbe`
      接口定义（`isProbeableUrl(url)`、`probe(credential, webContents)`）
- [x] 7.2 新增 `main/features/ota-hotel-prob/ota-hotel-prob-feature.ts`：
      `OtaHotelProbFeature` 类，订阅 `tabEventBus`，按渠道分发到对应 `HotelProbe`
      实现，按凭证去重（`repository.findByCredentialId` 命中则跳过），落库
- [x] 7.3 `main/application.ts`：
      - 创建 `TabEventBus` 实例，传给 `new BrowserManager(...)`（新增第4个构造
        参数，带默认值）
      - 创建 `SqliteOtaHotelProbRepository` 实例
      - 创建 `OtaHotelProbFeature` 实例（不用模块级变量持有——构造函数内部完成
        `tabEventBus.on(...)` 订阅，回调闭包持有 this 引用即可防止被 GC），
        注入三渠道 `HotelProbe` 实现
      - `DiscoverAndCreate` 构造参数中移除酒店 upsert 相关依赖（`accountRepository`/
        `generateAccountId`，见任务 8）；`otaAccountRepository` 模块级变量随之
        整体移除（不再有任何调用方，`OtaAccountRepository`/`domain/ota-account.ts`
        本身按 design.md 决策7保留，只是组装根不再构造它的实例）

## 8. DiscoverAndCreate 收口：不再写 OtaAccount

- [x] 8.1 `discover-and-create.ts`：整体重写 `trigger()`/`persistIdentifiedResult()`，
      移除 `upsertAccount()` 调用及相关 `hotels` 遍历逻辑，只保留 credential 归并；
      三渠道分支现在只消费 `result.credential`（抖音/美团探测函数已不再返回
      `hotels` 字段）
- [x] 8.2 移除 `DiscoverAndCreateDependencies` 中 `accountRepository`/
      `generateAccountId` 字段
- [x] 8.3 无需新增携程专属收口逻辑——携程酒店翻译完全在
      `ota-hotel-prob/ota/ctrip/hotel-prob.ts`（任务 4.4）内部完成，
      `DiscoverAndCreate` 不需要为携程做任何特殊处理；通用 `DiscoveryProbe`
      分支（`createCredentialFromHotel`）改为只创建 credential，`hotel` 形参
      标 `_hotel` 保留签名但不再使用（该分支注册表当前为空，无实际调用方）

## 9. 清理与验证

- [x] 9.1 确认 `main/ota/` 目录已清空，删除空目录
- [x] 9.2 确认 `main/account-discovery/` 目录已清空，删除空目录
- [x] 9.3 `grep -rn "main/ota/\|main/account-discovery/"` 确认无残留 import 路径；
      修正了 `domain/ports/discovery.ts` 里一处指向旧路径的注释
- [x] 9.4 `npm run check:types --workspace=apps/desktop` 零错误
- [x] 9.5 迁移/新增单元测试：
      - `tests/unit/main/tab-event-bus.test.ts`（新增，3个用例：多订阅者广播、
        无订阅者不抛错、取消订阅后不再收到）
      - `tests/unit/main/ota-hotel-prob-feature.test.ts`（新增，7个用例：探测
        成功创建记录、按凭证去重跳过、URL不可探测跳过、渠道未注册跳过、找不到
        credential跳过、探测抛错记录警告、已有记录走更新而非新建）
      - `tests/unit/main/database/ota-hotel-prob-repository.test.ts`（新增，
        7个用例，对齐 `ota-account-repository.test.ts` 写法）
      - `ctrip-discovery.test.ts`/`douyin-account-identity.test.ts`/
        `douyin-discovery.test.ts`/`meituan-account-identity.test.ts`/
        `meituan-poi-infos.test.ts`：迁移路径
      - `meituan-discovery.test.ts`：拆分为身份测试（1次executeJavaScript，
        不含hotels）+ 新增 `meituan-hotel-prob.test.ts`（酒店探测）
      - 新增 `douyin-hotel-prob.test.ts`（`isProbeableUrl` 四种场景 + 一个
        无groupid直接none的基础用例，CDP抓包主路径按范围约定未覆盖）
      - `discover-and-create.test.ts`：删除 `accountRepository` 相关全部
        mock/断言，19个用例保留（credential归并行为不变的用例原样保留）
      - `calendar-database.test.ts`：修正 migration 数量断言（7→8，因任务1.4
        新增了 `create-ota-hotel-prob` migration，这是实施中发现的连带影响，
        不在原 tasks.md 范围内）
- [x] 9.6 `npm run test:unit --workspace=apps/desktop` 全量通过：52个测试文件、
      255个用例全部通过
- [x] 9.7 真机验证（携程/抖音/美团三个渠道真实登录）：
      - `ota_credential` 表正常写入（身份归并行为不变）
      - `ota_hotel_prob` 表正常写入酒店信息
      - `ota_account` 表不再新增记录（旧表保留但停止写入，见 design.md 决策7）
      - 抖音场景确认 CDP 抓包不冲突、酒店探测正常完成
      - 首轮真机验证发现两个问题（均已修复并二次真机验证通过，完整技术细节见
        design.md「实施后修复记录」「实施后修复记录二」）：
        1. **credential 时序竞态**：`did-navigate` 里 credential 写入（异步）与
           `TabEventBus` 广播（同步）并行执行，`OtaHotelProbFeature` 可能在
           credential 写完前查到 null 且不会重试。修复：`checkUrlPastLogin`
           改为 async，广播延后到 credential 确认之后；`TabEventBus` 事件从
           `emitNavigated` 换成携带处理结果的 `emitCredentialChecked`
           （`CredentialCheckOutcome`）；`DiscoverAndCreate.trigger()` 返回类型
           从 `Promise<boolean>` 改为 `Promise<OtaCredential | null>`
        2. **`onLoadFinished` 独立通道从未接入广播**：携程 cookie 登录
           （`LoginTabOpener.createFromCookie`）走的是完全独立于
           `checkUrlPastLogin` 的 `onLoadFinished` 通道，从建立起就没有广播
           `tab:credential-checked`，酒店探测永远不会触发。复核后发现这条
           通道本身多余——`ctripLoginUrlMatcher` 判据（URL 是否含 `/login/`）
           足以覆盖 cookie 有效/失效两种落地结果。修复：删除
           `BrowserManager` 的 `onLoadFinished` 参数/分支，携程
           `createFromCookie` 改为与抖音一致，统一走
           `loginUrlMatcher`+`onUrlPastLogin`
      - 涉及测试改动：`tests/unit/main/browser-manager.test.ts`（新增用例后又
        随 `onLoadFinished` 删除而移除，净 -1）、
        `tests/unit/main/browser-manager-partitions.test.ts`（删除
        `onLoadFinished` 专用用例，-1）、`tests/unit/main/login-tab-opener.test.ts`
        （携程 cookie 登录用例改为断言走 `loginUrlMatcher`/`onUrlPastLogin`）、
        `tests/unit/main/tab-event-bus.test.ts`/`ota-hotel-prob-feature.test.ts`
        全部重写以匹配新事件契约；`npm run check:types` 与
        `npm run test:unit`（52 个测试文件、255 个用例）全部通过
