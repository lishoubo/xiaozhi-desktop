import { describe, expect, it } from 'vitest';
import { capabilitiesOf } from '../../src/renderer/permissions';
import type { StaffSession } from '../../src/renderer/staff-auth';

function staffWith(
  permissions: readonly string[],
  userType?: StaffSession['userType'],
  accessibleHotelIds: readonly number[] = [],
): StaffSession {
  return {
    userId: 7,
    username: '13693214089',
    fullName: '酒店前台',
    role: 'HOTEL_STAFF',
    orgId: 42,
    userType,
    accessibleHotelIds: [...accessibleHotelIds],
    permissions: [...permissions],
  };
}

describe('renderer capability derivation', () => {
  it('leaves hotel write authorization to the API regardless of permission codes', () => {
    const expected = {
      showHotelManagement: true,
      showXiaozhiChannel: true,
    };
    expect(capabilitiesOf(staffWith(['hotel:view', 'hotel:manage'], 'STAFF'))).toEqual(expected);
    expect(capabilitiesOf(staffWith(['hotel:view'], 'STAFF'))).toEqual(expected);
    expect(capabilitiesOf(staffWith([], 'STAFF'))).toEqual(expected);
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
    const caps = capabilitiesOf(staffWith([], 'STAFF'));
    expect(caps.showHotelManagement).toBe(true);
  });

  it('hides modules without a session', () => {
    expect(capabilitiesOf(null)).toEqual({
      showHotelManagement: false,
      showXiaozhiChannel: false,
    });
  });
});

describe('xiaozhi channel visibility', () => {
  it('admits an explicit staff identity without requiring hotel access', () => {
    expect(capabilitiesOf(staffWith([], 'STAFF')).showXiaozhiChannel).toBe(true);
  });

  it('admits a hotel user only with the grant and an accessible hotel', () => {
    expect(capabilitiesOf(staffWith(['xiaozhi:access'], 'HOTEL', [8])).showXiaozhiChannel).toBe(
      true,
    );
    expect(capabilitiesOf(staffWith(['xiaozhi:access'], 'HOTEL')).showXiaozhiChannel).toBe(false);
    expect(capabilitiesOf(staffWith([], 'HOTEL', [8])).showXiaozhiChannel).toBe(false);
  });

  it('rejects unknown or missing identity type', () => {
    expect(capabilitiesOf(staffWith([])).showXiaozhiChannel).toBe(false);
    expect(capabilitiesOf(null).showXiaozhiChannel).toBe(false);
  });
});
