import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve('.');

describe('renderer font assets', () => {
  it('self-hosts MiSans as the renderer sans-serif font', () => {
    const stylesheet = fs.readFileSync(
      path.join(projectRoot, 'src/renderer/styles/global.css'),
      'utf8',
    );
    const fontPath = path.join(projectRoot, 'src/renderer/assets/fonts/MiSansVF.woff2');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { devDependencies?: Record<string, string> };

    expect(stylesheet).toContain("font-family: 'MiSans Variable'");
    expect(stylesheet).toContain("url('../assets/fonts/MiSansVF.woff2') format('woff2')");
    expect(stylesheet).toContain('font-weight: 100 900');
    expect(fs.readFileSync(fontPath).subarray(0, 4).toString('ascii')).toBe('wOF2');
    expect(packageJson.devDependencies).not.toHaveProperty('@fontsource-variable/inter');
  });
});
