import { createHash } from 'node:crypto';

/**
 * 灰度名单里存的是手机号的加盐摘要，不是明文。
 *
 * 更新源 bucket 必须公共读（Squirrel 匿名下载），明文名单等同于公开客户联系方式。
 *
 * ## 为什么必须加盐
 *
 * 手机号只有 11 位且号段有限，无盐 sha256 可被穷举反查——攻击者拿到公开 URL
 * 就能把名单里的哈希逐个还原成手机号。加盐之后这条路被堵死。
 *
 * 盐随包分发、拆包可得。它挡的是"拿到一个公开 URL 就能还原全部客户手机号"，
 * 不是拆包逆向。**这不是加密，是提高门槛。**
 *
 * ## 与上传工具共用
 *
 * `scripts/gray-release.mjs` 编辑名单时算的是同一个摘要。两边算法必须一致，
 * 否则名单永远匹配不上——改这里就要改那边。
 */
export function digestPhone(phone: string, salt: string): string {
  return createHash('sha256').update(`${phone.trim()}${salt}`).digest('hex');
}
