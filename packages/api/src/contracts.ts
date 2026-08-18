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
  /** 服务商员工可能没有手机号；该字段也可能整个不返回，故 nullable + optional。 */
  phone: z.string().nullable().optional(),
  /**
   * `'STAFF' | 'HOTEL'`。当前只接收保存，不据它做界面分流。
   *
   * 将来要区分两类用户的界面形态时按本字段判断，**不要用 `role`**——
   * `HOTEL_STAFF` 这个角色在服务商侧也在用，按 role 判断会把两类用户混在一起。
   */
  userType: z.string().min(1).optional(),
  fullName: z.string().nullable(),
  role: z.string().min(1),
  orgId: z.number().int().positive(),
  /**
   * 当前酒店。**可能整个字段都不存在**——酒店用户以手机号登录（登录即注册）时尚未
   * 绑定任何酒店，服务端不返回该 key。
   *
   * 必须同时有 `nullable` 和 `optional`：前者只允许值为 `null`，不允许 key 缺失；
   * 少了 `optional` 会让这类用户在取身份时校验失败，表现为"验证码明明对却回到登录页"。
   */
  currentHotelId: z.number().int().positive().nullable().optional(),
  accessibleHotelIds: z.array(z.number().int().positive()),
  permissions: z.array(z.string()),
});

export type StaffIdentity = Readonly<z.infer<typeof staffIdentitySchema>>;

/**
 * 短信验证码发码响应（POST /api/v1/auth/sms/request-code）。
 *
 * 与上面的 `phoneCodeRequestResponseSchema` 刻意不共用：那一套描述的是旧 `phone`
 * 变体经 `apps/server` 的响应，其生产方（`router.ts` 的 `requestPhoneCode`）只返回
 * `accepted` 与 `expiresInSeconds` 两个字段。两个 schema 都是 `strictObject`，给旧的
 * 加一个必填 `resendAfterSeconds` 会让旧变体的发码解析当场失败。
 *
 * `expiresInSeconds` 与 `resendAfterSeconds` 是**两个不同的值，不得混用**：
 * 前者是验证码有效期（300s），后者是重发间隔（60s），分别驱动"验证码何时失效"
 * 与"重新发送按钮何时可点"。
 */
export const staffPhoneCodeRequestResponseSchema = z.strictObject({
  accepted: z.literal(true),
  expiresInSeconds: z.number().int().positive(),
  resendAfterSeconds: z.number().int().positive(),
});

export type StaffPhoneCodeRequestResponse = Readonly<
  z.infer<typeof staffPhoneCodeRequestResponseSchema>
>;

export const staffLogoutResponseSchema = z.strictObject({
  success: z.literal(true),
});
