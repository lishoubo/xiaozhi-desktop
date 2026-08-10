import type { EmployeeIdentity } from '@hotel-butler/api';

export const EXPERIENCE_PHONE = '13800138000';

export type AuthSession = EmployeeIdentity;

let currentSession: AuthSession | null = null;

export function setAuthSession(session: AuthSession): void {
  currentSession = session;
}

export function readAuthSession(): AuthSession | null {
  return currentSession;
}

export function clearAuthSession(): void {
  currentSession = null;
}

export function maskPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}
