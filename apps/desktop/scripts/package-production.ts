import { spawn } from 'node:child_process';
import { createPublicKey, X509Certificate } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type ProductionAuthVariant = 'staff' | 'phone';

export const PRODUCTION_SERVER_ORIGIN = 'https://121.199.29.74:35443';
const PRODUCTION_IP = new URL(PRODUCTION_SERVER_ORIGIN).hostname;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tlsDirectory = path.join(repositoryRoot, 'output', 'production-tls', PRODUCTION_IP);
const productionEnvironmentPath = path.join(repositoryRoot, 'apps', 'server', '.env.production');
const productionActions = ['check', 'package', 'make'] as const;

export type ProductionDesktopAction = (typeof productionActions)[number];

export function parseProductionDesktopCommand(argv: readonly string[]): Readonly<{
  action: ProductionDesktopAction;
  authVariant: ProductionAuthVariant;
  forwardedArguments: readonly string[];
}> {
  const action = productionActions.find((candidate) => candidate === argv[0]);
  if (!action) {
    throw new Error(
      `production desktop action 取值非法: ${argv[0] ?? '<missing>'}（可选 ${productionActions.join(' | ')}）`,
    );
  }
  const authVariantArguments = argv
    .slice(1)
    .filter((argument) => argument.startsWith('--auth-variant='));
  if (authVariantArguments.length > 1) {
    throw new Error('production desktop auth variant must be provided at most once');
  }
  const authVariantArgument = authVariantArguments[0];
  const rawAuthVariant = authVariantArgument?.slice('--auth-variant='.length) ?? 'staff';
  if (rawAuthVariant !== 'staff' && rawAuthVariant !== 'phone') {
    throw new Error(
      `production desktop auth variant 取值非法: ${rawAuthVariant}（可选 staff | phone）`,
    );
  }
  const authVariant: ProductionAuthVariant = rawAuthVariant;
  const forwardedArguments = argv
    .slice(1)
    .filter((argument) => !argument.startsWith('--auth-variant='));
  if (action === 'check' && forwardedArguments.length > 0) {
    throw new Error('production desktop check does not accept Forge arguments');
  }
  return { action, authVariant, forwardedArguments };
}

export function resolveProductionRmsOrigin(
  environmentText: string,
  allowInsecureRms = false,
): string {
  const matches = [...environmentText.matchAll(/^XIAOZHI_RMS_SERVER_URL="([^"\r\n]+)"\s*$/gm)];
  if (matches.length !== 1) {
    throw new Error(
      'Production environment must contain exactly one quoted XIAOZHI_RMS_SERVER_URL',
    );
  }
  const raw = matches[0]?.[1] ?? '';
  if (/replace[-_]with/i.test(raw)) {
    throw new Error('Production RMS URL still contains a placeholder');
  }
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(allowInsecureRms && url.protocol === 'http:')) {
    throw new Error(
      'Production RMS URL must use HTTPS; set XIAOZHI_ALLOW_INSECURE_RMS=1 to explicitly allow HTTP',
    );
  }
  if (url.username || url.password)
    throw new Error('Production RMS URL must not contain credentials');
  return url.origin;
}

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

export function validateProductionDesktopInputs(): Readonly<{
  privateCaPath: string;
  rmsOrigin: string;
  insecureRms: boolean;
}> {
  if (!existsSync(productionEnvironmentPath)) {
    throw new Error(`Missing production environment: ${productionEnvironmentPath}`);
  }
  const environmentStat = lstatSync(productionEnvironmentPath);
  if (!environmentStat.isFile() || environmentStat.isSymbolicLink()) {
    throw new Error('apps/server/.env.production must be a regular file, not a symbolic link');
  }
  if ((environmentStat.mode & 0o077) !== 0) {
    throw new Error('.env.production permissions must not allow group or other access');
  }
  const { privateCaPath } = validateProductionTlsMaterial();
  /**
   * 明文 HTTP 由本脚本自行放行，不再要求调用方每次手敲
   * `XIAOZHI_ALLOW_INSECURE_RMS=1`——与 `scripts/desktop-make.mjs` 的既有做法一致：
   * **豁免自动打开，但每次都告警**（告警在 `packageProductionDesktop` 里打）。
   *
   * 理由有两条：
   * - 生产 RMS 地址写死在 `.env.production` 里、且已被本函数校验过，调用方手敲那个
   *   变量并不构成任何额外确认，只是让命令更长、更容易被抄错或漏掉。
   * - `FOO=bar cmd` 在 Windows 的 cmd/PowerShell 上不成立，强制前缀等于让 Windows
   *   用户没法照抄文档里的命令。
   *
   * 关键是**豁免必须看得见**：这里放行，但 stderr 上每次都有一条 WARNING，
   * RMS 上 HTTPS 后 `resolveProductionRmsOrigin` 会自动恢复强制校验，告警随之消失。
   */
  const rmsOrigin = resolveProductionRmsOrigin(
    readFileSync(productionEnvironmentPath, 'utf8'),
    true,
  );
  return { privateCaPath, rmsOrigin, insecureRms: rmsOrigin.startsWith('http:') };
}

export async function packageProductionDesktop(
  action: Exclude<ProductionDesktopAction, 'check'>,
  authVariant: ProductionAuthVariant = 'staff',
  forwardedArguments: readonly string[] = [],
): Promise<number> {
  const { privateCaPath, rmsOrigin, insecureRms } = validateProductionDesktopInputs();
  if (insecureRms) {
    console.warn('WARNING: Production RMS uses HTTP; RMS traffic will travel unencrypted.');
  }
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(
    executable,
    [
      'run',
      `${action}:desktop:${authVariant}`,
      ...(forwardedArguments.length > 0 ? ['--', ...forwardedArguments] : []),
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        // 生产打包必须显式指定环境：`app-env-profiles.mjs` 的默认值是 `dev`，
        // 漏了这一条会打出「开发版产品名 + com.xiaozhi.hotel.dev 身份」却连着生产
        // 后端的包——数据目录与已装的开发版互相串，且发布物身份是错的。
        XIAOZHI_APP_ENV: 'online',
        HOTEL_BUTLER_SERVER_URL: PRODUCTION_SERVER_ORIGIN,
        HOTEL_BUTLER_PRIVATE_CA_PATH: privateCaPath,
        XIAOZHI_RMS_SERVER_URL: rmsOrigin,
        // 明文 HTTP 的豁免有**两道关卡**：本脚本（上面已放行）与构建期的
        // `vite-plugins/rms-origin.ts`。后者读的是环境变量，不下传的话 Vite 配置
        // 加载阶段就会抛「远端 RMS 地址必须使用 HTTPS」——上面的告警照常打印，
        // 却在几秒后构建失败，症状与豁免无关，很难归因。
        ...(insecureRms ? { XIAOZHI_ALLOW_INSECURE_RMS: '1' } : {}),
      },
      stdio: 'inherit',
    },
  );
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
  const command = parseProductionDesktopCommand(process.argv.slice(2));
  const operation =
    command.action === 'check'
      ? Promise.resolve().then(() => {
          const inputs = validateProductionDesktopInputs();
          console.info(`Production backend: ${PRODUCTION_SERVER_ORIGIN}`);
          console.info(`Production RMS: ${inputs.rmsOrigin}`);
          console.info(`Packaged private CA: ${inputs.privateCaPath}`);
          console.info(`Desktop authentication variant: ${command.authVariant}`);
          if (inputs.insecureRms) {
            console.warn('WARNING: Production RMS uses HTTP; RMS traffic will travel unencrypted.');
          }
          return 0;
        })
      : packageProductionDesktop(command.action, command.authVariant, command.forwardedArguments);
  operation
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((cause: unknown) => {
      console.error(cause instanceof Error ? cause.message : String(cause));
      process.exitCode = 1;
    });
}
