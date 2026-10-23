/**
 * 由登录身份派生模块可见性。
 *
 * 酒店管理按 userType 展示：服务商员工可见，酒店用户不可见。
 * 小智平台对酒店用户另需 xiaozhi:access 和至少一家可访问酒店。
 * 酒店管理页的绑定、解绑与重新登录不在 App 判断权限，由服务端接口校验。
 */
import type { StaffSession } from './staff-auth';
import { canAccessXiaozhiPlatform } from '../shared/xiaozhi-access';

export type SessionLike = StaffSession;

/** 页面统一使用这里派生的模块可见性。 */
export type Capabilities = Readonly<{
  /** 按用户类型：酒店管理模块是否对该类用户开放。 */
  showHotelManagement: boolean;
  /** 服务商或获授权且有可访问酒店的酒店用户可见内部改价页。 */
  showXiaozhiChannel: boolean;
}>;

const NONE: Capabilities = {
  showHotelManagement: false,
  showXiaozhiChannel: false,
};

/**
 * 从当前会话身份派生模块可见性，未登录时隐藏全部模块。
 */
export function capabilitiesOf(session: SessionLike | null): Capabilities {
  if (!session) return NONE;
  return {
    // 缺 `userType` 时按服务商员工处置（契约层已把未知值一并降级为 undefined）：
    // 宁可多显示一个员工才用的模块，也不能因为字段没读到就把人挡在门外。
    showHotelManagement: session.userType !== 'HOTEL',
    showXiaozhiChannel: canAccessXiaozhiPlatform(session),
  };
}
