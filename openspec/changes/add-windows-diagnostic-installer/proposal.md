## Why

Windows Squirrel installation failures currently show a generic dialog. Customer support may be unable to retrieve the setup log, leaving the failure stage and cause unknown. The manually assembled 1.0.6 diagnostic launcher gives a useful screenshot, but future GitHub release packages do not include it.

## What Changes

- Generate a versioned diagnostic `.cmd` launcher after a successful Windows Squirrel `make`, in the same release directory as Setup.exe, `.nupkg`, and `RELEASES`.
- Have the diagnostic launcher show the installer exit code, installed app directory state, and recent Squirrel setup log lines after Setup.exe closes. If the GUI dialog cannot open, keep the details visible in the command window.
- Include the diagnostic launcher directly in the normal GitHub Actions Windows release artifact.
- Leave the Squirrel update feed and ordinary Setup.exe behavior unchanged.

## Capabilities

### New Capabilities

- `desktop-windows-diagnostic-release`: Include a Windows installation diagnostic launcher in every normal release package.

### Modified Capabilities

None.

## Impact

- `scripts/desktop-make.mjs` and a diagnostic launcher template/generator.
- `.github/workflows/build-windows.yml` artifact selection.
- The release artifact adds one small command script. No runtime API, database, or dependency changes.
