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

/**
 * 读取随包分发的私有 CA；没有就返回 `null`（调用方随之不安装私有信任）。
 *
 * ## 「显式指定」与「随包约定」的区别是有意的
 *
 * - `HOTEL_BUTLER_PRIVATE_CA_PATH` 是**显式要求**：指了却读不到，说明打包命令写错了，
 *   MUST 抛错——静默忽略会打出一个「以为信任了、其实没有」的包。
 * - 打包产物里的 `<resources>/private-ca.pem` 是**约定位置**：文件在就装信任，
 *   不在就跳过。
 *
 * ## 为什么后者不能也抛错
 *
 * 原实现对任何打包产物都强制要求该文件存在，等价于「打包 == 生产打包」。这个假设在
 * 只有生产一种打包方式时成立，但 dev / pre / online 三套环境落地后就不成立了：
 * pre 包不连 hotel-butler server，却因为缺一份用不上的证书**启动即崩**
 * （2026-08-17 真机实测，日志只留下 `errorName: 'Error'`）。
 *
 * 缺证书的真正后果是「连不上那台自签 HTTPS 服务器」，那应该在**发起请求时**暴露成
 * 一个带上下文的网络错误，而不是让整个应用起不来——后者既拦住了与 server 无关的
 * 全部功能，又把可诊断性降到最低。
 */
export function loadPackagedPrivateCa(
  packaged: boolean,
  resourcesPath: string,
  environment: NodeJS.ProcessEnv,
): string | null {
  const configured = environment.HOTEL_BUTLER_PRIVATE_CA_PATH?.trim();
  const filePath = configured || (packaged ? path.join(resourcesPath, 'private-ca.pem') : '');
  if (!filePath) return null;
  if (!existsSync(filePath)) {
    if (configured) throw new Error(`Private CA certificate was not found: ${filePath}`);
    return null;
  }
  const pem = readFileSync(filePath, 'utf8');
  const certificate = new X509Certificate(pem);
  if (!certificate.ca)
    throw new Error('HOTEL_BUTLER_PRIVATE_CA_PATH must contain a CA certificate');
  return pem;
}
