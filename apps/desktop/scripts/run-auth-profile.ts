import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const profiles = ['staff', 'phone'] as const;
const actions = [
  'dev',
  'package',
  'make',
  'make:mac:intel',
  'make:mac:arm64',
  'make:win64',
] as const;

export type DesktopAuthProfile = (typeof profiles)[number];
export type DesktopProfileAction = (typeof actions)[number];

function parseChoice<T extends string>(
  label: string,
  raw: string | undefined,
  choices: readonly T[],
): T {
  const value = choices.find((choice) => choice === raw);
  if (value) return value;
  throw new Error(`${label} 取值非法: ${raw ?? '<missing>'}（可选 ${choices.join(' | ')}）`);
}

export function parseDesktopProfileCommand(argv: readonly string[]): Readonly<{
  profile: DesktopAuthProfile;
  action: DesktopProfileAction;
  forwardedArguments: readonly string[];
}> {
  return {
    profile: parseChoice('desktop auth profile', argv[0], profiles),
    action: parseChoice('desktop profile action', argv[1], actions),
    forwardedArguments: argv.slice(2),
  };
}

export function desktopProfileEnvironment(
  profile: DesktopAuthProfile,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...environment, XIAOZHI_AUTH_VARIANT: profile };
}

export async function runDesktopProfile(argv: readonly string[]): Promise<number> {
  const command = parseDesktopProfileCommand(argv);
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(
    npmExecutable,
    [
      'run',
      command.action,
      '--workspace',
      '@hotel-butler/desktop',
      ...(command.forwardedArguments.length > 0 ? ['--', ...command.forwardedArguments] : []),
    ],
    {
      env: desktopProfileEnvironment(command.profile),
      stdio: 'inherit',
    },
  );

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!child.killed) child.kill(signal);
  };
  const forwardInterrupt = (): void => forwardSignal('SIGINT');
  const forwardTermination = (): void => forwardSignal('SIGTERM');
  process.once('SIGINT', forwardInterrupt);
  process.once('SIGTERM', forwardTermination);

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', forwardInterrupt);
      process.removeListener('SIGTERM', forwardTermination);
      if (signal) resolve(128 + (signal === 'SIGINT' ? 2 : 15));
      else resolve(code ?? 1);
    });
  });
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  runDesktopProfile(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(message);
      process.exitCode = 1;
    });
}
