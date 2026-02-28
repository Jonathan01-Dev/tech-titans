Write-Host "ARCHIPEL - Demo Jury" -ForegroundColor Blue
Write-Host "Mode: Wi-Fi Direct (Zero Infrastructure)"
Write-Host ""

Write-Host "Demarrage noeud local..."
$env:TCP_PORT = "7777"
$env:WEB_PORT = "8080"

Start-Process powershell -ArgumentList `
  "-NoExit", "-Command", `
  "cd '$PWD'; " + `
  "`$env:TCP_PORT='7777'; " + `
  "`$env:WEB_PORT='8080'; " + `
  "npx.cmd ts-node --esm src/cli/index.ts"

Start-Sleep 3

Write-Host ""
Write-Host "===========================" -ForegroundColor Yellow
Write-Host "SCENARIO DEMO JURY"
Write-Host "===========================" -ForegroundColor Yellow
Write-Host "1. PC A : http://localhost:8080"
Write-Host "2. PC B : http://192.168.137.1:8080"
Write-Host "3. Attendre 30s decouverte pairs"
Write-Host "4. Dashboard - voir PC B dans les pairs"
Write-Host "5. Messages - envoyer message chiffre"
Write-Host "6. Fichiers - transferer test-50mb.bin"
Write-Host "7. Montrer SHA-256 identiques"
Write-Host "==========================="

Start-Process "http://localhost:8080"
