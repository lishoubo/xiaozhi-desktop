# desktop-windows-diagnostic-release Specification

## Purpose

Provide a repeatable support artifact for Windows installation failures so a customer can capture the installation result without locating or sending a log file.

## Requirements

### Requirement: Windows release includes a diagnostic installer

A successful Windows x64 release build SHALL produce a versioned diagnostic command script in the same release directory as the ordinary Setup.exe, `.nupkg`, and `RELEASES` files. It SHALL run the unchanged Setup.exe from that directory. A macOS build or package-only build SHALL NOT require this script.

#### Scenario: Windows release build succeeds
- **WHEN** the normal Windows x64 `make` command completes
- **THEN** the diagnostic script is beside Setup.exe and included directly in the GitHub Actions Windows build artifact

#### Scenario: Setup.exe is missing
- **WHEN** the Windows build does not produce the expected Setup.exe
- **THEN** diagnostic packaging fails the build rather than silently omitting the support artifact

### Requirement: Diagnostic launch exposes setup results

The diagnostic entrypoint SHALL run the bundled Setup.exe and, after it closes, present its exit code, whether the target application version directory exists, and the latest available Squirrel installation log excerpt. On Windows 10 and 11, it SHALL require no separately installed runtime. It SHALL retain a readable command window fallback if a graphical diagnostic dialog cannot open. It SHALL not change the Setup.exe or the Squirrel update feed.

#### Scenario: Installer fails with a Squirrel log
- **WHEN** Setup.exe exits and a Squirrel installation log is available
- **THEN** a support user can capture the recent log lines and installation state in a screenshot

#### Scenario: Installer fails without a log
- **WHEN** Setup.exe exits and no Squirrel installation log is available
- **THEN** the diagnostic result explicitly reports that no log was found and still shows the exit code and installation state

#### Scenario: Other installers are present
- **WHEN** the diagnostic script runs beside Setup.exe files for multiple environments
- **THEN** it launches only the Setup.exe matching its own product name

#### Scenario: Graphical diagnostic is blocked
- **WHEN** PowerShell or Windows Forms cannot display the diagnostic popup
- **THEN** the installer still runs and the command window remains open with the exit code and locations to inspect
