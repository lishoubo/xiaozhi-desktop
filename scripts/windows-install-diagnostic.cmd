@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "TARGET_VERSION=__APP_VERSION__"
set "SQUIRREL_NAME=__SQUIRREL_NAME__"
set "APP_FOLDER=%LOCALAPPDATA%\%SQUIRREL_NAME%\app-%TARGET_VERSION%"
set "SQUIRREL_DIR=%LOCALAPPDATA%\SquirrelTemp"
set "DIAG_LOG=%~dp0install-diagnostic-__APP_VERSION__.log"
> "%DIAG_LOG%" echo Installation diagnostic for version %TARGET_VERSION%
if errorlevel 1 goto log_fallback
if not exist "%DIAG_LOG%" goto log_fallback
goto log_ready
:log_fallback
set "DIAG_LOG=%TEMP%\install-diagnostic-__APP_VERSION__.log"
> "%DIAG_LOG%" echo Installation diagnostic for version %TARGET_VERSION%
if errorlevel 1 (
  echo Could not create a diagnostic log beside this script or in the temporary directory.
  pause
  exit /b 3
)
if not exist "%DIAG_LOG%" (
  echo Could not verify the diagnostic log in the temporary directory.
  pause
  exit /b 3
)
:log_ready
>> "%DIAG_LOG%" echo Started: %DATE% %TIME%
>> "%DIAG_LOG%" echo Script directory: "%~dp0"
echo This diagnostic launcher runs the original installer and saves installation details.
set "RESULT_EXIT=0"
set "SETUP="
set "MULTIPLE_SETUP="
for %%F in ("%~dp0*-setup.exe") do if exist "%%~fF" (
  if defined SETUP (
    set "MULTIPLE_SETUP=1"
  ) else (
    set "SETUP=%%~fF"
  )
)
if defined MULTIPLE_SETUP goto multiple_setup
if not defined SETUP goto setup_missing
>> "%DIAG_LOG%" echo Setup executable: "%SETUP%"
for %%F in ("%SETUP%") do >> "%DIAG_LOG%" echo Setup size: %%~zF bytes; modified: %%~tF
if exist "%APP_FOLDER%" (
  >> "%DIAG_LOG%" echo App folder existed before install: True
) else (
  >> "%DIAG_LOG%" echo App folder existed before install: False
)
for %%F in ("%SQUIRREL_DIR%\SquirrelSetup.log" "%SQUIRREL_DIR%\Squirrel-Install.log") do if exist "%%~fF" >> "%DIAG_LOG%" echo Existing Squirrel log before install: "%%~fF"; modified: %%~tF; size: %%~zF bytes
echo Setup executable: "%SETUP%"
echo Starting the original installer. Close its result dialog before the diagnostic appears.
start "" /wait "%SETUP%" >> "%DIAG_LOG%" 2>&1
set "INSTALL_EXIT=%ERRORLEVEL%"
set "RESULT_EXIT=%INSTALL_EXIT%"
>> "%DIAG_LOG%" echo Installer exit code: %INSTALL_EXIT%
if "%INSTALL_EXIT%"=="5" >> "%DIAG_LOG%" echo Exit code 5 can mean access denied; the installer may also return 5 itself.
>> "%DIAG_LOG%" echo Expected app folder: "%APP_FOLDER%"
if exist "%APP_FOLDER%" (
  >> "%DIAG_LOG%" echo App folder exists: True
) else (
  >> "%DIAG_LOG%" echo App folder exists: False
)
set "SQUIRREL_FOUND="
for %%F in ("%SQUIRREL_DIR%\SquirrelSetup.log" "%SQUIRREL_DIR%\Squirrel-Install.log") do if exist "%%~fF" (
  set "SQUIRREL_FOUND=1"
  >> "%DIAG_LOG%" echo Squirrel log: "%%~fF"; modified: %%~tF; size: %%~zF bytes
  >> "%DIAG_LOG%" echo ----- Squirrel log content begins -----
  type "%%~fF" >> "%DIAG_LOG%" 2>&1
  >> "%DIAG_LOG%" echo ----- Squirrel log content ends -----
)
if not defined SQUIRREL_FOUND >> "%DIAG_LOG%" echo No Squirrel log was found in "%SQUIRREL_DIR%".
goto diagnostic_done
:multiple_setup
>> "%DIAG_LOG%" echo Multiple setup executables were found beside this diagnostic launcher.
set "RESULT_EXIT=4"
goto diagnostic_done
:setup_missing
>> "%DIAG_LOG%" echo Setup executable was not found beside this diagnostic launcher.
>> "%DIAG_LOG%" echo Extract the entire ZIP before running this script; opening a CMD inside the ZIP extracts only that file.
>> "%DIAG_LOG%" echo Files beside this diagnostic launcher:
dir /b /a-d "%~dp0" >> "%DIAG_LOG%" 2>&1
set "RESULT_EXIT=2"
goto diagnostic_done
:diagnostic_done
echo.
echo ===== Installation diagnostic result =====
if exist "%DIAG_LOG%" (
  type "%DIAG_LOG%"
) else (
  echo Diagnostic log could not be found at "%DIAG_LOG%".
)
echo ===== End of diagnostic result =====
echo Diagnostic log: "%DIAG_LOG%"
echo Send the diagnostic log to support after checking it for your Windows username.
pause
exit /b %RESULT_EXIT%
