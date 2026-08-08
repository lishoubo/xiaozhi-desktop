/**
 * intent 从渲染进程穿过 IPC 边界的校验。
 *
 * intent 是**不可信输入**（来自渲染进程），必须过 schema 才能进 `LoginDetector`。
 * 这里复刻 `ota-tab-handlers.ts` 的元组 schema——「新登录账号」这条链没法用单测端到端
 * 跑通（要真的开浏览器登录），边界这一段至少要焊死：意图在这里被吃掉或改形状，
 * 表现就是「登完什么都没发生」，而且不报错。
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  otaCredentialIdSchema,
  otaTabIntentSchema,
  startLoginInputSchema,
} from '../../../src/shared/browser';

const BIND_INTENT = { kind: 'bind-hotel', requestId: 'req-1' } as const;
const REAUTH_INTENT = {
  kind: 'reauth-ota',
  requestId: 'req-2',
  expectedChannelAccountId: 'account-1',
} as const;

const LOGIN_INPUT = {
  channelId: 'douyin',
  environment: 'prod',
  url: 'https://life.douyin.com/p/login',
} as const;

/** 与 handler 里 openForNewLogin 的 schema 一致。 */
const newLoginTuple = z.tuple([startLoginInputSchema, otaTabIntentSchema.nullish().default(null)]);
/** 与 handler 里 openExisting 的 schema 一致。 */
const existingTuple = z.tuple([otaCredentialIdSchema, otaTabIntentSchema.nullish().default(null)]);

describe('openForNewLogin 的 intent 边界', () => {
  it('绑定意图原样通过', () => {
    const parsed = newLoginTuple.parse([LOGIN_INPUT, BIND_INTENT]);

    expect(parsed[1]).toEqual(BIND_INTENT);
  });

  /** 用 `.default()` 保持元组定长，否则可选元素会把 listener 形参变成不定参数。 */
  it('不带意图时补成 null，元组仍是两项', () => {
    const parsed = newLoginTuple.parse([LOGIN_INPUT]);

    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toBeNull();
  });

  it('preload 显式传 undefined 也能过', () => {
    expect(newLoginTuple.parse([LOGIN_INPUT, undefined])[1]).toBeNull();
  });
});

describe('openExisting 的 intent 边界', () => {
  it('重新登录意图原样通过，带着待核对的账号标识', () => {
    const parsed = existingTuple.parse(['credential-1', REAUTH_INTENT]);

    expect(parsed[1]).toEqual(REAUTH_INTENT);
  });

  it('绑定意图原样通过', () => {
    expect(existingTuple.parse(['credential-1', BIND_INTENT])[1]).toEqual(BIND_INTENT);
  });
});

describe('非法 intent 被拒', () => {
  it('未知 kind', () => {
    expect(() => newLoginTuple.parse([LOGIN_INPUT, { kind: 'evil', requestId: 'r' }])).toThrow();
  });

  /** 少了它主进程就没法核对身份，等于把核对这道防线绕过去。 */
  it('reauth 缺 expectedChannelAccountId', () => {
    expect(() =>
      existingTuple.parse(['credential-1', { kind: 'reauth-ota', requestId: 'r' }]),
    ).toThrow();
  });

  it('requestId 为空串', () => {
    expect(() =>
      newLoginTuple.parse([LOGIN_INPUT, { kind: 'bind-hotel', requestId: '' }]),
    ).toThrow();
  });

  it('多带了未声明的字段（strictObject 拒绝）', () => {
    expect(() => newLoginTuple.parse([LOGIN_INPUT, { ...BIND_INTENT, extra: 'x' }])).toThrow();
  });
});
