import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const desktopRoot = path.resolve(import.meta.dirname, '../../..');

/**
 * 本用例往 `src/` 里写探针文件，再跑一次真实 eslint 看边界规则有没有拦住。
 *
 * ⚠️ 这些路径必须在**用例之外**声明，且用 `beforeEach`/`afterEach` 收口清理：
 * 原先 `mkdir` 写在 try 之前，一旦它抛 EEXIST（上一次失败留下的目录），finally
 * 根本不执行，残留就永久留在工作区里；下一次跑又因为残留而 EEXIST，形成死循环。
 * 实际就这么发生过——`src/` 里躺着五个探针文件，测试则一直红着。
 */
const PROBE_PATHS = {
  renderer: path.join(desktopRoot, 'src/renderer/__layer_boundary_probe__.svelte'),
  construction: path.join(desktopRoot, 'src/main/services/__composition_boundary_probe__.ts'),
  adapter: path.join(desktopRoot, 'src/main/services/__production_adapter_probe__.ts'),
  factory: path.join(desktopRoot, 'src/main/services/__production_factory_probe__.ts'),
  nestedDirectory: path.join(desktopRoot, 'src/main/services/__boundary_probe__'),
} as const;

/** `force: true` —— 不存在也不报错，所以前置清理与后置清理可以共用。 */
async function removeProbes(): Promise<void> {
  await Promise.all(
    Object.values(PROBE_PATHS).map((target) => rm(target, { force: true, recursive: true })),
  );
}

describe('desktop layer boundaries', () => {
  // 前置也清一次：上一次若被 Ctrl+C 打断，afterEach 不会跑。
  beforeEach(removeProbes);
  afterEach(removeProbes);

  it('rejects a renderer Svelte file that imports Electron main', async () => {
    const rendererProbePath = PROBE_PATHS.renderer;
    const constructionProbePath = PROBE_PATHS.construction;
    const adapterProbePath = PROBE_PATHS.adapter;
    const factoryProbePath = PROBE_PATHS.factory;
    const nestedProbePath = path.join(PROBE_PATHS.nestedDirectory, 'nested.ts');
    await mkdir(PROBE_PATHS.nestedDirectory, { recursive: true });
    await writeFile(
      rendererProbePath,
      '<script lang="ts">\nimport "../main/index";\n</script>\n',
      'utf8',
    );
    await writeFile(constructionProbePath, 'import "../browser/session-factory";\n', 'utf8');
    await writeFile(adapterProbePath, 'import "../gateway/rms/rms-hotel-gateway-http";\n', 'utf8');
    await writeFile(
      factoryProbePath,
      [
        'import "../database/application-database";',
        'import "../server-client/staff-server-fetch";',
        'import "../staff-auth/authenticated-rms-fetch";',
        'import "../staff-auth/token-store";',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(nestedProbePath, 'import "../../database/application-database";\n', 'utf8');

    const result = await execFileAsync('npm', ['run', 'lint', '--', '--no-cache'], {
      cwd: desktopRoot,
    }).then(
      ({ stdout, stderr }) => ({ exitCode: 0, output: `${stdout}${stderr}` }),
      (error: unknown) => {
        const failure = error as Readonly<{ code?: number; stdout?: string; stderr?: string }>;
        return {
          exitCode: failure.code ?? 1,
          output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
        };
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('renderer 不得 import main/');
    expect(result.output.match(/实现类只能在 composition root/g)).toHaveLength(7);
    /**
     * 60s 不是随手放大：这一条要跑一次完整的 `npm run lint -- --no-cache`，本机实测
     * 约 9s（裸 eslint 7s + npm 启动链）。原来的 15s 余量太小，机器一忙就越界——
     * 表现为「时好时坏」，而失败又留下残留，于是下一次必然继续失败。
     */
  }, 60_000);
});
