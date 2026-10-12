## Context

`scripts/desktop-make.mjs` invokes Forge and currently stops after `make`. The Windows workflow uploads files from `apps/desktop/out/staff/make/squirrel.windows/x64/`; Squirrel's Setup.exe has a fixed generic failure dialog. The earlier 1.0.6 support launcher demonstrated that a separate command script can display the setup result after that dialog closes.

## Goals / Non-Goals

**Goals:** Generate a small support launcher beside Setup.exe for every normal Windows x64 `make` and include it directly in the existing GitHub artifact.

**Non-Goals:** Replace Squirrel, change its native dialog, create a nested diagnostic ZIP, or alter macOS/package-only builds.

## Decisions

1. `desktop-make.mjs` invokes a dedicated generator only after a successful Windows x64 `make`. The generator requires the expected Setup.exe and writes a versioned `.cmd` file beside it. A missing installer is a build failure.
2. Keep the launcher template as an ASCII file in `scripts/`, replacing version and Squirrel install directory at generation time. The generated name is `<product>-<version>-diagnostic-install.cmd`. At runtime the batch file derives the exact Setup.exe name from its own filename, so no Chinese text needs to be embedded in the ASCII batch source and it cannot choose another environment's installer. The command window explains that it runs the original installer. The launcher calls the system's built-in Windows PowerShell 5.1 by absolute path for reading log tails and displaying a second dialog; it prints the same details in its command window. The Windows workflow checks that the generated batch file executes under CMD and that Windows Forms is available before packaging.
3. The launcher detects both known Squirrel log names under `%LOCALAPPDATA%\SquirrelTemp`, selects the newest, and displays its modification time so stale logs are visible. It checks `%LOCALAPPDATA%\<squirrelName>\app-<version>`. It does not delete or modify installation state.
4. The workflow uploads `*.cmd` in addition to the existing `*.exe`, `*.nupkg`, and `RELEASES` patterns. `oss-uploader.mjs` remains unchanged because its Squirrel feed collector intentionally selects only feed files; the diagnostic script is present in the GitHub release artifact from which the customer package is assembled.

## Risks / Trade-offs

- [PowerShell or Windows Forms blocked by enterprise policy] → The command window remains open and shows the exit code, log directory and app folder state; the launcher reports that the GUI diagnostic failed.
- [Squirrel log is missing or from an older attempt] → Show an explicit missing-log message or the log modification time, rather than implying it belongs to the current attempt.
- [Customer launches Setup.exe directly] → The diagnostic script is plainly named and placed beside Setup.exe; ordinary installation continues to work, while support instructions direct customers to the script when diagnosing a failure.

## Migration Plan

Run the existing manually dispatched Windows workflow. New build artifacts include the diagnostic script alongside the existing three Squirrel files. Existing installers and update-feed files remain usable, and reverting the generation hook and upload glob removes the script without a client migration.
