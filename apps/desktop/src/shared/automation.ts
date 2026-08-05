import { z } from 'zod';

export const ctripCheckInResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), checkIn: z.string().min(1) }),
  z.strictObject({ ok: z.literal(false), message: z.string().min(1) }),
]);

export type CtripCheckInResult = Readonly<z.infer<typeof ctripCheckInResultSchema>>;
