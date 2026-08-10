import type { StaffIdentity } from '@hotel-butler/api';

export type StaffSession = StaffIdentity;

let currentSession: StaffSession | null = null;

export function setStaffSession(session: StaffSession): void {
  currentSession = session;
}

export function readStaffSession(): StaffSession | null {
  return currentSession;
}

export function clearStaffSession(): void {
  currentSession = null;
}

/** 用户中心等处的展示名：有姓名用姓名，否则退回登录用户名。 */
export function displayName(session: StaffSession): string {
  return session.fullName ?? session.username;
}
