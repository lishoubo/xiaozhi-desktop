import { describe, expect, it } from 'vitest';
import {
  environmentProfile,
  resolveAppEnvironment,
  type AppEnvironment,
} from '../../../vite-plugins/app-env';
import { resolveRmsOriginForBuild } from '../../../vite-plugins/rms-origin';

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
    expect(resolveRmsOriginForBuild({ XIAOZHI_APP_ENV: 'dev' })).toBe('http://localhost:8080');
    expect(resolveRmsOriginForBuild({ XIAOZHI_APP_ENV: 'pre' })).toBe('http://47.96.144.176');
  });

  it('online 地址未确定时构建失败，不兜底也不填占位地址', () => {
    expect(() => resolveRmsOriginForBuild({ XIAOZHI_APP_ENV: 'online' })).toThrow(
      /尚未配置默认 RMS 地址/,
    );
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
