Write-Host "ARCHIPEL - Demo Jury" -ForegroundColor Blue

$root = "C:\Users\DELL\Desktop\archipel"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; `$env:TCP_PORT='7777'; `$env:WEB_PORT='8080'; npx.cmd ts-node --esm src/cli/index.ts"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; `$env:TCP_PORT='7778'; `$env:WEB_PORT='8081'; npx.cmd ts-node --esm src/cli/index.ts"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; `$env:TCP_PORT='7779'; `$env:WEB_PORT='8082'; npx.cmd ts-node --esm src/cli/index.ts"

Write-Host ""
Write-Host "Noeud A: http://localhost:8080"
Write-Host "Noeud B: http://localhost:8081"
Write-Host "Noeud C: http://localhost:8082"
