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
 * 放在 domain 而非 SessionFactory 里，是因为「怎么命名」是一条可穷举测试的
 * 纯规则，而「拿到 Session 对象」才需要 Electron。
 *
 * ⚠ **partition 名称一旦发布就固化在用户磁盘上**，改动等于让所有用户重新登录。
 * 因此改这里必须同时升 `partitionLayout` 版本号，并想清楚迁移策略。
 */
import type { ChannelId } from '../ids';

/** 与 STORAGE_VERSIONS.partitionLayout 对应；改命名规则必须同步升版本。 */
export const PARTITION_LAYOUT_VERSION = 1;

const PARTITION_PREFIX = 'persist:xiaozhi';

/**
 * 不做账号隔离的共享浏览 partition。承担两个角色，都不能删：
 *
 * 1. **当前功能**：只看不登录的场景用它 —— `openView()`（查看渠道页面）、
 *    站内弹窗新开的标签页、`BrowserManager` 的默认 session。这些场景没有
 *    账号概念，不需要独立 partition。
 * 2. **历史数据容器**：账号隔离（D1 修复）之前，所有 OTA 账号共用这一个
 *    session。里面混着多个账号的登录态，无法判断哪条 cookie 属于谁，
 *    **不做自动迁移**——迁移会把 A 的登录态错配给 B。
 *
 * ⚠ 字符串值固化在用户磁盘上，改动等于让老用户丢失这份登录态。名字可以改，
 * 值不能改。
 */
export const SHARED_BROWSING_PARTITION = 'persist:hotel-butler-browser';

export function toPartitionName(
  environment: 'prod' | 'dev',
  channel: ChannelId,
  shortId: string,
): string {
  return `${PARTITION_PREFIX}:${environment}:${channel}:${shortId}`;
}

/** 判断一个 partition 名是否由当前布局生成（用于识别 legacy）。 */
export function isCurrentLayoutPartition(name: string): boolean {
  return name.startsWith(`${PARTITION_PREFIX}:`);
}
