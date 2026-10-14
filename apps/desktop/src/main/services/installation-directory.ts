import path from 'node:path';

/** Windows Squirrel 会把每个版本安装在安装根目录下的 app-<版本> 子目录。 */
export function resolveInstallationDirectory(
  executablePath: string,
  platform: NodeJS.Platform,
): string {
  const paths = platform === 'win32' ? path.win32 : path;
  const executableDirectory = paths.dirname(executablePath);
  if (
    platform === 'win32' &&
    /^app-\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/i.test(paths.basename(executableDirectory))
  ) {
    return paths.dirname(executableDirectory);
  }
  if (platform === 'darwin' && paths.basename(executableDirectory) === 'MacOS') {
    const contentsDirectory = paths.dirname(executableDirectory);
    const appBundleDirectory = paths.dirname(contentsDirectory);
    if (
      paths.basename(contentsDirectory) === 'Contents' &&
      paths.basename(appBundleDirectory).endsWith('.app')
    ) {
      return appBundleDirectory;
    }
  }
  return executableDirectory;
}
