/**
 * partition 命名策略 —— 每个 (environment, channel, 短id) 一份独立存储。
 *
 * **partition 是业务隔离单位**，短id 在创建登录标签页那一刻随机生成，不代表
 * 业务身份——此时账号还不存在（探测尚未发生），无法从账号反推 partition 名字。
 * 探测成功后，`OtaCredential.partitionName` 原样存下这个名字，此后定位这份登录态
 * 一律查这个字段，不再用任何公式重新计算。
 *
 * 这是 D1 的修复核心：此前所有 OTA 账号共用 `persist:hotel-butler-browser`
 * 一个 session，导致同渠道两个账号的 cookie 互相覆盖，导入携程还会顺带
 * 覆盖已登录的美团 —— 用户会真实丢失登录态。
 *
 * 与 `SessionFactory` 分开，是因为「怎么命名」是一条可穷举测试的纯规则，
 * 而「拿到 Session 对象」才需要 Electron。
 *
 * ⚠ **partition 名称一旦发布就固化在用户磁盘上**，改动等于让所有用户重新登录。
 * 因此改这里必须同时升 `PARTITION_LAYOUT_VERSION`，并想清楚迁移策略。
 *
 * `<environment>` 段取自构建期环境（见 `shared/app-environment.ts`）。它是 partition
 * 的第二道隔离：数据目录已按环境分开，这一段让同一目录内的名字也不会被误读成别的
 * 环境的遗留——换环境后旧名字成为孤儿，由 `partition-cleanup` 启动时回收。
 */
import { APP_ENVIRONMENT } from '../../shared/app-environment';
import type { ChannelId } from '../ids';

/** partition 命名布局的版本号；改命名规则必须同步升它。 */
export const PARTITION_LAYOUT_VERSION = 1;

const PARTITION_PREFIX = 'persist:xiaozhi';

/**
 * `<environment>` 段取构建期环境，**不由调用方传入**：此前它是个形参，但全部调用点
 * 都写死同一个字面量，等于既没隔离环境、又给了传错的机会。环境只有一个来源。
 */
export function toPartitionName(channel: ChannelId, shortId: string): string {
  return `${PARTITION_PREFIX}:${APP_ENVIRONMENT}:${channel}:${shortId}`;
}

/**
 * 内部 web 页面（RMS 自有页面，如统一改价页）共用的**固定**长驻 partition。
 *
 * 与 OTA 登录 partition 的根本差别：那些是「每次登录一份」，这份是「全应用一份」——
 * 内部页面没有渠道账号的概念，不存在多份登录态要隔离。
 *
 * ## ⚠️ 段数必须是 4，不得增至 5
 *
 * ```
 * persist:xiaozhi:<env>:internal              4 段  ← 本常量，安全
 * persist:xiaozhi:<env>:internal:pricing      5 段  ← 💥 会被当成孤儿清空
 * ```
 *
 * `partition-cleanup.ts` 的孤儿判据是**段数恰为 5 且环境段相等**，不是白名单。写成
 * 5 段就会被判定成「本环境的 OTA 登录 partition」，而它在 credential 表里必然查不到，
 * 于是每次启动都被清空 —— 现象是用户每次开应用，内部页面的本地状态全部丢失。
 *
 * 既有的基础设施 partition（`:server-api` / `:rms-api`，3 段）也是靠段数不足被挡在
 * 外面的，这里是同一手法。保留 `<env>` 段是为了满足环境隔离要求（三套环境各一份）。
 */
export const INTERNAL_PAGE_PARTITION = `${PARTITION_PREFIX}:${APP_ENVIRONMENT}:internal`;

/** 判断一个 partition 名是否由当前布局生成（用于识别 legacy）。 */
export function isCurrentLayoutPartition(name: string): boolean {
  return name.startsWith(`${PARTITION_PREFIX}:`);
}
