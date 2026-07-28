@echo off
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo First run: installing Electron...
  call npm install || goto :error
  if not exist node_modules\electron\dist\electron.exe (
    call npm run setup-electron || goto :error
  )
)
start "" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b 0

:error
echo.
echo samDub could not finish installing.
pause
exit /b 1
