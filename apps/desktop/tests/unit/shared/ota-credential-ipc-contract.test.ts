/**
 * `otaCredentialSchema` 是 preload 校验**主进程返回值**用的契约，且是
 * `z.strictObject` —— 多一个未声明的键就整条解析失败。
 *
 * 这层校验没有类型保护：主进程返回的是 `OtaCredential`，而 schema 是另写的一份 zod
 * 定义，两者靠人工保持同步。给领域类型加字段而忘了加这里，编译期一声不吭，运行时
 * 表现为「登录凭据列表加载失败，请重试」——2026-08-12 加 `channelAccountName` 时
 * 就是这么炸的。
 *
 * 所以这里不只测某一个字段，而是**拿领域类型的键集合去比 schema 的键集合**：以后
 * 任何一侧加字段而另一侧没跟上，都会在这里失败。
 */
import { describe, expect, it } from 'vitest';
import { otaCredentialListSchema, otaCredentialSchema } from '../../../src/shared/browser';
import { toChannelId, toOtaCredentialId } from '../../../src/main/ids';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';

/** 一条字段齐全的凭证——键必须与 `OtaCredential` 完全一致（多一个少一个都编译不过）。 */
const CREDENTIAL: OtaCredential = {
  id: toOtaCredentialId('credential-1'),
  channel: toChannelId('ctrip'),
  channelAccountId: '85068938',
  channelAccountName: '银际酒店(包头市青山王府井文化路店)',
  partitionName: 'persist:xiaozhi:prod:ctrip:498e5c3b',
  credentialExtra: { hotelId: '85068938', hotelName: '银际酒店(包头市青山王府井文化路店)' },
  discoveredAt: 1_786_521_535_441,
  lastRefreshedAt: 1_786_522_619_358,
};

describe('OtaCredential 的 IPC 契约', () => {
  it('接受主进程实际返回的凭证形状', () => {
    expect(() => otaCredentialSchema.parse(CREDENTIAL)).not.toThrow();
    expect(() => otaCredentialListSchema.parse([CREDENTIAL])).not.toThrow();
  });

  it('schema 的键集合与领域类型完全一致', () => {
    // strictObject 只挡「schema 少了字段」；这一条同时挡住反向的「schema 多了字段」。
    const schemaKeys = Object.keys(otaCredentialSchema.shape).sort();
    const domainKeys = Object.keys(CREDENTIAL).sort();

    expect(schemaKeys).toEqual(domainKeys);
  });

  it('账号名允许为 null —— 历史记录不回填，这一列会是空的', () => {
    expect(() =>
      otaCredentialSchema.parse({ ...CREDENTIAL, channelAccountName: null }),
    ).not.toThrow();
  });
});
