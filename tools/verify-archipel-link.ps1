param(
  [Parameter(Mandatory = $true)]
  [string]$PeerIp,
  [string]$InterfaceAlias = "Wi-Fi",
  [int]$PeerTcpPort = 7777
)

$ErrorActionPreference = "Stop"

$iface = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias $InterfaceAlias |
  Where-Object { $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1

if (-not $iface) {
  throw "Aucune IPv4 valide trouvee sur l'interface '$InterfaceAlias'."
}

$profile = Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -eq $InterfaceAlias } | Select-Object -First 1
$ping = Test-Connection -ComputerName $PeerIp -Count 2 -Quiet
$tcp = Test-NetConnection -ComputerName $PeerIp -Port $PeerTcpPort -WarningAction SilentlyContinue

Write-Host "=== ARCHIPEL LINK VERIFY ==="
Write-Host "Local IP      : $($iface.IPAddress)"
Write-Host "Interface     : $InterfaceAlias"
Write-Host "Profil        : $($profile.NetworkCategory)"
Write-Host "Peer IP       : $PeerIp"
Write-Host "Ping OK       : $ping"
Write-Host "TCP $PeerTcpPort OK  : $($tcp.TcpTestSucceeded)"

if (-not $ping -and -not $tcp.TcpTestSucceeded) {
  Write-Host "Diagnostic: lien reseau inter-PC probablement bloque (routeur/isolation/firewall)."
}

