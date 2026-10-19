import type { StaffIdentity } from '@hotel-butler/api';

/** 小智平台的客户端入口条件；业务请求仍由 RMS 服务端授权。 */
export function canAccessXiaozhiPlatform(
  identity: Pick<StaffIdentity, 'userType' | 'permissions' | 'accessibleHotelIds'> | null,
): boolean {
  if (identity?.userType === 'STAFF') return true;
  return (
    identity?.userType === 'HOTEL' &&
    identity.permissions.includes('xiaozhi:access') &&
    identity.accessibleHotelIds.length > 0
  );
}
