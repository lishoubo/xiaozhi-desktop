/**
 * 由登录身份派生界面能力。
 *
 * 存在的理由是「单一产地」：权限码字符串只在本文件出现一次，页面读布尔值。
 * 各处自己写 `permissions.includes('hotel:manage')` 会让同一个判断散落多处，
 * 改码时必然漏掉一两个。
 *
 * ## 两条判据，分工不同，不可互相替代
 *
 * | 判据 | 回答的问题 | 数据源 |
 * |---|---|---|
 * | `userType` | 这个模块对该类用户开放吗 | 服务端 `MeResponse.userType` |
 * | 权限码 | 进到模块里能不能写 | `role_permission` 表 |
 *
 * 用权限码当模块开关会误伤 OPERATOR——他是服务商员工，该看到酒店管理，但权限矩阵里
 * 没有 `hotel:manage`。反过来用 `userType` 当写操作开关，则会让只读的酒店用户拿到
 * 写入口。
 *
 * ## 两个不能用的判据
 *
 * - **`role`**：`HOTEL_STAFF` 这个角色在服务商侧也在用，服务商员工与酒店 App 用户
 *   角色码相同而期望相反，按它判断必然把两类人混在一起。
 * - **`hotel:view`**：四个角色全都有，判不出任何东西。
 *
 * ## 不判断的那一条
 *
 * 「能操作哪几家酒店」不在这里判——服务端每次调用都重查 `hotel_user_access` 收敛范围，
 * 客户端手上的 `accessibleHotelIds` 只是登录时的快照，拿它做门禁会过期。
 *
 * **这是界面收口，不是安全边界**——服务端始终是权限的最终防线。这里只负责
 * 不把用户无权执行的入口摆在他面前。
 */
import type { StaffSession } from './staff-auth';

export type SessionLike = StaffSession;

/** 新增能力时在此扩展，并把对应的权限码常量加在下面，不要回到页面里比字符串。 */
export type Capabilities = Readonly<{
  /** 按权限码：酒店管理模块内能否执行写操作。 */
  manageHotel: boolean;
  /** 按用户类型：酒店管理模块是否对该类用户开放。 */
  showHotelManagement: boolean;
}>;

const HOTEL_MANAGE = 'hotel:manage';

const NONE: Capabilities = { manageHotel: false, showHotelManagement: false };

/**
 * 从当前会话身份派生能力。未登录、权限码为空都落到「全部不具备」，即默认拒绝。
 */
export function capabilitiesOf(session: SessionLike | null): Capabilities {
  if (!session) return NONE;
  return {
    manageHotel: session.permissions.includes(HOTEL_MANAGE),
    // 缺 `userType` 时按服务商员工处置（契约层已把未知值一并降级为 undefined）：
    // 宁可多显示一个员工才用的模块，也不能因为字段没读到就把人挡在门外。
    showHotelManagement: session.userType !== 'HOTEL',
  };
}
