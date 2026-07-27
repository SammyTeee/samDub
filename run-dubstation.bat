@echo off
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo First run: installing Electron...
  call npm install
)
call npm start
