/**
 * 上报体脱敏 —— `beforeSend` / `beforeBreadcrumb` 的实现。
 *
 * 单独成文件是为了**能脱离 Sentry SDK 单测**：脱敏是本次接入里后果最严重的一环
 * （漏一个字段就等于外泄一份凭证），必须有直接覆盖，不能只靠 init 那条路间接验。
 *
 * 复用 `shared/logging.ts` 的 `redactLogData`：它已覆盖 Bearer token、cookie、
 * 手机号、URL 内嵌凭证，且能处理循环引用与 cause 链，没有理由再写一套。
 *
 * ⚠️ 过的是**整个 event**，不是只有 `event.request`：异常 message、breadcrumb、
 * extra、tags 里都可能夹带凭证，漏掉任何一处都等于外泄一份。
 */
import { redactLogData } from '../../shared/logging';

/**
 * `redactLogData` 的签名是 `unknown[] -> unknown[]`，这里包成单元素数组复用它。
 * 脱敏后的形状与入参一致，只是敏感值被替换成 `[REDACTED]`。
 */
export function redactEvent<T>(event: T): T {
  return redactLogData([event])[0] as T;
}
