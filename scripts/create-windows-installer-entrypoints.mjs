import { readFile, rename, mkdtemp, writeFile, stat, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WRAPPER_SOURCE = new URL('./windows-setup-wrapper.c', import.meta.url);
const UNINSTALL_TEMPLATE = new URL('./windows-uninstall.cmd', import.meta.url);

function runCompiler(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw new Error(`无法运行 Windows 编译工具 ${command}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${command} 退出码 ${result.status}`);
}

/** Build a small launcher while keeping Forge's original Squirrel Setup beside it. */
export async function createWindowsInstallerEntrypoints({ releaseDir, productName, squirrelName }) {
  if (process.platform !== 'win32') throw new Error('Windows 安装入口必须在 Windows 上构建');
  if (!/^[a-zA-Z0-9_-]+$/.test(squirrelName)) throw new Error('无效的 Squirrel 应用名');
  if (!productName || /[\\/:*?"<>|]/.test(productName)) throw new Error('无效的产品名');

  const originalPath = path.join(releaseDir, 'setup.exe');
  const setupPath = path.join(releaseDir, `${productName}安装程序.exe`);
  const original = await stat(originalPath);
  if (!original.isFile() || original.size === 0) throw new Error(`无效的 Squirrel Setup: ${originalPath}`);
  const stage = await mkdtemp(path.join(releaseDir, '.installer-build-'));
  try {
    runCompiler('cl.exe', [
      '/nologo', '/W4', '/O2', '/MT', '/utf-8', '/DUNICODE', '/D_UNICODE', '/c',
      `/Fo:${path.join(stage, 'wrapper.obj')}`, fileURLToPath(WRAPPER_SOURCE),
    ], stage);
    runCompiler('link.exe', [
      '/nologo', '/SUBSYSTEM:WINDOWS', `/OUT:${path.join(stage, 'wrapped-setup.exe')}`,
      'wrapper.obj', 'kernel32.lib', 'user32.lib',
    ], stage);
    const result = await stat(path.join(stage, 'wrapped-setup.exe'));
    if (result.size === 0) throw new Error('安装入口大小异常');
    const template = await readFile(UNINSTALL_TEMPLATE, 'ascii');
    const uninstallPath = path.join(releaseDir, `${productName}-uninstall.cmd`);
    const stagedUninstallPath = path.join(stage, 'uninstall.cmd');
    await writeFile(stagedUninstallPath, template.replaceAll('__SQUIRREL_NAME__', squirrelName)
      .replace(/\r?\n/g, '\r\n'), { encoding: 'ascii', flag: 'wx' });
    await rename(path.join(stage, 'wrapped-setup.exe'), setupPath);
    await rename(stagedUninstallPath, uninstallPath);
    return { setupPath, uninstallPath };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
