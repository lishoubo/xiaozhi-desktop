import { describe, expect, it } from 'vitest';
import {
  environmentProfile,
  resolveAppEnvironment,
  type AppEnvironment,
} from '../../../vite-plugins/app-env';
import { resolveRmsOriginForBuild } from '../../../vite-plugins/rms-origin';
import { resolveServerOriginForBuild } from '../../../vite-plugins/server-origin';

describe('resolveAppEnvironment', () => {
  it('缺省取 dev —— 误打开发包的风险远低于误打生产包', () => {
    expect(resolveAppEnvironment({})).toBe('dev');
    expect(resolveAppEnvironment({ XIAOZHI_APP_ENV: '' })).toBe('dev');
  });

  it.each(['dev', 'pre', 'online'] satisfies AppEnvironment[])('接受合法值 %s', (value) => {
    expect(resolveAppEnvironment({ XIAOZHI_APP_ENV: value })).toBe(value);
  });

  it('非法值抛错而不静默回退', () => {
    expect(() => resolveAppEnvironment({ XIAOZHI_APP_ENV: 'prod' })).toThrow(/取值非法/);
  });
});

describe('environmentProfile', () => {
  it('三套环境的应用标识两两不同，才能并存安装', () => {
    const profiles = (['dev', 'pre', 'online'] satisfies AppEnvironment[]).map((value) =>
      environmentProfile({ XIAOZHI_APP_ENV: value }),
    );

    for (const key of ['productName', 'bundleId', 'squirrelName'] as const) {
      expect(new Set(profiles.map((profile) => profile[key])).size).toBe(profiles.length);
    }
  });

  it('online 展示名不含环境标记，dev / pre 带标记', () => {
    expect(environmentProfile({ XIAOZHI_APP_ENV: 'online' }).productName).toBe('小智酒店管家');
    expect(environmentProfile({ XIAOZHI_APP_ENV: 'pre' }).productName).toContain('[预发]');
    expect(environmentProfile({ XIAOZHI_APP_ENV: 'dev' }).productName).toContain('[开发]');
  });

  it('Squirrel 标识是纯 ASCII —— Windows 路径与注册表对非 ASCII 支持不佳', () => {
    for (const value of ['dev', 'pre', 'online'] satisfies AppEnvironment[]) {
      // eslint-disable-next-line no-control-regex
      expect(environmentProfile({ XIAOZHI_APP_ENV: value }).squirrelName).toMatch(/^[\x00-\x7F]+$/);
    }
  });
});

describe('resolveRmsOriginForBuild', () => {
  it('未指定地址时取该环境的 profile 默认值', () => {
    for (const value of ['dev', 'pre', 'online'] satisfies AppEnvironment[]) {
      expect(resolveRmsOriginForBuild({ XIAOZHI_APP_ENV: value })).toBe(
        environmentProfile({ XIAOZHI_APP_ENV: value }).rmsOrigin,
      );
    }
  });

  /**
   * 「地址未确定就必须构建失败」是 `resolveRmsOriginForBuild` 的固有规则，不是某个
   * 环境的属性。此前这条用 `online` 来触发——`online` 的 `rmsOrigin` 当时是 `null`。
   * 5c13af4 把它改成指向 pre 的 RMS 后，用例就一直是红的（规则没坏，触发条件没了）。
   *
   * 改为直接构造一个 `rmsOrigin` 为 null 的 profile：规则本身照测，且不再随 PROFILES
   * 里某个环境的取值变动而失效。
   */
  it('地址未确定时构建失败，不兜底也不填占位地址', () => {
    const withoutOrigin = { ...environmentProfile({ XIAOZHI_APP_ENV: 'online' }), rmsOrigin: null };

    expect(() =>
      resolveRmsOriginForBuild({ XIAOZHI_APP_ENV: 'online' }, () => withoutOrigin),
    ).toThrow(/尚未配置默认 RMS 地址/);
  });

  it('显式指定的地址覆盖 profile 默认值', () => {
    expect(
      resolveRmsOriginForBuild({
        XIAOZHI_APP_ENV: 'online',
        XIAOZHI_RMS_SERVER_URL: 'https://rms.example.com',
      }),
    ).toBe('https://rms.example.com');
  });

  it('非本机明文 HTTP 未豁免时构建失败', () => {
    expect(() =>
      resolveRmsOriginForBuild({
        XIAOZHI_APP_ENV: 'online',
        XIAOZHI_RMS_SERVER_URL: 'http://rms.example.com',
      }),
    ).toThrow(/必须使用 HTTPS/);
  });

  it('显式豁免后放行明文 HTTP', () => {
    expect(
      resolveRmsOriginForBuild({
        XIAOZHI_APP_ENV: 'online',
        XIAOZHI_RMS_SERVER_URL: 'http://rms.example.com',
        XIAOZHI_ALLOW_INSECURE_RMS: '1',
      }),
    ).toBe('http://rms.example.com');
  });

  it('本机地址无需豁免', () => {
    expect(
      resolveRmsOriginForBuild({
        XIAOZHI_APP_ENV: 'online',
        XIAOZHI_RMS_SERVER_URL: 'http://localhost:8080',
      }),
    ).toBe('http://localhost:8080');
  });
});

/**
 * hotel-butler server 地址（AI 助理与私有 CA 信任用；登录走 RMS，不经这里）。
 *
 * 这一组用例是 2026-09-01 线上事故的回归：当时本函数是
 * `HOTEL_BUTLER_SERVER_URL ?? 'https://localhost:5173'`，CI 没设该变量，
 * 于是打出的包连着用户自己的电脑。规则现在与 `resolveRmsOriginForBuild` 对齐
 * —— 地址未确定就构建失败，绝不回落。
 */
describe('resolveServerOriginForBuild', () => {
  it('未指定地址时取该环境的 profile 默认值', () => {
    for (const value of ['dev', 'pre', 'online'] satisfies AppEnvironment[]) {
      expect(resolveServerOriginForBuild({ XIAOZHI_APP_ENV: value })).toBe(
        environmentProfile({ XIAOZHI_APP_ENV: value }).serverOrigin,
      );
    }
  });

  it('地址未确定时构建失败，不再回落到 localhost', () => {
    const withoutOrigin = {
      ...environmentProfile({ XIAOZHI_APP_ENV: 'online' }),
      serverOrigin: null,
    };

    expect(() =>
      resolveServerOriginForBuild({ XIAOZHI_APP_ENV: 'online' }, () => withoutOrigin),
    ).toThrow(/尚未配置 hotel-butler server 地址/);
  });

  it('显式指定的地址覆盖 profile 默认值', () => {
    expect(
      resolveServerOriginForBuild({
        XIAOZHI_APP_ENV: 'online',
        HOTEL_BUTLER_SERVER_URL: 'https://server.example.com:8443/ignored-path',
      }),
    ).toBe('https://server.example.com:8443');
  });

  /** 凭证与业务数据都走这条链，明文 HTTP 一律拒绝——这里没有 RMS 那样的豁免开关。 */
  it('拒绝非 HTTPS 地址', () => {
    expect(() =>
      resolveServerOriginForBuild({
        XIAOZHI_APP_ENV: 'online',
        HOTEL_BUTLER_SERVER_URL: 'http://server.example.com',
      }),
    ).toThrow(/must use HTTPS/);
  });
});
