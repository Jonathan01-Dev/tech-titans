param(
  [string]$InterfaceAlias = "Wi-Fi",
  [string]$TcpPortsCsv = "7777,7778"
)

$ErrorActionPreference = "Stop"

$TcpPorts = @(
  $TcpPortsCsv.Split(',') |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -match '^\d+$' } |
  ForEach-Object { [int]$_ }
)

if ($TcpPorts.Count -eq 0) {
  throw "Aucun port TCP valide dans TcpPortsCsv."
}

function Ensure-Rule {
  param(
    [string]$Name,
    [string]$Direction,
    [string]$Protocol,
    [string]$Ports = "",
    [string]$Program = ""
  )

  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Set-NetFirewallRule -DisplayName $Name -Enabled True -Action Allow -Profile Any | Out-Null
    return
  }

  if ($Program -ne "") {
    New-NetFirewallRule -DisplayName $Name -Direction $Direction -Program $Program -Action Allow -Profile Any | Out-Null
    return
  }

  if ($Protocol -eq "ICMPv4") {
    New-NetFirewallRule -DisplayName $Name -Direction $Direction -Protocol ICMPv4 -IcmpType 8 -Action Allow -Profile Any | Out-Null
    return
  }

  if (($Protocol -eq "TCP" -or $Protocol -eq "UDP") -and [string]::IsNullOrWhiteSpace($Ports)) {
    throw "Port manquant pour la regle '$Name' ($Protocol)."
  }

  if ($Protocol -eq "TCP" -or $Protocol -eq "UDP") {
    New-NetFirewallRule -DisplayName $Name -Direction $Direction -Protocol $Protocol -LocalPort $Ports -Action Allow -Profile Any | Out-Null
    return
  }

  New-NetFirewallRule -DisplayName $Name -Direction $Direction -Protocol $Protocol -Action Allow -Profile Any | Out-Null
}

$iface = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias $InterfaceAlias |
  Where-Object { $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1

if (-not $iface) {
  throw "Aucune IPv4 valide trouvee sur l'interface '$InterfaceAlias'."
}

Set-NetConnectionProfile -InterfaceIndex $iface.InterfaceIndex -NetworkCategory Private

Ensure-Rule -Name "Archipel ICMPv4 In Any" -Direction Inbound -Protocol ICMPv4
Ensure-Rule -Name "Archipel UDP 6000 In Any" -Direction Inbound -Protocol UDP -Ports "6000"
Ensure-Rule -Name "Archipel UDP 6000 Out Any" -Direction Outbound -Protocol UDP -Ports "6000"

foreach ($port in $TcpPorts) {
  Ensure-Rule -Name "Archipel TCP $port In Any" -Direction Inbound -Protocol TCP -Ports "$port"
  Ensure-Rule -Name "Archipel TCP $port Out Any" -Direction Outbound -Protocol TCP -Ports "$port"
}

Ensure-Rule -Name "Archipel Node In Any" -Direction Inbound -Protocol TCP -Program "C:\Program Files\nodejs\node.exe"
Ensure-Rule -Name "Archipel Node Out Any" -Direction Outbound -Protocol TCP -Program "C:\Program Files\nodejs\node.exe"

$profile = Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -eq $InterfaceAlias } | Select-Object -First 1

Write-Host "=== ARCHIPEL LINK SETUP ==="
Write-Host "Interface : $InterfaceAlias"
Write-Host "IPv4      : $($iface.IPAddress)"
Write-Host "IfIndex   : $($iface.InterfaceIndex)"
Write-Host "Profil    : $($profile.NetworkCategory)"
Write-Host "TCP Ports : $($TcpPorts -join ', ')"
Write-Host "Regles    : OK (Any)"
