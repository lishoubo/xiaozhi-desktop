import { execFile } from 'node:child_process';
import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const desktopRoot = path.resolve(import.meta.dirname, '../../..');

describe('desktop layer boundaries', () => {
  it('rejects a renderer Svelte file that imports Electron main', async () => {
    const rendererProbePath = path.join(
      desktopRoot,
      'src/renderer/__layer_boundary_probe__.svelte',
    );
    const constructionProbePath = path.join(
      desktopRoot,
      'src/main/services/__composition_boundary_probe__.ts',
    );
    const adapterProbePath = path.join(
      desktopRoot,
      'src/main/services/__production_adapter_probe__.ts',
    );
    const factoryProbePath = path.join(
      desktopRoot,
      'src/main/services/__production_factory_probe__.ts',
    );
    const nestedProbeDirectory = path.join(desktopRoot, 'src/main/services/__boundary_probe__');
    const nestedProbePath = path.join(nestedProbeDirectory, 'nested.ts');
    await mkdir(nestedProbeDirectory);
    await writeFile(
      rendererProbePath,
      '<script lang="ts">\nimport "../main/index";\n</script>\n',
      'utf8',
    );
    await writeFile(
      constructionProbePath,
      'import "../browser/session-factory";\n',
      'utf8',
    );
    await writeFile(
      adapterProbePath,
      'import "../gateway/rms/rms-hotel-gateway-http";\n',
      'utf8',
    );
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

    try {
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
    } finally {
      await Promise.all([
        unlink(rendererProbePath),
        unlink(constructionProbePath),
        unlink(adapterProbePath),
        unlink(factoryProbePath),
        unlink(nestedProbePath),
      ]);
      await rmdir(nestedProbeDirectory);
    }
  }, 15_000);
});
