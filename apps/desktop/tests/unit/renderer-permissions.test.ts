import { describe, expect, it } from 'vitest';
import { capabilitiesOf } from '../../src/renderer/permissions';
import type { StaffSession } from '../../src/renderer/staff-auth';
import type { AuthSession } from '../../src/renderer/auth';

function staffWith(permissions: readonly string[]): StaffSession {
  return {
    userId: 7,
    username: '13693214089',
    fullName: '酒店前台',
    role: 'HOTEL_STAFF',
    orgId: 42,
    accessibleHotelIds: [],
    permissions: [...permissions],
  };
}

/** phone 变体的身份形状——刻意不含 `permissions` 字段。 */
const phoneSession: AuthSession = {
  id: '2',
  orgId: '42',
  username: 'desktop-demo',
  fullName: '桌面体验员工',
  phone: '13800138000',
  roleCode: 'FRONT_DESK',
};

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

  it('withholds hotel management for identities that carry no permission field', () => {
    // phone 变体：字段整个不存在，不能因此被当成「具备」。
    expect(capabilitiesOf(phoneSession).manageHotel).toBe(false);
  });
});
