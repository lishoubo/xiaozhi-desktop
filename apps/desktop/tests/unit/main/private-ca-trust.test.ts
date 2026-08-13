import { describe, expect, it, vi } from 'vitest';
import { installPrivateCaTrust } from '../../../src/main/server-client/private-ca-trust';

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
