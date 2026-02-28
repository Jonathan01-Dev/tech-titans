param(
  [ValidateRange(1, 20)]
  [int]$Role = 1,
  [ValidateRange(1, 65535)]
  [int]$TcpBase = 7777,
  [ValidateRange(1, 65535)]
  [int]$WebPort = 8081,
  [switch]$ResetIdentity,
  [switch]$NoStart,
  [switch]$NoFirewall
)

$ErrorActionPreference = "SilentlyContinue"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host ("=" * 12 + " " + $Title + " " + ("=" * 12))
}

function Is-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ListeningPidsForPorts {
  param([int[]]$Ports)
  $lines = netstat -ano -p tcp | Select-String "LISTENING"
  $pids = New-Object System.Collections.Generic.HashSet[int]
  foreach ($line in $lines) {
    $text = ($line.ToString() -replace "\s+", " ").Trim()
    if (-not $text.StartsWith("TCP ")) { continue }
    $parts = $text.Split(" ")
    if ($parts.Count -lt 5) { continue }
    $local = $parts[1]
    $pidRaw = $parts[4]
    if ($local -notmatch ":(\d+)$") { continue }
    $port = [int]$Matches[1]
    if ($Ports -contains $port) {
      $pid = 0
      if ([int]::TryParse($pidRaw, [ref]$pid)) {
        $null = $pids.Add($pid)
      }
    }
  }
  return @($pids)
}

function Ensure-FirewallRule {
  param(
    [string]$Name,
    [string]$Protocol,
    [string]$Ports
  )
  $exists = netsh advfirewall firewall show rule name="$Name" | Select-String "Rule Name"
  if (-not $exists) {
    netsh advfirewall firewall add rule name="$Name" dir=in action=allow profile=private protocol=$Protocol localport=$Ports
    Write-Host ("Added firewall rule: " + $Name)
  } else {
    Write-Host ("Firewall rule already exists: " + $Name)
  }
}

$tcpPort = $TcpBase + ($Role - 1)
$portsToFree = @($TcpBase..($TcpBase + 10) + $WebPort..($WebPort + 3)) | Sort-Object -Unique

Write-Section "TARGET CONFIG"
Write-Host ("Role    : " + $Role)
Write-Host ("TCP Port: " + $tcpPort)
Write-Host ("WEB Port: " + $WebPort)

Write-Section "STOP CONFLICTING LISTENERS"
$pids = Get-ListeningPidsForPorts -Ports $portsToFree
if ($pids.Count -eq 0) {
  Write-Host "No listener to stop on watched ports."
} else {
  foreach ($pid in $pids) {
    if ($pid -le 0 -or $pid -eq $PID) { continue }
    Write-Host ("Stopping PID " + $pid)
    taskkill /PID $pid /F | Out-Null
  }
}

if ($ResetIdentity) {
  Write-Section "RESET IDENTITY"
  $identityPath = Join-Path (Get-Location) ".archipel\identity.json"
  if (Test-Path $identityPath) {
    Remove-Item $identityPath -Force
    Write-Host ("Deleted " + $identityPath)
  } else {
    Write-Host "identity.json not found."
  }
}

Write-Section "FIREWALL"
if ($NoFirewall) {
  Write-Host "Skipped firewall setup (--NoFirewall)."
} else {
  if (-not (Is-Admin)) {
    Write-Host "Not running as Administrator. Firewall rules not changed."
    Write-Host "Run this script as admin once to auto-create rules."
  } else {
    Ensure-FirewallRule -Name "Archipel TCP 7777-7790" -Protocol "TCP" -Ports "7777-7790"
    Ensure-FirewallRule -Name "Archipel UDP Discovery 6000" -Protocol "UDP" -Ports "6000"
  }
}

if ($NoStart) {
  Write-Section "START"
  Write-Host "Start skipped (--NoStart)."
  Write-Host ("Manual command:")
  Write-Host ("npx.cmd ts-node --esm src/cli/index.ts --port {0} --web-port {1}" -f $tcpPort, $WebPort)
  exit 0
}

Write-Section "START NODE"
$env:TCP_PORT = [string]$tcpPort
$env:WEB_PORT = [string]$WebPort
Write-Host ("Launching Archipel on TCP {0}, WEB {1}" -f $tcpPort, $WebPort)
npx.cmd ts-node --esm src/cli/index.ts --port $tcpPort --web-port $WebPort
