import { z } from 'zod';

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
