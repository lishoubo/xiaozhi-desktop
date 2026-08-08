import { z } from 'zod';
import type { JsonObject, JsonValue } from '../shared/types/json';

const nonEmptyStringSchema = z
  .string()
  .max(256)
  .refine((value) => value.trim().length > 0);

export const browserWebUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  });

export const browserBoundsSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export type BrowserBounds = Readonly<z.infer<typeof browserBoundsSchema>>;

export const browserCreateInputSchema = z.strictObject({
  channelId: nonEmptyStringSchema,
  url: browserWebUrlSchema,
});

export const browserTabIdSchema = nonEmptyStringSchema;

export const browserTabSchema = z.strictObject({
  id: nonEmptyStringSchema,
  channelId: nonEmptyStringSchema,
  title: z.string(),
  url: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  loading: z.boolean(),
  partitionName: nonEmptyStringSchema,
});

export type BrowserTab = Readonly<z.infer<typeof browserTabSchema>>;

export const browserCookieSourceIdSchema = z.enum([
  'chrome',
  'edge',
  'firefox',
  'safari',
  'qq',
  '360',
  'sogou',
]);

export type BrowserCookieSourceId = z.infer<typeof browserCookieSourceIdSchema>;

export const browserCookieSourceSchema = z.strictObject({
  id: browserCookieSourceIdSchema,
  name: nonEmptyStringSchema,
});

export type BrowserCookieSource = Readonly<z.infer<typeof browserCookieSourceSchema>>;

export const cookieImportResultSchema = z.strictObject({
  imported: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  error: nonEmptyStringSchema.optional(),
});

export type CookieImportResult = Readonly<z.infer<typeof cookieImportResultSchema>>;

export const importedChannelSummarySchema = z.strictObject({
  channel: nonEmptyStringSchema,
  importedAt: nonEmptyStringSchema,
});

export type ImportedChannelSummary = Readonly<z.infer<typeof importedChannelSummarySchema>>;

export const startLoginInputSchema = z.strictObject({
  channelId: nonEmptyStringSchema,
  environment: z.enum(['prod', 'dev']),
  url: browserWebUrlSchema,
});

export type StartLoginInput = Readonly<z.infer<typeof startLoginInputSchema>>;

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

export const otaCredentialSchema = z.strictObject({
  id: nonEmptyStringSchema,
  channel: nonEmptyStringSchema,
  channelAccountId: z.string().nullable(),
  partitionName: nonEmptyStringSchema,
  credentialExtra: jsonObjectSchema.nullable(),
  discoveredAt: z.number(),
  lastRefreshedAt: z.number().nullable(),
});

export type OtaCredentialDto = Readonly<z.infer<typeof otaCredentialSchema>>;

export const otaCredentialListSchema = z.array(otaCredentialSchema);

export const otaCredentialChannelSchema = nonEmptyStringSchema;

export const otaCredentialIdSchema = nonEmptyStringSchema;

export const otaDiscoveryCompletedEventSchema = z.strictObject({
  channel: nonEmptyStringSchema,
});

export type OtaDiscoveryCompletedEvent = Readonly<
  z.infer<typeof otaDiscoveryCompletedEventSchema>
>;

export const systemPreferencesSchema = z.strictObject({
  autoLaunch: z.boolean(),
  version: nonEmptyStringSchema,
});

export type SystemPreferences = Readonly<z.infer<typeof systemPreferencesSchema>>;
