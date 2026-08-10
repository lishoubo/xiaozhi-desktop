/**
 * 顶部欢迎语的响应式容器。
 *
 * 只放 `$state`，规则本身在 `session-greeting.ts`（那份不含 runes，可以单测）。
 *
 * 不复用 `auth.ts` / `staff-auth.ts` 里的会话变量：那两个是普通模块变量，写入不会
 * 触发重渲染，欢迎语会停在登录那一刻的值。
 */
import { greetingNameOf, type GreetingIdentity } from './session-greeting';

let identity = $state<GreetingIdentity | null>(null);

export function setGreetingIdentity(next: GreetingIdentity | null): void {
  identity = next;
}

export function greetingName(): string | null {
  return greetingNameOf(identity);
}
