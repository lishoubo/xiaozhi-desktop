import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWindowsInstallDiagnostic } from '../create-windows-install-diagnostic.mjs';

test('generates a versioned launcher beside the unchanged installer', async () => {
  const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-diagnostic-test-'));
  const installer = path.join(releaseDir, 'setup.exe');
  await writeFile(installer, 'installer bytes');

  const launcher = await createWindowsInstallDiagnostic({
    releaseDir,
    productName: '小智酒店管家',
    squirrelName: 'xiaozhi-hotel',
    version: '1.0.6',
  });

  assert.equal(path.basename(launcher), '小智酒店管家-1.0.6-diagnostic-install.cmd');
  assert.equal(await readFile(installer, 'utf8'), 'installer bytes');
  const content = await readFile(launcher, 'ascii');
  assert.match(content, /xiaozhi-hotel/);
  assert.match(content, /TARGET_VERSION=1\.0\.6/);
  assert.match(content, /set "SETUP=%~dp0setup.exe"/);
  assert.doesNotMatch(content, /set "PRODUCT=%~n0"/);
  assert.match(content, /set "APP_FOLDER=%LOCALAPPDATA%\\%SQUIRREL_NAME%\\app-%TARGET_VERSION%"/);
  assert.match(content, /SquirrelSetup\.log/);
  assert.match(content, /Squirrel-Install\.log/);
  assert.match(content, /type "%%~fF" >> "%DIAG_LOG%" 2>&1/);
  assert.doesNotMatch(content, /powershell\.exe/i);
  assert.match(content, /INSTALL_EXIT/);
  assert.match(content, /set "DIAG_LOG=%~dp0install-diagnostic-1\.0\.6\.log"/);
  assert.ok(content.indexOf('> "%DIAG_LOG%"') < content.indexOf('if not exist "%SETUP%"'));
  assert.match(content, /if not exist "%DIAG_LOG%" goto log_fallback/);
  assert.match(content, /setlocal EnableExtensions DisableDelayedExpansion/);
  assert.match(content, /start "" \/wait "%SETUP%"\r?\n/);
  assert.doesNotMatch(content, /start "" \/wait "%SETUP%" >> "%DIAG_LOG%"/);
  assert.match(content, /start "" "%APP_EXE%"\r?\n/);
  assert.doesNotMatch(content, /start "" "%APP_EXE%" >> "%DIAG_LOG%"/);
  assert.match(content, /App folder existed before install:/);
  assert.match(content, /:installed_app_check/);
  // %~dp0 ends in a backslash; keep the quoted directory argument from ending in one.
  assert.match(content, /icacls "%~dp0\."/);
  assert.doesNotMatch(content, /call :/);
  assert.match(content, /:portable_dll_missing[\s\S]*:launch_portable/);
  assert.match(content, /Exact DLL path: "%DLL_FILE%"/);
  assert.match(content, /Exact DLL permissions:/);
  assert.match(content, /Exact DLL read result code:/);
  assert.match(content, /Directory write probe result code:/);
  assert.match(content, /install-diagnostic-write-probe-%RANDOM%-%RANDOM%\.tmp/);
  assert.doesNotMatch(content, /copy \/b(?: \/y)? "%~f0" "%DLL_FILE%"/);
  assert.doesNotMatch(content, /del \/f \/q "%DLL_FILE%"/);
  assert.match(content, /wevtutil qe "Microsoft-Windows-Windows Defender\/Operational"/);
  assert.match(content, /wevtutil qe "Microsoft-Windows-CodeIntegrity\/Operational"/);
  assert.match(content, /wevtutil qe "Microsoft-Windows-AppLocker\/EXE and DLL"/);
  assert.match(content, /:find_app/);
  assert.match(content, /if \/I not "%%~nxF"=="squirrel\.exe"/);
  assert.match(content, /App launch command exit code:/);
  assert.match(content, /type "%DIAG_LOG%"/);
  assert.doesNotMatch(content, /MessageBox/);
  assert.ok(content.indexOf('type "%DIAG_LOG%"') < content.lastIndexOf('pause'));
});

test('fails when the expected installer is missing', async () => {
  const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-diagnostic-test-'));
  await assert.rejects(
    createWindowsInstallDiagnostic({
      releaseDir,
      productName: '小智酒店管家',
      squirrelName: 'xiaozhi-hotel',
      version: '1.0.6',
    }),
    /安装程序不存在/,
  );
});

test(
  'reports a missing installer under native Windows CMD',
  { skip: process.platform !== 'win32' },
  async () => {
    const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-diagnostic-test-'));
    const installer = path.join(releaseDir, 'setup.exe');
    await writeFile(installer, 'fixture');
    const launcher = await createWindowsInstallDiagnostic({
      releaseDir,
      productName: '小智酒店管家',
      squirrelName: 'xiaozhi-hotel',
      version: '1.0.6',
    });
    await unlink(installer);

    const systemRoot = process.env.SystemRoot;
    assert.ok(systemRoot, 'SystemRoot must be defined on Windows');
    const cmd = spawnSync(path.join(systemRoot, 'System32', 'cmd.exe'), ['/d', '/c', launcher], {
      input: '\r\n',
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(cmd.status, 2, cmd.stderr);
    assert.match(cmd.stdout, /Setup executable was not found/);
    assert.match(cmd.stdout, /Installation diagnostic for version 1\.0\.6/);
    assert.match(cmd.stdout, /Files beside this diagnostic launcher:/);
    const diagnostic = await readFile(
      path.join(releaseDir, 'install-diagnostic-1.0.6.log'),
      'utf8',
    );
    assert.match(diagnostic, /Setup executable was not found/);
  },
);

test(
  'checks the portable app without launching squirrel.exe on Windows',
  { skip: process.platform !== 'win32' },
  async () => {
    const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-portable-test-'));
    const systemRoot = process.env.SystemRoot;
    assert.ok(systemRoot, 'SystemRoot must be defined on Windows');
    const hostname = path.join(systemRoot, 'System32', 'hostname.exe');
    await copyFile(hostname, path.join(releaseDir, '小智酒店管家.exe'));
    await copyFile(hostname, path.join(releaseDir, 'squirrel.exe'));
    const dll = path.join(releaseDir, 'd3dcompiler_47.dll');
    await writeFile(dll, 'existing DLL fixture');

    const installerDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-installer-test-'));
    await writeFile(path.join(installerDir, 'setup.exe'), 'fixture');
    const launcher = await createWindowsInstallDiagnostic({
      releaseDir: installerDir,
      productName: '小智酒店管家',
      squirrelName: 'xiaozhi-hotel',
      version: '1.0.6',
    });
    const portableLauncher = path.join(releaseDir, '诊断启动.cmd');
    await copyFile(launcher, portableLauncher);
    const cmd = spawnSync(path.join(systemRoot, 'System32', 'cmd.exe'), ['/d', '/c', portableLauncher], {
      env: { ...process.env, LOCALAPPDATA: releaseDir },
      input: '\r\n',
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(cmd.status, 0, cmd.stderr);
    const diagnostic = await readFile(path.join(releaseDir, 'install-diagnostic-1.0.6.log'), 'utf8');
    assert.match(diagnostic, /No setup executable found; checking the portable app instead/);
    assert.match(diagnostic, /App executable: .*小智酒店管家\.exe/);
    assert.match(diagnostic, /Exact DLL exists: True/);
    assert.match(diagnostic, /Exact DLL permissions:/);
    assert.match(diagnostic, /Exact DLL read result code: 0/);
    assert.equal(await readFile(dll, 'utf8'), 'existing DLL fixture');
    assert.match(diagnostic, /App launch command exit code: 0/, `CMD status: ${cmd.status}\nCMD stdout: ${cmd.stdout}\nCMD stderr: ${cmd.stderr}`);
  },
);

test(
  'writes a diagnostic log after a successful installer exit on Windows',
  { skip: process.platform !== 'win32' },
  async () => {
    const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-diagnostic-test-'));
    const systemRoot = process.env.SystemRoot;
    assert.ok(systemRoot, 'SystemRoot must be defined on Windows');
    await copyFile(
      path.join(systemRoot, 'System32', 'hostname.exe'),
      path.join(releaseDir, 'setup.exe'),
    );
    const localAppData = path.join(releaseDir, 'local-app-data');
    const squirrelTemp = path.join(localAppData, 'SquirrelTemp');
    await mkdir(squirrelTemp, { recursive: true });
    await mkdir(path.join(localAppData, 'xiaozhi-hotel', 'app-1.0.6'), {
      recursive: true,
    });
    await writeFile(path.join(squirrelTemp, 'SquirrelSetup.log'), 'Squirrel diagnostic marker\r\n');
    const launcher = await createWindowsInstallDiagnostic({
      releaseDir,
      productName: '小智酒店管家',
      squirrelName: 'xiaozhi-hotel',
      version: '1.0.6',
    });
    const renamedLauncher = path.join(releaseDir, '小智酒店管家-1.0.6-诊断.cmd');
    await copyFile(launcher, renamedLauncher);

    const cmd = spawnSync(
      path.join(systemRoot, 'System32', 'cmd.exe'),
      ['/d', '/c', renamedLauncher],
      {
        env: { ...process.env, LOCALAPPDATA: localAppData },
        input: '\r\n',
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    assert.equal(cmd.status, 0, cmd.stderr);
    assert.match(cmd.stdout, /Installer exit code: 0/);
    assert.match(cmd.stdout, /Squirrel log/);
    assert.match(cmd.stdout, /Squirrel diagnostic marker/);
    const diagnostic = await readFile(
      path.join(releaseDir, 'install-diagnostic-1.0.6.log'),
      'utf8',
    );
    assert.match(diagnostic, /Installer exit code: 0/);
    assert.match(diagnostic, /Setup executable: /);
    assert.match(diagnostic, /App folder exists: (True|False)/);
    assert.match(diagnostic, /Squirrel log/);
    assert.match(diagnostic, /Squirrel diagnostic marker/);
    assert.match(diagnostic, /Exact DLL exists: False; there is no file ACL to inspect/);
    assert.match(diagnostic, /Directory write probe result code: 0/);
    await assert.rejects(readFile(path.join(localAppData, 'xiaozhi-hotel', 'app-1.0.6', 'd3dcompiler_47.dll')));
    assert.deepEqual(
      (await readdir(path.join(localAppData, 'xiaozhi-hotel', 'app-1.0.6'))).filter((name) =>
        name.startsWith('install-diagnostic-write-probe-'),
      ),
      [],
    );
  },
);
