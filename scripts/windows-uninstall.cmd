@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "UNINSTALLER=%LOCALAPPDATA%\__SQUIRREL_NAME__\Update.exe"
if not exist "%UNINSTALLER%" (
  echo This Windows user does not have this application installed.
  echo Expected Squirrel uninstaller: "%UNINSTALLER%"
  pause
  exit /b 2
)
echo This removes the application installation for the current Windows user.
echo Application data, login state, and logs will be kept.
choice /C YN /M "Continue with uninstall"
set "ANSWER=%ERRORLEVEL%"
if "%ANSWER%"=="2" exit /b 0
if not "%ANSWER%"=="1" exit /b %ANSWER%
start "" /wait "%UNINSTALLER%" --uninstall
set "RESULT=%ERRORLEVEL%"
echo Squirrel uninstaller exit code: %RESULT%
pause
exit /b %RESULT%
