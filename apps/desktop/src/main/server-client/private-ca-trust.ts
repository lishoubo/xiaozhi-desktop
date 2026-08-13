import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import type { Certificate, Session } from 'electron';

type VerifyRequest = Readonly<{
  hostname: string;
  certificate: Certificate;
  verificationResult: string;
}>;

type CertificateVerifySession = Pick<Session, 'setCertificateVerifyProc'>;

function certificateIsCurrent(certificate: X509Certificate, now: Date): boolean {
  const time = now.getTime();
  return Date.parse(certificate.validFrom) <= time && time <= Date.parse(certificate.validTo);
}

function certificateMatchesHost(certificate: X509Certificate, hostname: string): boolean {
  return isIP(hostname)
    ? certificate.checkIP(hostname) === hostname
    : certificate.checkHost(hostname) === hostname;
}

export function certificateChainsToPrivateCa(
  leafCertificate: Certificate,
  hostname: string,
  caPem: string,
  now = new Date(),
): boolean {
  try {
    const trustedCa = new X509Certificate(caPem);
    if (!trustedCa.ca || !certificateIsCurrent(trustedCa, now)) return false;
    const visited = new Set<string>();
    let current = leafCertificate;
    const leaf = new X509Certificate(current.data);
    if (!certificateIsCurrent(leaf, now) || !certificateMatchesHost(leaf, hostname)) return false;

    for (let depth = 0; depth < 8; depth += 1) {
      const parsed = new X509Certificate(current.data);
      if (!certificateIsCurrent(parsed, now) || visited.has(parsed.fingerprint256)) return false;
      visited.add(parsed.fingerprint256);
      if (parsed.raw.equals(trustedCa.raw)) return true;
      const issuer = current.issuerCert;
      if (!issuer || issuer === current) {
        return (depth === 0 || parsed.ca) && parsed.verify(trustedCa.publicKey);
      }
      const parsedIssuer = new X509Certificate(issuer.data);
      if (!parsedIssuer.ca || !parsed.verify(parsedIssuer.publicKey)) return false;
      current = issuer;
    }
  } catch {
    return false;
  }
  return false;
}

export function installPrivateCaTrust(
  apiSession: CertificateVerifySession,
  serverOrigin: string,
  caPem: string,
  verify = certificateChainsToPrivateCa,
): void {
  const trustedHostname = new URL(serverOrigin).hostname;
  apiSession.setCertificateVerifyProc((request: VerifyRequest, callback) => {
    if (request.verificationResult === 'OK') {
      callback(-3);
      return;
    }
    const unknownAuthority = request.verificationResult
      .toUpperCase()
      .includes('CERT_AUTHORITY_INVALID');
    callback(
      request.hostname === trustedHostname &&
        unknownAuthority &&
        verify(request.certificate, request.hostname, caPem)
        ? 0
        : -2,
    );
  });
}

export function loadPackagedPrivateCa(
  packaged: boolean,
  resourcesPath: string,
  environment: NodeJS.ProcessEnv,
): string | null {
  const configured = environment.HOTEL_BUTLER_PRIVATE_CA_PATH?.trim();
  const filePath = configured || (packaged ? path.join(resourcesPath, 'private-ca.pem') : '');
  if (!filePath) return null;
  if (!existsSync(filePath)) throw new Error(`Private CA certificate was not found: ${filePath}`);
  const pem = readFileSync(filePath, 'utf8');
  const certificate = new X509Certificate(pem);
  if (!certificate.ca)
    throw new Error('HOTEL_BUTLER_PRIVATE_CA_PATH must contain a CA certificate');
  return pem;
}
