@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "TARGET_VERSION=__APP_VERSION__"
set "SQUIRREL_NAME=__SQUIRREL_NAME__"
set "PRODUCT=%~n0"
set "PRODUCT=%PRODUCT:-__APP_VERSION__-diagnostic-install=%"
set "SETUP=%~dp0%PRODUCT%-setup.exe"
echo This diagnostic launcher runs the original installer and then shows installation details.
if not exist "%SETUP%" (
  echo Setup executable was not found beside this diagnostic launcher.
  pause
  exit /b 2
)
echo Starting the original installer. Close its result dialog before the diagnostic appears.
start "" /wait "%SETUP%"
set "INSTALL_EXIT=%ERRORLEVEL%"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$root=Join-Path $env:LOCALAPPDATA 'SquirrelTemp'; $files=@('SquirrelSetup.log','Squirrel-Install.log') | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path -LiteralPath $_ }; $log=$files | Sort-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } -Descending | Select-Object -First 1; $tail=if($log){ (Get-Content -LiteralPath $log -Tail 16 -ErrorAction SilentlyContinue) -join [Environment]::NewLine } else { 'No Squirrel log was found.' }; $stamp=if($log){ (Get-Item -LiteralPath $log).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'none' }; $folder=Join-Path (Join-Path $env:LOCALAPPDATA $env:SQUIRREL_NAME) ('app-'+$env:TARGET_VERSION); $installed=Test-Path -LiteralPath $folder; $message='Installer exit code: '+$env:INSTALL_EXIT+[Environment]::NewLine+'App folder exists: '+$installed+[Environment]::NewLine+'Log updated: '+$stamp+[Environment]::NewLine+'Log: '+$log+[Environment]::NewLine+[Environment]::NewLine+$tail; Write-Output $message; Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop; [void][System.Windows.Forms.MessageBox]::Show($message,'Installation diagnostic')"
if errorlevel 1 (
  echo Could not display the diagnostic popup. Installer exit code: %INSTALL_EXIT%.
  echo Check logs in "%LOCALAPPDATA%\SquirrelTemp".
  if exist "%LOCALAPPDATA%\%SQUIRREL_NAME%\app-%TARGET_VERSION%" (
    echo App version folder exists.
  ) else (
    echo App version folder does not exist.
  )
)
echo Take a screenshot of the diagnostic popup or this window for support. Hide your Windows username if needed.
pause
