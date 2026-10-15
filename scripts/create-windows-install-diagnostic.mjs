import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TEMPLATE = new URL('./windows-install-diagnostic.cmd', import.meta.url);

/** Add a support launcher to Forge's Windows release directory without changing Setup.exe. */
export async function createWindowsInstallDiagnostic({
  releaseDir,
  productName,
  squirrelName,
  version,
}) {
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) {
    throw new Error(`无效的桌面版本号: ${version}`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(squirrelName)) {
    throw new Error(`无效的 Squirrel 应用名: ${squirrelName}`);
  }

  const setupPath = path.join(releaseDir, 'setup.exe');
  let setupFile;
  try {
    setupFile = await stat(setupPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Windows 安装程序不存在: ${setupPath}`, { cause: error });
  }
  if (!setupFile.isFile()) throw new Error(`Windows 安装程序不是文件: ${setupPath}`);

  const template = await readFile(TEMPLATE, 'ascii');
  const content = template
    .replaceAll('__APP_VERSION__', version)
    .replaceAll('__SQUIRREL_NAME__', squirrelName)
    .replace(/\r?\n/g, '\r\n');
  const outputPath = path.join(releaseDir, '应用诊断.cmd');
  await writeFile(outputPath, content, { encoding: 'ascii', flag: 'wx' });
  return outputPath;
}
