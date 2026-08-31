import { describe, expect, it, vi, beforeEach } from 'vitest';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { trustPrivateCaGlobally } from '../../../src/main/error-reporting/global-ca-trust';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** 真签一张 CA，比硬编码一段过期 PEM 更能反映实际行为。 */
function generateCaPem(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'ca-trust-test-'));
  const keyPath = path.join(directory, 'ca.key');
  const certPath = path.join(directory, 'ca.pem');
  execFileSync('openssl', ['genrsa', '-out', keyPath, '2048'], { stdio: 'ignore' });
  execFileSync(
    'openssl',
    // prettier-ignore
    ['req', '-x509', '-new', '-key', keyPath, '-days', '3650', '-out', certPath,
     '-subj', '/CN=Test Private CA'],
    { stdio: 'ignore' },
  );
  return execFileSync('cat', [certPath], { encoding: 'utf8' });
}

describe('trustPrivateCaGlobally', () => {
  beforeEach(() => {
    globalThis.__xiaozhiTrustedCaFingerprints__ = undefined;
    vi.restoreAllMocks();
  });

  it('把 CA 追加进全局默认信任列表，原有根证书保持不变', () => {
    const caPem = generateCaPem();
    const before = tls.rootCertificates.length;
    const setDefault = vi
      .spyOn(tls, 'setDefaultCACertificates' as keyof typeof tls)
      .mockImplementation(() => undefined);

    trustPrivateCaGlobally(caPem, createLogger());

    expect(setDefault).toHaveBeenCalledTimes(1);
    const installed = setDefault.mock.calls[0][0] as readonly string[];
    expect(installed).toHaveLength(before + 1);
    expect(installed.at(-1)).toBe(caPem);
  });

  /** 主进程理论上只初始化一次，但重入不该把信任列表撑大。 */
  it('重复装同一份 CA 只生效一次', () => {
    const caPem = generateCaPem();
    const setDefault = vi
      .spyOn(tls, 'setDefaultCACertificates' as keyof typeof tls)
      .mockImplementation(() => undefined);

    trustPrivateCaGlobally(caPem, createLogger());
    trustPrivateCaGlobally(caPem, createLogger());

    expect(setDefault).toHaveBeenCalledTimes(1);
  });

  /**
   * 证书坏了只该少一个上报通道，不该让应用起不来 ——
   * 2026-08-17 真机上就出过「缺一份用不上的证书导致启动即崩」。
   */
  it('CA 解析失败时留一条 warn 并放行，不抛异常', () => {
    const logger = createLogger();

    expect(() => trustPrivateCaGlobally('not a certificate', logger)).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be parsed'),
      expect.anything(),
    );
  });
});

/** 前置假设：Electron 43 内嵌 Node 24，该 API 必须存在，否则上报会静默失败。 */
describe('运行时前置条件', () => {
  it('tls.setDefaultCACertificates 可用', () => {
    expect(typeof (tls as Record<string, unknown>).setDefaultCACertificates).toBe('function');
  });

  it('生成的测试 CA 确实是 CA 证书', () => {
    expect(new X509Certificate(generateCaPem()).ca).toBe(true);
  });
});
