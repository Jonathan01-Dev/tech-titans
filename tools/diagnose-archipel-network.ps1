param(
  [string[]]$PeerIps = @(),
  [int[]]$TcpPorts = @(7777, 7778, 7779),
  [int[]]$WebPorts = @(8080, 8081, 8082, 8083)
)

$ErrorActionPreference = "SilentlyContinue"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host ("=" * 12 + " " + $Title + " " + ("=" * 12))
}

function Test-TcpPort {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$TimeoutMs = 1200
  )
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $ar = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $ar.AsyncWaitHandle.WaitOne($TimeoutMs)
    if ($ok -and $client.Connected) {
      return "OPEN"
    }
    return "CLOSED/TIMEOUT"
  } catch {
    return "ERROR"
  } finally {
    $client.Close()
  }
}

function Parse-NetstatListening {
  $lines = netstat -ano -p tcp | Select-String "LISTENING"
  $items = @()
  foreach ($line in $lines) {
    $text = ($line.ToString() -replace "\s+", " ").Trim()
    if (-not $text.StartsWith("TCP ")) { continue }
    $parts = $text.Split(" ")
    if ($parts.Count -lt 5) { continue }
    $local = $parts[1]
    $pid = $parts[4]
    $port = 0
    if ($local -match ":(\d+)$") {
      $port = [int]$Matches[1]
    }
    if ($port -gt 0) {
      $items += [pscustomobject]@{
        Local = $local
        Port = $port
        Pid = $pid
      }
    }
  }
  return $items
}

Write-Section "HOST"
Write-Host ("ComputerName : " + $env:COMPUTERNAME)
Write-Host ("User         : " + $env:USERNAME)

Write-Section "IPV4"
$ipv4 = ipconfig | Select-String "IPv4|Adresse IPv4"
if ($ipv4) {
  $ipv4 | ForEach-Object { Write-Host $_.ToString().Trim() }
} else {
  Write-Host "No IPv4 found via ipconfig."
}

Write-Section "NODE PROCESSES"
$nodeProcs = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcs) {
  $nodeProcs | Select-Object Id, ProcessName, Path | Format-Table -AutoSize
} else {
  Write-Host "No node.exe process found."
}

Write-Section "TCP LISTENING"
$listening = Parse-NetstatListening
$watchPorts = @($TcpPorts + $WebPorts) | Sort-Object -Unique
foreach ($port in $watchPorts) {
  $entries = $listening | Where-Object { $_.Port -eq $port }
  if ($entries.Count -eq 0) {
    Write-Host ("Port {0}: NOT LISTENING" -f $port)
  } else {
    foreach ($e in $entries) {
      Write-Host ("Port {0}: LISTENING pid={1} local={2}" -f $port, $e.Pid, $e.Local)
    }
  }
}

Write-Section "LOCAL TCP TESTS"
foreach ($port in $TcpPorts) {
  $state = Test-TcpPort -HostName "127.0.0.1" -Port $port
  Write-Host ("127.0.0.1:{0} => {1}" -f $port, $state)
}

if ($PeerIps.Count -gt 0) {
  Write-Section "PEER TCP TESTS"
  foreach ($ip in $PeerIps) {
    foreach ($port in $TcpPorts) {
      $state = Test-TcpPort -HostName $ip -Port $port
      Write-Host ("{0}:{1} => {2}" -f $ip, $port, $state)
    }
  }
} else {
  Write-Section "PEER TCP TESTS"
  Write-Host "No peer IP passed. Use: -PeerIps 192.168.43.65,192.168.43.66"
}

Write-Section "IDENTITY"
$identityPath = Join-Path (Get-Location) ".archipel\identity.json"
if (Test-Path $identityPath) {
  try {
    $obj = Get-Content $identityPath -Raw | ConvertFrom-Json
    $nodeId = [string]$obj.nodeId
    Write-Host ("identity.json: FOUND ({0})" -f $identityPath)
    if ($nodeId.Length -ge 16) {
      Write-Host ("NodeId: " + $nodeId.Substring(0,16) + "...")
    } else {
      Write-Host ("NodeId: " + $nodeId)
    }
  } catch {
    Write-Host "identity.json exists but cannot be parsed."
  }
} else {
  Write-Host "identity.json not found (will be generated on next start)."
}

Write-Section "DONE"
Write-Host "If peer tests are CLOSED/TIMEOUT, check: node running, correct TCP port, firewall private rule for node.exe."
