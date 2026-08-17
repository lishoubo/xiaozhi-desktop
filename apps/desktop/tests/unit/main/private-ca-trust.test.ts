import { describe, expect, it, vi } from 'vitest';
import {
  installPrivateCaTrust,
  loadPackagedPrivateCa,
} from '../../../src/main/server-client/private-ca-trust';

describe('private server CA trust', () => {
  it('scopes the exception to the configured backend hostname and keeps public trust unchanged', () => {
    type VerifyProc = Exclude<
      Parameters<Parameters<typeof installPrivateCaTrust>[0]['setCertificateVerifyProc']>[0],
      null
    >;
    let installedVerifyProc: VerifyProc | undefined;
    const apiSession = {
      setCertificateVerifyProc: vi.fn((next) => {
        installedVerifyProc = next ?? undefined;
      }),
    };
    const verify = vi.fn().mockReturnValue(true);
    installPrivateCaTrust(apiSession, 'https://10.0.0.8', 'test-ca', verify);
    const verifyProc = installedVerifyProc;
    if (verifyProc === undefined) throw new Error('Certificate verifier was not installed');
    const callback = vi.fn();
    const certificate = {} as never;

    verifyProc(
      {
        hostname: 'public.example.com',
        certificate,
        validatedCertificate: certificate,
        isIssuedByKnownRoot: true,
        verificationResult: 'OK',
        errorCode: 0,
      },
      callback,
    );
    expect(callback).toHaveBeenLastCalledWith(-3);

    verifyProc(
      {
        hostname: 'attacker.example.com',
        certificate,
        validatedCertificate: certificate,
        isIssuedByKnownRoot: false,
        verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
        errorCode: -202,
      },
      callback,
    );
    expect(callback).toHaveBeenLastCalledWith(-2);
    expect(verify).not.toHaveBeenCalled();

    verifyProc(
      {
        hostname: '10.0.0.8',
        certificate,
        validatedCertificate: certificate,
        isIssuedByKnownRoot: false,
        verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
        errorCode: -202,
      },
      callback,
    );
    expect(verify).toHaveBeenCalledWith(certificate, '10.0.0.8', 'test-ca');
    expect(callback).toHaveBeenLastCalledWith(0);

    verifyProc(
      {
        hostname: '10.0.0.8',
        certificate,
        validatedCertificate: certificate,
        isIssuedByKnownRoot: false,
        verificationResult: 'net::ERR_CERT_REVOKED',
        errorCode: -206,
      },
      callback,
    );
    expect(callback).toHaveBeenLastCalledWith(-2);
  });
});

/**
 * 🔴 回归：2026-08-17 真机事故。原实现对**任何**打包产物强制要求
 * `<resources>/private-ca.pem` 存在，等价于「打包 == 生产打包」。pre 包不连
 * hotel-butler server，却因为缺一份用不上的证书启动即崩。
 */
describe('loadPackagedPrivateCa', () => {
  const resources = '/nonexistent-resources';

  it('未打包且未指定路径时返回 null —— 开发态不需要私有信任', () => {
    expect(loadPackagedPrivateCa(false, resources, {})).toBeNull();
  });

  it('打包产物缺少约定位置的证书时返回 null，而不是让应用起不来', () => {
    expect(loadPackagedPrivateCa(true, resources, {})).toBeNull();
  });

  it('显式指定的路径读不到时必须抛错 —— 那是打包命令写错了，不能静默忽略', () => {
    expect(() =>
      loadPackagedPrivateCa(true, resources, {
        HOTEL_BUTLER_PRIVATE_CA_PATH: '/nonexistent/private-ca.pem',
      }),
    ).toThrow(/Private CA certificate was not found/);
  });
});
