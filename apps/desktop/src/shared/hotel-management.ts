import { z } from 'zod';
import type { JsonObject, JsonValue } from '../domain/json';

const nonEmptyStringSchema = z
  .string()
  .max(256)
  .refine((value) => value.trim().length > 0);

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

export const rmsHotelIdSchema = z.number().int().positive();

export const rmsOtaAccountIdSchema = z.number().int().positive();

export const rmsHotelSchema = z.strictObject({
  id: rmsHotelIdSchema,
  name: nonEmptyStringSchema,
  status: z.number().int(),
});

export type RmsHotelDto = Readonly<z.infer<typeof rmsHotelSchema>>;

export const rmsOtaAccountSchema = z.strictObject({
  id: rmsOtaAccountIdSchema,
  hotelId: rmsHotelIdSchema,
  otaHotelId: z.string().nullable(),
  otaHotelName: z.string().nullable(),
  status: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  bindExtra: jsonObjectSchema.nullable(),
});

export type RmsOtaAccountDto = Readonly<z.infer<typeof rmsOtaAccountSchema>>;

export const rmsHotelOtaAccountsDtoSchema = z.strictObject({
  hotels: z.array(rmsHotelSchema),
  otaAccounts: z.array(rmsOtaAccountSchema),
});

export type RmsHotelOtaAccountsDto = Readonly<z.infer<typeof rmsHotelOtaAccountsDtoSchema>>;

export const rmsHotelCreateInputSchema = z.strictObject({
  name: nonEmptyStringSchema,
});

export type RmsHotelCreateInputDto = Readonly<z.infer<typeof rmsHotelCreateInputSchema>>;
