# desktop-windows-diagnostic-release Specification

## Purpose

Provide a repeatable support artifact for Windows installations so a customer can send a diagnostic log after either a successful or failed setup attempt.

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

The diagnostic entrypoint SHALL create or replace a versioned diagnostic log beside the command script at the start of every run, falling back to the temporary directory if that location is not writable. It SHALL verify that the file was created before reporting its path. It SHALL find the sole Setup.exe in the command script's directory independently of the script's filename, run it, and record its path and exit code, whether the target application version directory exists, and the latest available Squirrel installation log excerpt in that file. It SHALL print the saved diagnostic content in its command window on success and failure and wait for a key press before exiting. On Windows 10 and 11, it SHALL require no separately installed runtime. It SHALL not change the Setup.exe or the Squirrel update feed.

#### Scenario: Installer succeeds
- **WHEN** Setup.exe exits successfully
- **THEN** a new diagnostic log remains beside the command script with the exit code and installation state

#### Scenario: Installer is missing at runtime
- **WHEN** a user runs the diagnostic command without the matching Setup.exe beside it
- **THEN** the diagnostic log and command window show that Setup.exe was missing and list the files beside the script before waiting for a key press

#### Scenario: Installer fails with a Squirrel log
- **WHEN** Setup.exe exits and a Squirrel installation log is available
- **THEN** a support user can send the diagnostic log containing recent Squirrel lines and installation state

#### Scenario: Installer fails without a log
- **WHEN** Setup.exe exits and no Squirrel installation log is available
- **THEN** the diagnostic file explicitly reports that no Squirrel log was found and still records the exit code and installation state

#### Scenario: Multiple installers are present
- **WHEN** the diagnostic script runs beside multiple Setup.exe files
- **THEN** it records the ambiguity and does not launch any installer

#### Scenario: Diagnostic log cannot be found after collection
- **WHEN** the diagnostic file disappears before its content can be displayed
- **THEN** the command window explicitly reports the missing file and still waits for a key press
