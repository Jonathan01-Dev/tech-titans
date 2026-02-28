@echo off
setlocal

set "ROOT=%~dp0.."
cd /d "%ROOT%"

if "%TCP_PORT%"=="" set "TCP_PORT=7777"
if "%WEB_PORT%"=="" set "WEB_PORT=8080"

start "" "http://localhost:%WEB_PORT%"
npx.cmd ts-node --esm src/cli/index.ts --port %TCP_PORT% --web-port %WEB_PORT%

