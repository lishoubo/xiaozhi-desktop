import { describe, expect, it } from 'vitest';
import { capabilitiesOf } from '../../src/renderer/permissions';
import type { StaffSession } from '../../src/renderer/staff-auth';

function staffWith(
  permissions: readonly string[],
  userType?: StaffSession['userType'],
): StaffSession {
  return {
    userId: 7,
    username: '13693214089',
    fullName: '酒店前台',
    role: 'HOTEL_STAFF',
    orgId: 42,
    userType,
    accessibleHotelIds: [],
    permissions: [...permissions],
  };
}

describe('renderer capability derivation', () => {
  it('grants hotel management when the code is present', () => {
    expect(capabilitiesOf(staffWith(['hotel:view', 'hotel:manage'])).manageHotel).toBe(true);
  });

  it('withholds hotel management for read-only codes', () => {
    expect(
      capabilitiesOf(staffWith(['inventory:read', 'hotel:view', 'pricing:view'])).manageHotel,
    ).toBe(false);
  });

  it('withholds hotel management when no codes are granted', () => {
    expect(capabilitiesOf(staffWith([])).manageHotel).toBe(false);
  });

  it('withholds hotel management without a session', () => {
    expect(capabilitiesOf(null).manageHotel).toBe(false);
  });

});

describe('renderer module visibility by user type', () => {
  it('closes hotel management for hotel users', () => {
    expect(capabilitiesOf(staffWith(['hotel:view'], 'HOTEL')).showHotelManagement).toBe(false);
  });

  it('opens hotel management for staff users', () => {
    expect(capabilitiesOf(staffWith(['hotel:view'], 'STAFF')).showHotelManagement).toBe(true);
  });

  it('opens hotel management when the user type is absent', () => {
    // 契约层把缺失与未知值一并降级为 undefined。字段读不到时按服务商员工处置——
    // 宁可多显示一个模块，也不能把人挡在门外。
    expect(capabilitiesOf(staffWith(['hotel:view'])).showHotelManagement).toBe(true);
  });

  it('opens hotel management for a staff user without any permission codes', () => {
    // OPERATOR 的形状：是服务商员工，但权限矩阵里没有 hotel:manage。
    // 模块要开放，写入口要关掉——这正是两条判据不能合并的原因。
    const caps = capabilitiesOf(staffWith([], 'STAFF'));
    expect(caps.showHotelManagement).toBe(true);
    expect(caps.manageHotel).toBe(false);
  });

  it('withholds both capabilities without a session', () => {
    expect(capabilitiesOf(null)).toEqual({ manageHotel: false, showHotelManagement: false });
  });
});
