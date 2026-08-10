/**
 * 顶部欢迎语的纯逻辑。
 *
 * 与 `session-greeting.svelte.ts` 分开：那份持有 `$state` 容器，只能在 Svelte
 * 编译后运行；这份不含 runes，可以直接单测。
 */

/**
 * 两套登录（手机号 / 员工用户名密码）身份对象的交集。
 *
 * 两者的 id 字段名和类型都不同（`EmployeeIdentity.id` 是字符串，
 * `StaffIdentity.userId` 是数字），但 `username` / `fullName` 一致——展示名只需要
 * 这两个，所以调用方不必按 `IS_STAFF_AUTH` 分支。
 */
export type GreetingIdentity = Readonly<{
  username: string;
  fullName: string | null;
}>;

const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** 有姓名用姓名，否则退回登录用户名——与 `staff-auth.ts` 的 `displayName` 同规则。 */
export function greetingNameOf(identity: GreetingIdentity | null): string | null {
  if (!identity) return null;
  return identity.fullName ?? identity.username;
}

export function weekdayLabel(date: Date): string {
  return WEEKDAY_NAMES[date.getDay()];
}
