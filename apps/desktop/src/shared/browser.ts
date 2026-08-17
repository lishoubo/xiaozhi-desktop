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

/**
 * 不含 environment：环境由构建期决定（见 `shared/app-environment.ts`），renderer
 * 无从、也不应该指定。此前这里有个 `environment` 字段，但所有调用方都传同一个
 * 字面量。
 */
export const startLoginInputSchema = z.strictObject({
  channelId: nonEmptyStringSchema,
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
  /**
   * 「人能认出来」的账号名。渠道差异（携程 `hotelName`、抖音 `name`、美团 `login`）
   * 在写入时已抹平，见 `channelAccountNameOf`。
   *
   * 可空：探测拿不到名字，或记录建于 migration 8 之前（历史数据不回填）。
   */
  channelAccountName: z.string().nullable(),
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

export type OtaDiscoveryCompletedEvent = Readonly<z.infer<typeof otaDiscoveryCompletedEventSchema>>;

/** 探测出的候选酒店，尚未保存。 */
export const probedHotelSchema = z.strictObject({
  otaHotelId: nonEmptyStringSchema,
  otaHotelName: z.string().nullable(),
  bindExtra: jsonObjectSchema.nullable(),
});

/**
 * 打开 OTA 标签页时携带的意图。目前只有绑定酒店一种：带上它才会触发酒店探测并把
 * 候选通知到 UI；不带则只是普通打开，完全不探测。
 */
export const bindHotelIntentSchema = z.strictObject({
  kind: z.literal('bind-hotel'),
  requestId: nonEmptyStringSchema,
});

/** 重新登录：`expectedChannelAccountId` 用于核对登录的是不是原账号，不可缺省。 */
export const reauthOtaIntentSchema = z.strictObject({
  kind: z.literal('reauth-ota'),
  requestId: nonEmptyStringSchema,
  expectedChannelAccountId: nonEmptyStringSchema,
});

/**
 * 按门店重认：RMS 后台绑定的老记录没有渠道账号标识，认不出该登录哪个账号，
 * 只能反过来用「这个账号管不管得了这家门店」来核对。
 */
export const reauthByHotelIntentSchema = z.strictObject({
  kind: z.literal('reauth-by-hotel'),
  requestId: nonEmptyStringSchema,
  expectedOtaHotelId: nonEmptyStringSchema,
  otaAccountId: z.number().int().positive(),
});

export const otaTabIntentSchema = z.discriminatedUnion('kind', [
  bindHotelIntentSchema,
  reauthOtaIntentSchema,
  reauthByHotelIntentSchema,
]);

export type OtaTabIntentDto = Readonly<z.infer<typeof otaTabIntentSchema>>;

/** 「UI 在等的结果送达了」——信封形状见 `shared/types/ui-waiting-result-types.ts`。 */
export const uiWaitingResultEnvelopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    requestId: nonEmptyStringSchema,
    kind: z.literal('bind-hotel'),
    payload: z.strictObject({
      credentialId: nonEmptyStringSchema,
      hotels: z.array(probedHotelSchema),
    }),
  }),
  z.strictObject({
    requestId: nonEmptyStringSchema,
    kind: z.literal('reauth-ota'),
    payload: z.union([
      z.strictObject({ ok: z.literal(true), credentialId: nonEmptyStringSchema }),
      z.strictObject({
        ok: z.literal(false),
        reason: z.enum(['account-mismatch', 'identity-unavailable', 'hotel-mismatch']),
        actualHotels: z.array(probedHotelSchema).optional(),
      }),
    ]),
  }),
]);

export const startBindingResultSchema = z.strictObject({
  requestId: nonEmptyStringSchema,
});

export const confirmBindingInputSchema = z.strictObject({
  credentialId: nonEmptyStringSchema,
  rmsHotelId: z.number().int().positive(),
  hotel: probedHotelSchema,
});

export type ConfirmBindingInput = Readonly<z.infer<typeof confirmBindingInputSchema>>;

/**
 * 修复「没有门店」的历史绑定：把用户重新选定的门店补上。
 *
 * 与 `confirmBindingInput` 的差别是 `rmsHotelId` 换成 `otaAccountId` —— 那条路新建
 * 一条绑定（要说明绑到哪家酒店），这条路更新既有记录（要说明改哪一条）。
 */
export const confirmBackfillHotelInputSchema = z.strictObject({
  credentialId: nonEmptyStringSchema,
  otaAccountId: z.number().int().positive(),
  hotel: probedHotelSchema,
});

export type ConfirmBackfillHotelInput = Readonly<z.infer<typeof confirmBackfillHotelInputSchema>>;

/**
 * 重新登录收尾：只需要「改哪条绑定」与「用哪个凭证的 cookie」。
 *
 * 没有 `bindExtra` 参数：要补写的账号级身份由 service 层自己从凭证取
 * （`withChannelAccount`），门店级参数则**一律不在这条路上写**——见
 * `gateway/rms/types.ts` 的 `RmsChannelHotelFields`。
 */
export const confirmReauthInputSchema = z.strictObject({
  otaAccountId: z.number().int().positive(),
  credentialId: nonEmptyStringSchema,
});

export type ConfirmReauthInput = Readonly<z.infer<typeof confirmReauthInputSchema>>;

/** 「这条远端绑定当初是哪个本地凭证建的」——用于标注「上次绑定过」。 */
export const findCredentialForAccountInputSchema = z.strictObject({
  source: nonEmptyStringSchema,
  otaHotelId: nonEmptyStringSchema.nullable(),
  bindExtra: jsonObjectSchema.nullable(),
});

export type FindCredentialForAccountInput = Readonly<
  z.infer<typeof findCredentialForAccountInputSchema>
>;

export const systemPreferencesSchema = z.strictObject({
  autoLaunch: z.boolean(),
  version: nonEmptyStringSchema,
});

export type SystemPreferences = Readonly<z.infer<typeof systemPreferencesSchema>>;
