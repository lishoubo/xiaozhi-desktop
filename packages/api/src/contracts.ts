import { z } from 'zod';

export * from './agent-contracts';

export const employeeIdentitySchema = z.strictObject({
  id: z.string().regex(/^\d+$/),
  orgId: z.string().regex(/^\d+$/),
  username: z.string().min(1),
  fullName: z.string().nullable(),
  phone: z.string().regex(/^1\d{10}$/),
  roleCode: z.string().min(1),
});

export type EmployeeIdentity = Readonly<z.infer<typeof employeeIdentitySchema>>;

export const phoneNumberSchema = z.string().regex(/^1\d{10}$/);
export const phoneCodeSchema = z.string().regex(/^\d{6}$/);

export const phoneCodeRequestResponseSchema = z.strictObject({
  accepted: z.literal(true),
  expiresInSeconds: z.number().int().positive(),
});

export const logoutResponseSchema = z.strictObject({
  success: z.literal(true),
});

/**
 * 员工用户名/密码登录（staffAuth）—— 桌面端直连 rms-server 的契约。
 *
 * 与上面的 `employeeIdentity*` 刻意不共用：那一套描述的是 apps/server 经 mysql2
 * （`bigNumberStrings: true`）读出来的行，id 是字符串；这里描述的是 rms-server 的
 * JSON 响应，Jackson 把 Long 序列化成 number。两者字段名和类型都不同。
 */
export const staffUsernameSchema = z.string().min(1).max(64);
export const staffPasswordSchema = z.string().min(6).max(128);

/** 字段对齐 rms-server 的 `MeResponse`（GET /api/v1/me）。 */
export const staffIdentitySchema = z.strictObject({
  userId: z.number().int().positive(),
  username: z.string().min(1),
  fullName: z.string().nullable(),
  role: z.string().min(1),
  orgId: z.number().int().positive(),
  currentHotelId: z.number().int().positive().nullable(),
  accessibleHotelIds: z.array(z.number().int().positive()),
  permissions: z.array(z.string()),
});

export type StaffIdentity = Readonly<z.infer<typeof staffIdentitySchema>>;

export const staffLogoutResponseSchema = z.strictObject({
  success: z.literal(true),
});
