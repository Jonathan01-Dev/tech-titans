Write-Host "ARCHIPEL - Setup Wi-Fi Direct"
Write-Host "=============================="

$isAdmin = ([Security.Principal.WindowsPrincipal]
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "ERREUR: Lance en mode Administrateur !"
  Write-Host "Clic droit PowerShell - Executer en admin"
  exit 1
}

Write-Host "Configuration Wi-Fi Direct..."
netsh wlan set hostednetwork mode=allow ssid=Archipel key=archipel2026

Write-Host "Demarrage du point d'acces virtuel..."
netsh wlan start hostednetwork

Write-Host "Configuration pare-feu..."
netsh advfirewall firewall add rule name="Archipel UDP 6000" protocol=UDP dir=in action=allow localport=6000
netsh advfirewall firewall add rule name="Archipel TCP 7777" protocol=TCP dir=in action=allow localport=7777
netsh advfirewall firewall add rule name="Archipel WEB 8080" protocol=TCP dir=in action=allow localport=8080

Write-Host ""
Write-Host "=============================="
Write-Host "Wi-Fi Direct actif !" -ForegroundColor Green
Write-Host "SSID     : Archipel"
Write-Host "Password : archipel2026"
Write-Host ""
Write-Host "Sur PC B : connecte-toi au WiFi 'Archipel'"
Write-Host "puis lance : npx.cmd ts-node --esm src/cli/index.ts"
Write-Host ""

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like "192.168.137.*" } |
  Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host "IP de ce PC : $ip" -ForegroundColor Yellow
Write-Host "Interface web: http://${ip}:8080"
