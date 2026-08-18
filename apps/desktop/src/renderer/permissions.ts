/**
 * 由登录身份派生界面能力。
 *
 * 存在的理由是「单一产地」：权限码字符串只在本文件出现一次，页面读布尔值。
 * 各处自己写 `permissions.includes('hotel:manage')` 会让同一个判断散落多处，
 * 改码时必然漏掉一两个。
 *
 * **这是界面收口，不是安全边界**——服务端始终是权限的最终防线。这里只负责
 * 不把用户无权执行的入口摆在他面前。
 */
import type { AuthSession } from './auth';
import type { StaffSession } from './staff-auth';

/**
 * 两套登录变体的身份形状不同：`StaffSession`（rms-server）带 `permissions`，
 * `AuthSession`（phone 变体）**根本没有这个字段**。酒店管理页在两个变体下都能
 * 路由到，所以这里必须两种都吃得下。
 */
export type SessionLike = StaffSession | AuthSession;

/** 本次只收敛一个能力；新增能力时在此扩展，不要回到页面里比字符串。 */
export type Capabilities = Readonly<{
  manageHotel: boolean;
}>;

const HOTEL_MANAGE = 'hotel:manage';

const NONE: Capabilities = { manageHotel: false };

/**
 * 从当前会话身份派生能力。未登录、身份不带权限码、权限码为空——三种情况都落到
 * 「全部不具备」，即默认拒绝。
 *
 * 用 `'permissions' in session` 而不是编译期常量 `IS_STAFF_AUTH` 做分支：后者不
 * 参与 TypeScript 类型收窄，拿它分支就得配一个类型断言才能取到字段。`in` 是原生
 * 收窄手段，零断言。
 */
export function capabilitiesOf(session: SessionLike | null): Capabilities {
  if (!session) return NONE;
  if (!('permissions' in session)) return NONE;
  return { manageHotel: session.permissions.includes(HOTEL_MANAGE) };
}
