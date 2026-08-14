import { spawn } from 'node:child_process';
import { createPublicKey, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PRODUCTION_SERVER_ORIGIN = 'https://121.199.29.74:35443';
const PRODUCTION_IP = new URL(PRODUCTION_SERVER_ORIGIN).hostname;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tlsDirectory = path.join(repositoryRoot, 'output', 'production-tls', PRODUCTION_IP);

function assertCurrent(certificate: X509Certificate, label: string, now = new Date()): void {
  const timestamp = now.getTime();
  if (
    timestamp < Date.parse(certificate.validFrom) ||
    timestamp > Date.parse(certificate.validTo)
  ) {
    throw new Error(`${label} is not currently valid`);
  }
}

function publicKeyDer(key: ReturnType<typeof createPublicKey>): string {
  return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

export function validateProductionTlsMaterial(directory = tlsDirectory): Readonly<{
  privateCaPath: string;
}> {
  const serverDirectory = path.join(directory, 'server');
  const desktopDirectory = path.join(directory, 'desktop');
  const caPath = path.join(serverDirectory, 'ca.pem');
  const certificatePath = path.join(serverDirectory, 'cert.pem');
  const keyPath = path.join(serverDirectory, 'key.pem');
  const privateCaPath = path.join(desktopDirectory, 'private-ca.pem');
  for (const requiredPath of [caPath, certificatePath, keyPath, privateCaPath]) {
    if (!existsSync(requiredPath)) throw new Error(`Missing production TLS file: ${requiredPath}`);
  }
  const desktopFiles = readdirSync(desktopDirectory);
  if (desktopFiles.length !== 1 || desktopFiles[0] !== 'private-ca.pem') {
    throw new Error('Desktop TLS resources must contain only private-ca.pem');
  }

  const caPem = readFileSync(caPath, 'utf8');
  const desktopCaPem = readFileSync(privateCaPath, 'utf8');
  const certificatePem = readFileSync(certificatePath, 'utf8');
  const keyPem = readFileSync(keyPath, 'utf8');
  if (desktopCaPem !== caPem) throw new Error('Desktop CA does not match the server CA');
  if (/PRIVATE KEY/.test(desktopCaPem))
    throw new Error('Desktop CA resource contains private material');

  const ca = new X509Certificate(caPem);
  const certificate = new X509Certificate(certificatePem);
  assertCurrent(ca, 'Production CA');
  assertCurrent(certificate, 'Production server certificate');
  if (!ca.ca) throw new Error('Production CA certificate is not a CA');
  if (certificate.ca) throw new Error('Production server certificate must not be a CA');
  if (certificate.checkIP(PRODUCTION_IP) !== PRODUCTION_IP) {
    throw new Error(`Production server certificate is not valid for ${PRODUCTION_IP}`);
  }
  if (!certificate.verify(ca.publicKey)) {
    throw new Error('Production server certificate does not chain to the packaged CA');
  }
  if (publicKeyDer(certificate.publicKey) !== publicKeyDer(createPublicKey(keyPem))) {
    throw new Error('Production server certificate and private key do not match');
  }
  return { privateCaPath };
}

export async function packageProductionDesktop(): Promise<number> {
  const { privateCaPath } = validateProductionTlsMaterial();
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(executable, ['run', 'package:desktop:staff'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HOTEL_BUTLER_SERVER_URL: PRODUCTION_SERVER_ORIGIN,
      HOTEL_BUTLER_PRIVATE_CA_PATH: privateCaPath,
    },
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) resolve(128 + (signal === 'SIGINT' ? 2 : 15));
      else resolve(code ?? 1);
    });
  });
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  packageProductionDesktop()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((cause: unknown) => {
      console.error(cause instanceof Error ? cause.message : String(cause));
      process.exitCode = 1;
    });
}
