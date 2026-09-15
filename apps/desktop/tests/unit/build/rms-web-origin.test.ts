import { describe, expect, it } from 'vitest';
import { resolveRmsWebOriginForBuild } from '../../../vite-plugins/rms-web-origin';
import type { EnvironmentProfile } from '../../../vite-plugins/app-env-profiles.mjs';

/**
 * RMS web 页面地址的构建期取值规则。
 *
 * 重点在**回落**那一条：profile 的 `rmsWebOrigin` 为 null 时取该环境的 API 地址。
 * 部署环境下两者同源，这条回落让 pre/online 不必重复填一遍；dev 显式填了 `:5173`，
 * 走不到回落——两条路都得有用例，否则改错一边不会被发现。
 */
function profileWith(overrides: Partial<EnvironmentProfile>): () => EnvironmentProfile {
  return () => ({
    productName: 'x',
    bundleId: 'x',
    squirrelName: 'x',
    rmsOrigin: null,
    rmsWebOrigin: null,
    serverOrigin: null,
    sentryDsn: null,
    updateFeedUrl: null,
    updateSalt: null,
    ...overrides,
  });
}

describe('resolveRmsWebOriginForBuild', () => {
  it('显式 XIAOZHI_RMS_WEB_URL 优先于 profile', () => {
    const origin = resolveRmsWebOriginForBuild(
      { XIAOZHI_RMS_WEB_URL: 'https://web.example.com' },
      profileWith({ rmsWebOrigin: 'https://profile.example.com' }),
    );
    expect(origin).toBe('https://web.example.com');
  });

  it('未显式指定时取 profile 的 rmsWebOrigin', () => {
    const origin = resolveRmsWebOriginForBuild(
      {},
      profileWith({ rmsWebOrigin: 'http://localhost:5173', rmsOrigin: 'http://localhost:8080' }),
    );
    expect(origin).toBe('http://localhost:5173');
  });

  it('rmsWebOrigin 为 null 时回落到该环境的 API 地址', () => {
    const origin = resolveRmsWebOriginForBuild(
      {},
      profileWith({ rmsWebOrigin: null, rmsOrigin: 'https://rms.example.com' }),
    );
    expect(origin).toBe('https://rms.example.com');
  });

  it('两个地址都未配置时构建失败', () => {
    expect(() =>
      resolveRmsWebOriginForBuild({}, profileWith({ rmsWebOrigin: null, rmsOrigin: null })),
    ).toThrow(/尚未配置 RMS web 页面地址/);
  });

  it('非本机明文地址未豁免时构建失败', () => {
    expect(() =>
      resolveRmsWebOriginForBuild({ XIAOZHI_RMS_WEB_URL: 'http://web.example.com' }, profileWith({})),
    ).toThrow(/必须使用 HTTPS/);
  });

  it('非本机明文地址显式豁免后放行', () => {
    const origin = resolveRmsWebOriginForBuild(
      { XIAOZHI_RMS_WEB_URL: 'http://web.example.com', XIAOZHI_ALLOW_INSECURE_RMS: '1' },
      profileWith({}),
    );
    expect(origin).toBe('http://web.example.com');
  });

  it('本机明文地址无需豁免', () => {
    const origin = resolveRmsWebOriginForBuild(
      { XIAOZHI_RMS_WEB_URL: 'http://localhost:5173' },
      profileWith({}),
    );
    expect(origin).toBe('http://localhost:5173');
  });

  /**
   * 回落来的地址同样要过校验：把明文地址写进 PROFILES 与写在命令行上，风险一样。
   * 这条与 `rms-origin.ts` 的既有行为**刻意不同**——那边 profile 值不过校验。
   */
  it('回落来的非本机明文地址未豁免时同样失败', () => {
    expect(() =>
      resolveRmsWebOriginForBuild(
        {},
        profileWith({ rmsWebOrigin: null, rmsOrigin: 'http://rms.example.com' }),
      ),
    ).toThrow(/必须使用 HTTPS/);
  });

  it('非法 URL 报错指向 web 变量名', () => {
    expect(() =>
      resolveRmsWebOriginForBuild({ XIAOZHI_RMS_WEB_URL: 'not-a-url' }, profileWith({})),
    ).toThrow(/XIAOZHI_RMS_WEB_URL 不是合法 URL/);
  });
});
