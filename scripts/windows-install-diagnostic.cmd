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
>> "%DIAG_LOG%" echo Windows user:
whoami /user >> "%DIAG_LOG%" 2>&1
>> "%DIAG_LOG%" echo LocalAppData: "%LOCALAPPDATA%"
>> "%DIAG_LOG%" echo LocalAppData permissions:
icacls "%LOCALAPPDATA%" >> "%DIAG_LOG%" 2>&1
echo This diagnostic launcher checks permissions and saves installation or app startup details.
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
if not defined SETUP goto find_app
>> "%DIAG_LOG%" echo Setup executable: "%SETUP%"
for %%F in ("%SETUP%") do >> "%DIAG_LOG%" echo Setup size: %%~zF bytes; modified: %%~tF
>> "%DIAG_LOG%" echo Setup executable permissions:
icacls "%SETUP%" >> "%DIAG_LOG%" 2>&1
if exist "%APP_FOLDER%" (
  >> "%DIAG_LOG%" echo App folder existed before install: True
) else (
  >> "%DIAG_LOG%" echo App folder existed before install: False
)
for %%F in ("%SQUIRREL_DIR%\SquirrelSetup.log" "%SQUIRREL_DIR%\Squirrel-Install.log") do if exist "%%~fF" >> "%DIAG_LOG%" echo Existing Squirrel log before install: "%%~fF"; modified: %%~tF; size: %%~zF bytes
echo Setup executable: "%SETUP%"
echo Starting the release installer. Close its result dialog before the diagnostic appears.
rem Child processes can retain redirected log handles and prevent later log writes.
start "" /wait "%SETUP%"
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
if exist "%APP_FOLDER%" (
  goto installed_app_check
)
goto collect_squirrel
:installed_app_check
>> "%DIAG_LOG%" echo ----- Installed app folder d3dcompiler_47.dll check -----
>> "%DIAG_LOG%" echo Directory: "%APP_FOLDER%"
icacls "%APP_FOLDER%" >> "%DIAG_LOG%" 2>&1
set "DLL_FILE=%APP_FOLDER%\d3dcompiler_47.dll"
>> "%DIAG_LOG%" echo Exact DLL path: "%DLL_FILE%"
if not exist "%DLL_FILE%" goto installed_dll_missing
>> "%DIAG_LOG%" echo Exact DLL exists: True
>> "%DIAG_LOG%" echo Exact DLL permissions:
icacls "%DLL_FILE%" >> "%DIAG_LOG%" 2>&1
>> "%DIAG_LOG%" echo Exact DLL attributes:
attrib "%DLL_FILE%" >> "%DIAG_LOG%" 2>&1
copy /b "%DLL_FILE%" nul > nul 2>> "%DIAG_LOG%"
>> "%DIAG_LOG%" echo Exact DLL read result code: %ERRORLEVEL%
>> "%DIAG_LOG%" echo Existing DLL was not modified.
goto collect_squirrel
:installed_dll_missing
>> "%DIAG_LOG%" echo Exact DLL exists: False; there is no file ACL to inspect.
set "PROBE_FILE=%APP_FOLDER%\install-diagnostic-write-probe-%RANDOM%-%RANDOM%.tmp"
if exist "%PROBE_FILE%" goto collect_squirrel
copy /b "%~f0" "%PROBE_FILE%" >> "%DIAG_LOG%" 2>&1
set "PROBE_EXIT=%ERRORLEVEL%"
>> "%DIAG_LOG%" echo Directory write probe result code: %PROBE_EXIT%
if exist "%PROBE_FILE%" del /f /q "%PROBE_FILE%" >> "%DIAG_LOG%" 2>&1
if exist "%PROBE_FILE%" >> "%DIAG_LOG%" echo Write probe file remains: "%PROBE_FILE%"
>> "%DIAG_LOG%" echo A successful temporary-file write does not prove Squirrel can write the real DLL or that security software will allow it.
:collect_squirrel
>> "%DIAG_LOG%" echo Check each Squirrel log modified time against Started; it may predate this installer attempt.
set "SQUIRREL_FOUND="
for %%F in ("%SQUIRREL_DIR%\SquirrelSetup.log" "%SQUIRREL_DIR%\Squirrel-Install.log") do if exist "%%~fF" (
  set "SQUIRREL_FOUND=1"
  >> "%DIAG_LOG%" echo Squirrel log, possibly from an earlier run: "%%~fF"; modified: %%~tF; size: %%~zF bytes
  >> "%DIAG_LOG%" echo ----- Squirrel log content begins -----
  type "%%~fF" >> "%DIAG_LOG%" 2>&1
  >> "%DIAG_LOG%" echo ----- Squirrel log content ends -----
)
if not defined SQUIRREL_FOUND >> "%DIAG_LOG%" echo No Squirrel log was found in "%SQUIRREL_DIR%".
goto security_events
:find_app
set "APP_EXE="
set "MULTIPLE_APP="
for %%F in ("%~dp0*.exe") do if exist "%%~fF" if /I not "%%~nxF"=="squirrel.exe" if /I not "%%~nxF"=="Update.exe" (
  if defined APP_EXE (
    set "MULTIPLE_APP=1"
  ) else (
    set "APP_EXE=%%~fF"
  )
)
if defined MULTIPLE_APP goto multiple_app
if not defined APP_EXE goto setup_missing
>> "%DIAG_LOG%" echo No setup executable found; checking the portable app instead.
>> "%DIAG_LOG%" echo App executable: "%APP_EXE%"
for %%F in ("%APP_EXE%") do >> "%DIAG_LOG%" echo App size: %%~zF bytes; modified: %%~tF
>> "%DIAG_LOG%" echo App executable permissions:
icacls "%APP_EXE%" >> "%DIAG_LOG%" 2>&1
>> "%DIAG_LOG%" echo ----- Portable app folder d3dcompiler_47.dll check -----
>> "%DIAG_LOG%" echo Directory: "%~dp0."
icacls "%~dp0." >> "%DIAG_LOG%" 2>&1
set "DLL_FILE=%~dp0d3dcompiler_47.dll"
>> "%DIAG_LOG%" echo Exact DLL path: "%DLL_FILE%"
if not exist "%DLL_FILE%" goto portable_dll_missing
>> "%DIAG_LOG%" echo Exact DLL exists: True
for %%F in ("%DLL_FILE%") do >> "%DIAG_LOG%" echo Exact DLL size: %%~zF bytes; modified: %%~tF
>> "%DIAG_LOG%" echo Exact DLL permissions:
icacls "%DLL_FILE%" >> "%DIAG_LOG%" 2>&1
>> "%DIAG_LOG%" echo Exact DLL attributes:
attrib "%DLL_FILE%" >> "%DIAG_LOG%" 2>&1
copy /b "%DLL_FILE%" nul > nul 2>> "%DIAG_LOG%"
>> "%DIAG_LOG%" echo Exact DLL read result code: %ERRORLEVEL%
>> "%DIAG_LOG%" echo Existing DLL was not modified.
goto launch_portable
:portable_dll_missing
>> "%DIAG_LOG%" echo Exact DLL exists: False; there is no file ACL to inspect.
:launch_portable
echo Starting the portable app once to check whether Windows permits process creation.
>> "%DIAG_LOG%" echo App launch command started.
rem Keep the log handle out of the child process; show START errors in the console.
start "" "%APP_EXE%"
set "RESULT_EXIT=%ERRORLEVEL%"
>> "%DIAG_LOG%" echo App launch command exit code: %RESULT_EXIT%
>> "%DIAG_LOG%" echo A zero launch code does not prove that the app window or renderer started.
goto security_events
:multiple_app
>> "%DIAG_LOG%" echo Multiple app executables were found; no executable was launched.
set "RESULT_EXIT=4"
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
:security_events
>> "%DIAG_LOG%" echo ----- Windows security block events from the last 15 minutes -----
>> "%DIAG_LOG%" echo Defender ASR and controlled-folder-access blocks:
wevtutil qe "Microsoft-Windows-Windows Defender/Operational" /q:"*[System[(EventID=1121 or EventID=1123) and TimeCreated[timediff(@SystemTime) <= 900000]]]" /rd:true /c:8 /f:text >> "%DIAG_LOG%" 2>&1
>> "%DIAG_LOG%" echo Code Integrity blocks:
wevtutil qe "Microsoft-Windows-CodeIntegrity/Operational" /q:"*[System[(EventID=3033 or EventID=3077) and TimeCreated[timediff(@SystemTime) <= 900000]]]" /rd:true /c:8 /f:text >> "%DIAG_LOG%" 2>&1
>> "%DIAG_LOG%" echo AppLocker executable and DLL blocks:
wevtutil qe "Microsoft-Windows-AppLocker/EXE and DLL" /q:"*[System[(EventID=8004) and TimeCreated[timediff(@SystemTime) <= 900000]]]" /rd:true /c:8 /f:text >> "%DIAG_LOG%" 2>&1
>> "%DIAG_LOG%" echo Other security products may block access without writing to these Windows logs.
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
