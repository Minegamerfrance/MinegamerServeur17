[CmdletBinding()]
param(
    [string]$GamePath = "",
    [switch]$NoGameLaunch,
    [switch]$SafeGameLaunch,
    [switch]$LegitimateEA
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$SettingsPath = Join-Path $ProjectRoot 'launcher-settings.json'
$RuntimeRoot = Join-Path $ProjectRoot 'runtime'
$StatusPath = Join-Path $RuntimeRoot 'launcher-status.json'
$ProtocolStatusPath = Join-Path $RuntimeRoot 'status.json'
$PidPath = Join-Path $RuntimeRoot 'launcher-processes.json'
$SessionPath = Join-Path $RuntimeRoot 'session.json'
$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$DnsFallbackPath = Join-Path $ProjectRoot 'local_dns.py'
$DnsNrptComment = 'MNG FUT 20 local DNS fallback'
$RedirectLines = @(
    '127.0.0.1 spring18.gosredirector.ea.com',
    '127.0.0.1 utas.external.s2.fut.ea.com',
    '127.0.0.1 utas.external.s3.fut.ea.com',
    '127.0.0.1 utas.external.fut.ea.com',
    '127.0.0.1 utas.s2.fut.ea.com',
    '127.0.0.1 utas.s3.fut.ea.com',
    '127.0.0.1 utas.fut.ea.com',
    '127.0.0.1 fut.ea.com'
)
$LegacyIdentityRedirectLines = @(
    '127.0.0.1 accounts.ea.com',
    '127.0.0.1 gateway.ea.com',
    '127.0.0.1 origin-a.akamaihd.net',
    '127.0.0.1 eaassets-a.akamaihd.net',
    '127.0.0.1 auth.ea.com',
    '127.0.0.1 signin.ea.com'
)
$RedirectLine = $RedirectLines[0]


function Write-StatusLine([string]$Label, [string]$Value, [ConsoleColor]$Color = [ConsoleColor]::White) {
    Write-Host ('{0,-16} {1}' -f ($Label + ':'), $Value) -ForegroundColor $Color
}

function Save-Status([hashtable]$Status) {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    $Status.updatedAt = (Get-Date).ToString('o')
    $Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatusPath -Encoding utf8
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Listener([int]$Port) {
    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Wait-ForPort([int]$Port, [int]$TimeoutSeconds = 15) {
    $until = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Get-Listener $Port) { return $true }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $until)
    return $false
}

function Wait-ForUdpPort([int]$Port, [int]$TimeoutSeconds = 10) {
    $until = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Get-NetUDPEndpoint -LocalAddress '127.0.0.1' -LocalPort $Port -ErrorAction SilentlyContinue) { return $true }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $until)
    return $false
}

function Remove-MngDnsFallbackRules {
    Get-DnsClientNrptRule -ErrorAction SilentlyContinue |
        Where-Object { $_.Comment -eq $DnsNrptComment } |
        ForEach-Object { Remove-DnsClientNrptRule -Name $_.Name -Force -ErrorAction SilentlyContinue }
}

function Stop-OrphanedDnsFallback {
    $dnsPath = $DnsFallbackPath.ToLowerInvariant()
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('python.exe','pythonw.exe','py.exe','pyw.exe') } |
        ForEach-Object {
            $commandLine = [string]$_.CommandLine
            if ($commandLine -and $commandLine.ToLowerInvariant().Contains($dnsPath)) {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
}

function Start-MngDnsFallback([string]$PythonSource, [string[]]$RedirectHosts) {
    Stop-OrphanedDnsFallback
    Remove-MngDnsFallbackRules
    $existingUdp = @(Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue)
    $existingTcp = @(Get-NetTCPConnection -State Listen -LocalPort 53 -ErrorAction SilentlyContinue)
    if ($existingUdp -or $existingTcp) {
        throw 'Windows ignores the FIFA hosts redirects and local DNS port 53 is already occupied. Close the DNS filtering application using port 53, then try again.'
    }

    $dnsLog = Join-Path $RuntimeRoot 'dns-fallback.log'
    $dnsError = Join-Path $RuntimeRoot 'dns-fallback.error.log'
    $dnsProxy = Start-Process -FilePath $PythonSource -ArgumentList @('-3.13', ('"{0}"' -f $DnsFallbackPath)) -WorkingDirectory $ProjectRoot -RedirectStandardOutput $dnsLog -RedirectStandardError $dnsError -WindowStyle Hidden -PassThru
    if (-not (Wait-ForUdpPort 53)) {
        if (-not $dnsProxy.HasExited) { Stop-Process -Id $dnsProxy.Id -Force -ErrorAction SilentlyContinue }
        throw "Local DNS fallback did not start on 127.0.0.1:53. See $dnsError"
    }

    try {
        foreach ($hostName in $RedirectHosts) {
            Add-DnsClientNrptRule -Namespace $hostName -NameServers '127.0.0.1' -Comment $DnsNrptComment -ErrorAction Stop | Out-Null
        }
        Clear-DnsClientCache -ErrorAction SilentlyContinue
        ipconfig /flushdns | Out-Null
        Start-Sleep -Seconds 1
        $failed = @($RedirectHosts | Where-Object {
            $hostName = $_
            try { @([Net.Dns]::GetHostAddresses($hostName) | ForEach-Object { $_.ToString() }) -notcontains '127.0.0.1' } catch { $true }
        })
        if ($failed) { throw "Targeted DNS verification failed for: $($failed -join ', ')" }
        Write-Host 'Hosts redirect was bypassed; targeted local FIFA DNS fallback is active.' -ForegroundColor Cyan
        return $dnsProxy
    }
    catch {
        Remove-MngDnsFallbackRules
        if (-not $dnsProxy.HasExited) { Stop-Process -Id $dnsProxy.Id -Force -ErrorAction SilentlyContinue }
        throw
    }
}

function Add-RedirectHostsEntry([string]$PythonSource) {
    $hostsMutex = [Threading.Mutex]::new($false, 'Global\MNGFUT20HostsFile')
    $lockTaken = $false
    try {
        try {
            $lockTaken = $hostsMutex.WaitOne([TimeSpan]::FromSeconds(20))
        }
        catch [Threading.AbandonedMutexException] {
            $lockTaken = $true
        }
        if (-not $lockTaken) {
            throw 'Timed out waiting for another MNG FUT process to finish updating the Windows hosts file.'
        }

        $lines = @(Get-Content -LiteralPath $HostsPath -ErrorAction Stop)
        $lines = @($lines | Where-Object { $LegacyIdentityRedirectLines -notcontains $_ })
        $added = @($RedirectLines | Where-Object { $lines -notcontains $_ }).Count
        $redirectHosts = @($RedirectLines | ForEach-Object { ($_ -split '\s+', 2)[1] })
        $hostPattern = '^\s*(?:\S+)\s+(?:' + (($redirectHosts | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')(?:\s|$)'
        $lines = @($lines | Where-Object { $_ -notmatch $hostPattern })
        $lines += $RedirectLines
        $payload = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
        $lastWriteError = $null
        for ($attempt = 1; $attempt -le 20; $attempt++) {
            try {
                [IO.File]::WriteAllText($HostsPath, $payload, [Text.Encoding]::ASCII)
                $lastWriteError = $null
                break
            }
            catch {
                $lastWriteError = $_.Exception
                Start-Sleep -Milliseconds ([Math]::Min(1000, 100 + ($attempt * 100)))
            }
        }
        if ($null -ne $lastWriteError) {
            throw "Windows hosts file remained locked after 20 retries: $($lastWriteError.Message)"
        }

        ipconfig /flushdns | Out-Null
        $final = @(Get-Content -LiteralPath $HostsPath -ErrorAction Stop)
        $missing = @($RedirectLines | Where-Object { $final -notcontains $_ })
        if ($missing.Count -gt 0) {
            throw "Hosts redirect verification failed; missing $($missing.Count) required entr$(if($missing.Count -eq 1){'y'}else{'ies' })."
        }

        $dnsWarnings = @()
        for ($dnsAttempt = 1; $dnsAttempt -le 15; $dnsAttempt++) {
            Clear-DnsClientCache -ErrorAction SilentlyContinue
            ipconfig /flushdns | Out-Null
            Start-Sleep -Seconds 1
            $dnsWarnings = @()
            foreach ($hostName in $redirectHosts) {
                $resolved = @()
                try {
                    $resolved = @([Net.Dns]::GetHostAddresses($hostName) | ForEach-Object { $_.ToString() })
                }
                catch {
                    $resolved = @('lookup pending')
                }
                if ($resolved -notcontains '127.0.0.1') {
                    $dnsWarnings += "${hostName}=$($resolved -join ',')"
                }
            }
            if ($dnsWarnings.Count -eq 0) { break }
            Write-Host ("      Waiting for Windows DNS cache to reload hosts ({0}/15)..." -f $dnsAttempt) -ForegroundColor DarkGray
        }
        $dnsProxy = $null
        if ($dnsWarnings.Count -gt 0) {
            Write-Host 'Windows is bypassing the verified hosts file; activating targeted FIFA DNS fallback...' -ForegroundColor Yellow
            $dnsProxy = Start-MngDnsFallback -PythonSource $PythonSource -RedirectHosts $redirectHosts
        } else {
            Write-Host ("Hosts redirect: refreshed in ASCII, {0} new entries, DNS verified" -f $added) -ForegroundColor Cyan
        }
        return [pscustomobject]@{ Added = $added; DnsProxy = $dnsProxy }
    }
    finally {
        if ($lockTaken) { $hostsMutex.ReleaseMutex() }
        $hostsMutex.Dispose()
    }
}

function Invoke-TrustPatch([string]$Python, [string]$RunnerScript, [int]$GamePid) {
    $cmd = 'echo.|"{0}" -3.13 "{1}" trust_patch --pid {2}' -f $Python, $RunnerScript, $GamePid
    $output = & cmd.exe /d /c $cmd 2>&1
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = @($output) }
}

function Resolve-GamePath([string]$ExplicitPath, [object]$Settings) {
    if ($ExplicitPath) { return $ExplicitPath }
    if ($Settings.fifa_exe) { return [string]$Settings.fifa_exe }
    if ($Settings.gamePath) { return [string]$Settings.gamePath }
    $candidates = @(
        'C:\Program Files\EA Games\FIFA 20\FIFA20.exe',
        'C:\Program Files (x86)\Origin Games\FIFA 20\FIFA20.exe',
        'C:\Program Files\Origin Games\FIFA 20\FIFA20.exe',
        'C:\Program Files (x86)\Steam\steamapps\common\FIFA 20\FIFA20.exe'
    )
    return @($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1)[0]
}

function Start-EAClientIfAvailable {
    if (Get-Process -Name EADesktop,Origin -ErrorAction SilentlyContinue) {
        Write-Host '[GAME] EA client is already running.' -ForegroundColor DarkGray
        return
    }

    $eaLauncher = $null
    try {
        $originCommand = [string](Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\origin2\shell\open\command' -ErrorAction Stop).'(default)'
        if ($originCommand -match '^"([^"]+\.exe)"') { $eaLauncher = $matches[1] }
        elseif ($originCommand -match '^([^\s]+\.exe)') { $eaLauncher = $matches[1] }
    } catch {}
    if (-not $eaLauncher -or -not (Test-Path -LiteralPath $eaLauncher -PathType Leaf)) {
        Write-Host '[GAME] EA App/Origin was not detected. Continuing with direct FIFA20.exe launch.' -ForegroundColor Yellow
        return
    }

    Write-Host '[GAME] Starting EA App before FIFA 20...' -ForegroundColor Cyan
    Start-Process -FilePath $eaLauncher -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(20)
    do {
        if (Get-Process -Name EADesktop,Origin -ErrorAction SilentlyContinue) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    Write-Host '[GAME] EA App did not report a running process yet; trying FIFA20.exe anyway.' -ForegroundColor Yellow
}

function Start-FIFA20([string]$ResolvedGame, [bool]$UseEAPath = $false) {
    Start-EAClientIfAvailable
    $gameRoot = Split-Path -Path $ResolvedGame -Parent
    $modDataPath = Join-Path $gameRoot 'ModData\Default'
    $arguments = @()
    if ($settings.fifa20_native_models_enabled -eq $true -and (Test-Path -LiteralPath $modDataPath -PathType Container)) {
        $arguments = @('-dataPath', ('"{0}"' -f $modDataPath))
        Write-Host ("[GAME] Frosty ModData detected: {0}" -f $modDataPath) -ForegroundColor Green
    } else {
        Write-Host '[GAME] No Frosty ModData detected; launching the base game.' -ForegroundColor DarkGray
    }
    Write-Host '[GAME] DIRECT EXE ONLY - starting FIFA20.exe...' -ForegroundColor Cyan
    $startParameters = @{ FilePath = $ResolvedGame; WorkingDirectory = $gameRoot; PassThru = $true }
    if ($arguments.Count -gt 0) { $startParameters.ArgumentList = $arguments }
    return Start-Process @startParameters
}

function Stop-StaleLocalFutListeners([int[]]$Ports) {
    $candidatePids = @()
    foreach ($port in $Ports) {
        $listener = Get-Listener $port
        if ($listener) { $candidatePids += @($listener | ForEach-Object { [int]$_.OwningProcess }) }
    }
    $candidatePids = @($candidatePids | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
    if (-not $candidatePids) { return }

    foreach ($pidValue in $candidatePids) {
        try {
            $procInfo = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $pidValue) -ErrorAction SilentlyContinue
            if ($null -eq $procInfo) { continue }
            $name = [string]$procInfo.Name
            $cmdLine = [string]$procInfo.CommandLine
            $looksLikeLocalFut = (
                $name -in @('python.exe','pythonw.exe','py.exe','pyw.exe') -and
                ($cmdLine -match '(?i)(?:runtime_runner|kyro_runner)\.py|localfut20[\\/]server\.py|localfut20[\\/]control_server\.py|redirector_tls\.py')
            )
            if ($looksLikeLocalFut) {
                Write-Host ("      Refreshing stale Local FUT process PID {0}..." -f $pidValue) -ForegroundColor DarkGray
                Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
            }
        } catch {}
    }

    Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(12)
    do {
        $stillBusy = @($Ports | Where-Object { Get-Listener $_ })
        if (-not $stillBusy) { return }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
}

function Stop-ExistingFifaForEAMode {
    $existing = @(Get-Process -Name FIFA20 -ErrorAction SilentlyContinue)
    if (-not $existing) { return }
    Write-Host '[GAME] Closing the previous FIFA 20 instance so EA/FIFASetup can start a clean session...' -ForegroundColor Yellow
    foreach ($proc in $existing) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds(15)
    do {
        if (-not (Get-Process -Name FIFA20 -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    throw 'The previous FIFA20.exe instance did not close. Close FIFA 20 manually and press PLAY again.'
}

function Test-ControlHealth([object]$Settings) {
    try {
        $hostName = if ($Settings.local_host) { [string]$Settings.local_host } else { '127.0.0.1' }
        $port = if ($Settings.control_port) { [int]$Settings.control_port } else { 47220 }
        $h = Invoke-RestMethod -Uri ("http://{0}:{1}/v1/health" -f $hostName, $port) -TimeoutSec 3
        return ($null -ne $h.ok -and $h.ok -eq $true)
    } catch { return $false }
}

function Bootstrap-LocalSession([object]$Settings) {
    $hostName = if ($Settings.local_host) { [string]$Settings.local_host } else { '127.0.0.1' }
    $port = if ($Settings.control_port) { [int]$Settings.control_port } else { 47220 }
    $body = @{ accountId=[string]$Settings.test_account_id; personaId=[int]$Settings.persona_id; displayName=[string]$Settings.display_name } | ConvertTo-Json -Compress
    return Invoke-RestMethod -Method Post -Uri ("http://{0}:{1}/v1/session/bootstrap" -f $hostName, $port) -ContentType 'application/json' -Body $body -TimeoutSec 5
}

function Test-LocalRuntimeHealth([object]$Settings) {
    try {
        $hostName = if ($Settings.local_host) { [string]$Settings.local_host } else { '127.0.0.1' }
        $futPort = if ($Settings.fut_port) { [int]$Settings.fut_port } else { 8080 }
        $futTlsPort = if ($Settings.fut_tls_port) { [int]$Settings.fut_tls_port } else { 443 }
        $blazePort = if ($Settings.blaze_port) { [int]$Settings.blaze_port } else { 44321 }
        $account = Invoke-RestMethod -Uri ("http://{0}:{1}/ut/game/fifa20/user/accountinfo" -f $hostName, $futPort) -TimeoutSec 3
        $persona = @($account.userAccountInfo.personas) | Select-Object -First 1
        if ($null -eq $account.userAccountInfo -or $null -eq $persona -or @($persona.userClubList).Count -lt 1) { return $false }
        return [bool](Get-Listener $blazePort) -and [bool](Get-Listener $futTlsPort)
    } catch {
        return $false
    }
}

function Resolve-ProjectPath([string]$PathText) {
    if (-not $PathText) { return "" }
    if ([System.IO.Path]::IsPathRooted($PathText)) { return $PathText }
    return (Join-Path $ProjectRoot $PathText)
}

function Get-ProtocolSnapshot {
    if (-not (Test-Path -LiteralPath $ProtocolStatusPath -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $ProtocolStatusPath -Raw | ConvertFrom-Json } catch { return $null }
}

function Test-TitleAuthVerified {
    $snap = Get-ProtocolSnapshot
    if ($null -eq $snap) { return $false }
    if ($snap.status -eq 'FUT READY') { return $true }
    if ($null -ne $snap.milestones -and $null -ne $snap.milestones.AUTH) { return $true }
    return $false
}

function Wait-ForTitleAuth([int]$TimeoutSeconds = 35) {
    $until = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-TitleAuthVerified) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $until)
    return $false
}

function Keep-LocalFUTAlive([string]$Message = 'Local FUT services are running. Keep this PowerShell window open while you play.') {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host ' MNG FUT 20 - FIFA 20 LOCAL FUT - RUNNING' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host 'Use STOP FUT in the launcher when you are finished.' -ForegroundColor DarkGray
    $lastSummary = ''
    $lastProtocol = ''
    $failedHealthChecks = 0
    $externalGameAttempts = @{}
    $externalGamePatched = @{}
    while ($true) {
        Start-Sleep -Seconds 2

        $servicesAlive = (Get-Listener $futPort) -and (Get-Listener $blazePort) -and (Get-Listener $controlPort) -and (Get-Listener $futTlsPort)
        if ($servicesAlive) {
            $failedHealthChecks = 0
        } else {
            $failedHealthChecks++
            if ($failedHealthChecks -ge 3) {
                Write-Host ''
                Write-Host 'Local FUT services are no longer running.' -ForegroundColor Yellow
                break
            }
        }

        if ($NoGameLaunch -and -not $SafeGameLaunch) {
            $externalGames = @(Get-Process -Name FIFA20 -ErrorAction SilentlyContinue)
            foreach ($externalGame in $externalGames) {
                $externalKey = '{0}:{1}' -f $externalGame.Id, $externalGame.StartTime.Ticks
                if ($externalGamePatched.ContainsKey($externalKey)) { continue }
                $attempt = 1
                if ($externalGameAttempts.ContainsKey($externalKey)) {
                    $attempt = [int]$externalGameAttempts[$externalKey] + 1
                }
                if ($attempt -gt 30) { continue }
                $externalGameAttempts[$externalKey] = $attempt
                $status.game = "RUNNING (PID $($externalGame.Id))"
                $patch = Invoke-TrustPatch $python.Source (Join-Path $ProjectRoot 'runtime_runner.py') $externalGame.Id
                $patch.Output | Add-Content -LiteralPath (Join-Path $RuntimeRoot 'trust-patch.log') -Encoding utf8
                if ($patch.Output -match '\[SUCCESS\] Patched') {
                    $externalGamePatched[$externalKey] = $true
                    $status.trustBridge = "PATCHED (FIFA20 PID $($externalGame.Id))"
                    $status.connection = 'EXTERNAL FIFA20 PROCESS PATCHED; waiting for title authentication'
                    Write-StatusLine 'Trust bridge' $status.trustBridge Green
                } elseif ($attempt -eq 30) {
                    $status.trustBridge = "FAILED (FIFA20 PID $($externalGame.Id)); see trust-patch.log"
                }
                Save-Status $status
            }
        }

        if (Test-Path -LiteralPath $StatusPath) {
            try {
                $current = Get-Content -LiteralPath $StatusPath -Raw | ConvertFrom-Json
                $summary = ('Server={0} | Game={1} | Connection={2}' -f $current.server, $current.game, $current.connection)
                if ($summary -ne $lastSummary) {
                    Write-Host (('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $summary)) -ForegroundColor DarkGray
                    $lastSummary = $summary
                }
            } catch {}
        }

        $protocol = Get-ProtocolSnapshot
        if ($null -ne $protocol) {
            if ($NoGameLaunch -and $protocol.status -eq 'FUT READY') {
                $status.status = 'FUT READY'
                $status.fut = 'VERIFIED'
                $status.connection = 'FUT READY; Ultimate Team hub reached'
                Save-Status $status
            }
            $pstate = [string]$protocol.currentState
            $pstatus = [string]$protocol.status
            $line = ('{0} / {1}' -f $pstate, $pstatus)
            if ($line -ne $lastProtocol) {
                if ($pstatus -eq 'FUT READY') {
                    Write-Host ('[{0}] FUT READY - Ultimate Team hub reached.' -f (Get-Date -Format 'HH:mm:ss')) -ForegroundColor Green
                } elseif ($null -ne $protocol.milestones.AUTH) {
                    Write-Host ('[{0}] Local title authentication verified. Waiting for FUT hub...' -f (Get-Date -Format 'HH:mm:ss')) -ForegroundColor Green
                } else {
                    Write-Host ('[{0}] Protocol: {1}' -f (Get-Date -Format 'HH:mm:ss'), $line) -ForegroundColor DarkGray
                }
                $lastProtocol = $line
            }
        }
    }
}

function Assert-ProjectFiles([object]$Settings) {
    $required = @(
        'runtime_runner.py',
        'local_dns.py',
        'release_tuning.py',
        'launcher-settings.json',
        'localfut20-manifest.json',
        'runtime\secure_payload.f20',
        'localfut20\config.json',
        'localfut20\players.json',
        'localfut20\managers.json',
        'localfut20\pack_settings.json',
        'localfut20\contentfifa\fut\packs\packopening\packopeningconfig.json',
        'localfut20\contentfifa\fut\packs\packopening\packopeningsetting.json',
        'localfut20\contentfifa\fut\items\images\backgrounds\itemBGs\futitemraritytunables.json',
        'localfut20\contentfifa\fut\playerheads\g4\fut2dheads.big',
        'runtime-source\certs\spring18-cert.pem',
        'runtime-source\certs\spring18-key.pem',
        'runtime-source\gos2015-original-modulus.bin',
        'runtime-source\local-gos2015-modulus.bin',
        'runtime\mined\native-fifa20\tables\fifa_ng_db\manager.json',
        'runtime\mined\native-fifa20\tables\fifa_ng_db\teamkits.json',
        'runtime\mined\native-fifa20\tables\fifa_ng_db\stadiums.json',
        'runtime\mined\native-fifa20\tables\fifa_ng_db\teamballs.json',
        'runtime\mined\native-fifa20\tables\fifa_ng_db\leagueteamlinks.json'
    )
    $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $ProjectRoot $_) -PathType Leaf) })
    if ($missing) { throw "Project is incomplete. Missing: $($missing -join ', ')" }
    $certPath = Resolve-ProjectPath ([string]$Settings.certificate_path)
    $keyPath = Resolve-ProjectPath ([string]$Settings.certificate_key_path)
    if ($certPath -and -not (Test-Path -LiteralPath $certPath -PathType Leaf)) {
        throw "Configured certificate_path does not exist: $($Settings.certificate_path)"
    }
    if ($keyPath -and -not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
        throw "Configured certificate_key_path does not exist: $($Settings.certificate_key_path)"
    }
}

$status = @{
    status = 'NOT READY'
    server = 'NOT STARTED'
    redirector = 'NOT STARTED'
    game = 'NOT STARTED'
    trustBridge = 'NOT APPLIED'
    connection = 'NOT STARTED'
    fut = 'NOT VERIFIED'
    detail = @()
}
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

if (-not $SafeGameLaunch -and -not $NoGameLaunch -and -not (Test-Administrator)) {
    Write-Host 'Administrator permission is required to update the hosts file and patch the running FIFA20.exe process.' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath))
    if ($GamePath) { $argList += @('-GamePath', ('"{0}"' -f $GamePath)) }
    if ($NoGameLaunch) { $argList += '-NoGameLaunch' }
    if ($SafeGameLaunch) { $argList += '-SafeGameLaunch' }
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -WindowStyle Hidden
    exit 0
}

$launcherConsoleLog = Join-Path $RuntimeRoot 'launcher-console.log'
$dnsProxy = $null
try { Start-Transcript -LiteralPath $launcherConsoleLog -Append -Force | Out-Null } catch {}

try {
    Clear-Host
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host ' MNG FUT 20 - FIFA 20 LOCAL FUT' -ForegroundColor White
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host '[1/5] Checking launcher files and settings...' -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) { throw "Missing launcher-settings.json at $SettingsPath" }
    $settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
    # Direct executable mode is intentionally hard-locked for this build.
    $LegitimateEA = $false
    Write-Host '      Launch mode: DIRECT FIFA20.exe ONLY (EA App / Origin hand-off disabled).' -ForegroundColor Green
    Assert-ProjectFiles $settings
    Write-Host '      OK - project files are ready.' -ForegroundColor Green
    Write-Host '[2/5] Preparing Python and local club data...' -ForegroundColor Cyan

    $python = Get-Command py -ErrorAction Stop
    & $python.Source -3.13 -c 'import cryptography' 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency missing: cryptography. Install it with: py -m pip install cryptography>=42' }
    & $python.Source -3.13 -c 'import PIL' 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency missing: Pillow. Install dependencies with: py -3 -m pip install -r requirements.txt' }

    $offlineLog = Join-Path $RuntimeRoot 'offline-data.log'
    & $python.Source -3.13 (Join-Path $ProjectRoot 'runtime_runner.py') offline_data *> $offlineLog
    if ($LASTEXITCODE -ne 0) { throw "Database initialization failed. See $offlineLog" }
    Write-Host '      OK - Python dependencies and club data are ready.' -ForegroundColor Green
    Write-Host '[3/5] Starting Local FUT services...' -ForegroundColor Cyan

    $futPort = if ($settings.fut_port) { [int]$settings.fut_port } else { 8080 }
    $futTlsPort = if ($settings.fut_tls_port) { [int]$settings.fut_tls_port } else { 443 }
    $blazePort = if ($settings.blaze_port) { [int]$settings.blaze_port } else { 44321 }
    $redirectorPort = if ($settings.redirector_port) { [int]$settings.redirector_port } else { 42230 }
    $controlPort = if ($settings.control_port) { [int]$settings.control_port } else { 47220 }
    $portsToCheck = @($futPort, $futTlsPort, $blazePort, $controlPort)
    if (-not $SafeGameLaunch) { $portsToCheck += $redirectorPort }

    Write-Host '      PRIME mode: refreshing previous Local FUT services so this build cannot reuse an older catalog...' -ForegroundColor Cyan
    Stop-StaleLocalFutListeners $portsToCheck
    Stop-OrphanedDnsFallback
    Remove-MngDnsFallbackRules

    $occupied = @()
    foreach ($port in $portsToCheck) {
        $listener = Get-Listener $port
        if ($listener) { $occupied += ("{0} (PID {1})" -f $port, $listener.OwningProcess) }
    }
    if ($occupied) {
        throw "Required local port(s) are still in use after refreshing previous Local FUT services: $($occupied -join ', '). Run Stop MNG FUT 20.cmd, then try again."
    } else {
        $serverLog = Join-Path $RuntimeRoot 'server.log'
        $controlLog = Join-Path $RuntimeRoot 'control.log'
        $controlError = Join-Path $RuntimeRoot 'control.error.log'
        $control = Start-Process -FilePath $python.Source -ArgumentList @('-3.13', ('"{0}"' -f (Join-Path $ProjectRoot 'runtime_runner.py')), 'control_server') -WorkingDirectory $ProjectRoot -RedirectStandardOutput $controlLog -RedirectStandardError $controlError -WindowStyle Hidden -PassThru
        if (-not (Wait-ForPort $controlPort)) {
            if (-not $control.HasExited) { Stop-Process -Id $control.Id -Force }
            throw "Control service did not become ready on port $controlPort. See $controlError"
        }
        $serverError = Join-Path $RuntimeRoot 'server.error.log'
        $server = Start-Process -FilePath $python.Source -ArgumentList @('-3.13', ('"{0}"' -f (Join-Path $ProjectRoot 'runtime_runner.py')), 'server') -WorkingDirectory $ProjectRoot -RedirectStandardOutput $serverLog -RedirectStandardError $serverError -WindowStyle Hidden -PassThru
        if (-not (Wait-ForPort $blazePort) -or -not (Wait-ForPort $futPort) -or -not (Wait-ForPort $futTlsPort)) {
            if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
            throw "FUT/Blaze server did not become ready on ports $blazePort, $futPort, and required FUT TLS port $futTlsPort. See $serverError"
        }
        $status.server = "READY (Blaze $blazePort, FUT $futPort, FUT TLS $futTlsPort)"
        Write-StatusLine 'Server' $status.server Green

        $redirector = $null
        $dnsProxy = $null
        if (-not $SafeGameLaunch) {
            $redirectorLog = Join-Path $RuntimeRoot 'redirector.log'
            $redirectorError = Join-Path $RuntimeRoot 'redirector.error.log'
            $redirector = Start-Process -FilePath $python.Source -ArgumentList @('-3.13', ('"{0}"' -f (Join-Path $ProjectRoot 'runtime_runner.py')), 'redirector_tls') -WorkingDirectory $ProjectRoot -RedirectStandardOutput $redirectorLog -RedirectStandardError $redirectorError -WindowStyle Hidden -PassThru
            if (-not (Wait-ForPort $redirectorPort)) {
                if (-not $redirector.HasExited) { Stop-Process -Id $redirector.Id -Force }
                if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
                throw "TLS redirector did not become ready on port $redirectorPort. See $redirectorError"
            }
            $status.redirector = "READY (TLS redirector $redirectorPort)"
            Write-StatusLine 'Redirector' $status.redirector Green
            $redirectResult = Add-RedirectHostsEntry -PythonSource $python.Source
            $dnsProxy = $redirectResult.DnsProxy
            $status.connection = 'HOSTS REDIRECT INSTALLED; waiting for FIFA20 process and trust bridge'
        } else {
            $status.redirector = 'SKIPPED by -SafeGameLaunch'
        }

        @{ controlPid = $control.Id; serverPid = $server.Id; redirectorPid = if ($redirector) { $redirector.Id } else { $null }; dnsProxyPid = if ($dnsProxy) { $dnsProxy.Id } else { $null }; projectRoot = $ProjectRoot } |
            ConvertTo-Json | Set-Content -LiteralPath $PidPath -Encoding utf8
    }

    if ($NoGameLaunch) {
        $session = Bootstrap-LocalSession $settings
        if ($null -eq $session.session.sessionId) { throw 'Local session bootstrap failed.' }
        $status.status = 'LOCAL SERVICES READY'
        $status.game = 'WAITING FOR EXTERNAL FIFA20 LAUNCH'
        $status.connection = 'HOSTS REDIRECT INSTALLED; monitoring externally launched FIFA20'
        Save-Status $status
        Write-StatusLine 'Game' $status.game Yellow
        Write-StatusLine 'Connection' $status.connection Yellow
        Write-Host "Status file: $StatusPath"
        Keep-LocalFUTAlive 'Server-only mode: launch FIFA 20 yourself or through Frosty. The connection bridge is monitored automatically.'
        exit 0
    }

    Write-Host '      OK - Local FUT services are ready.' -ForegroundColor Green
    Write-Host '[4/5] Starting FIFA 20...' -ForegroundColor Cyan
    $resolvedGame = Resolve-GamePath $GamePath $settings
    if (-not $resolvedGame -or -not (Test-Path -LiteralPath $resolvedGame -PathType Leaf)) {
        $status.status = 'LOCAL SERVICES READY'
        $status.game = 'NOT FOUND'
        $status.connection = 'WAITING; hosts redirect not installed'
        $status.detail += 'Set fifa_exe in launcher-settings.json or pass -GamePath with the full FIFA20.exe path.'
        Save-Status $status
        Write-StatusLine 'Game' $status.game Red
        Write-StatusLine 'Connection' $status.connection Yellow
        Write-Host 'Missing prerequisite: FIFA20.exe path. Set fifa_exe in launcher-settings.json.' -ForegroundColor Red
        exit 0
    }

    $session = Bootstrap-LocalSession $settings
    if ($null -eq $session.session.sessionId) { throw 'Local session bootstrap failed.' }
    $status.detail += ('MNG FUT 20 session enrolled: ' + [string]$session.session.sessionId)
    $status.connection = 'SESSION ENROLLED; waiting for FIFA20 process'
    Save-Status $status

    if ($LegitimateEA) {
        Stop-ExistingFifaForEAMode
    }
    $fifa = Get-Process -Name FIFA20 -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1
    if (-not $fifa) {
        $game = Start-FIFA20 -ResolvedGame $resolvedGame -UseEAPath ([bool]$LegitimateEA)
        Start-Sleep -Seconds 5
        $replacementFifa = Get-Process -Name FIFA20 -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1
        if ($game.HasExited -and -not $replacementFifa) {
            throw "FIFA20.exe closed immediately with exit code $($game.ExitCode). Open EA App, sign in to the account that owns FIFA 20, then press Play again. If Frosty data was just changed, use Apply Mods once before retrying."
        }
        if ($LegitimateEA) {
            Write-Host '[GAME] EA App may open FIFASetup first. Click PLAY there once.' -ForegroundColor Yellow
            Write-Host '[GAME] Waiting for the final FIFA20.exe process; do not start a second copy.' -ForegroundColor DarkGray
        }
    }
    $deadline = (Get-Date).AddSeconds($(if ($LegitimateEA) { 300 } else { 120 }))
    do {
        $fifa = Get-Process -Name FIFA20 -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1
        if ($fifa) { break }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    if (-not $fifa) { throw "FIFA20.exe did not remain running within 120 seconds after launching $resolvedGame" }
    $status.game = "RUNNING (PID $($fifa.Id))"
    Write-StatusLine 'Game' $status.game Green
    Write-Host '[5/5] Connecting FIFA 20 to Local FUT...' -ForegroundColor Cyan

    if ($SafeGameLaunch) {
        $status.status = 'LOCAL SERVICES READY'
        $status.trustBridge = 'SKIPPED by -SafeGameLaunch'
        $status.connection = 'LOCAL SERVICES READY; stopped before TLS redirector, trust patch, and hosts routing'
        Save-Status $status
        Write-StatusLine 'Trust bridge' $status.trustBridge Yellow
        Write-StatusLine 'Connection' $status.connection Yellow
        Keep-LocalFUTAlive
        exit 0
    }

    $delay = if ($LegitimateEA) { 0 } else { [Math]::Max(0, [int]$settings.gameReadyDelaySeconds) }
    if ($delay -gt 0) { Start-Sleep -Seconds $delay }

    $patchedFifaPids = @{}
    $patchAttempts = @{}
    $lastAttemptAt = @{}
    $authDeadline = (Get-Date).AddSeconds($(if ($LegitimateEA) { 240 } else { 60 }))
    $lastPatchedPid = 0
    $patchSucceeded = $false
    $lastWaitMessage = [DateTime]::MinValue
    $reconnectHintShown = $false
    do {
        $allFifa = @(Get-Process -Name FIFA20 -ErrorAction SilentlyContinue | Sort-Object StartTime)
        if ($allFifa.Count -gt 0) {
            $newest = $allFifa | Sort-Object StartTime -Descending | Select-Object -First 1
            $status.game = "RUNNING (PID $($newest.Id))"

            foreach ($currentFifa in $allFifa) {
                $pidNow = [int]$currentFifa.Id
                if ($patchedFifaPids.ContainsKey($pidNow)) { continue }

                $now = Get-Date
                $canTry = (-not $lastAttemptAt.ContainsKey($pidNow)) -or (($now - [DateTime]$lastAttemptAt[$pidNow]).TotalMilliseconds -ge 650)
                if (-not $canTry) { continue }
                $lastAttemptAt[$pidNow] = $now
                $attempt = 1
                if ($patchAttempts.ContainsKey($pidNow)) { $attempt = [int]$patchAttempts[$pidNow] + 1 }
                $patchAttempts[$pidNow] = $attempt

                if ($attempt -eq 1) {
                    Write-Host ("[TRUST] FIFA20.exe detected (PID {0}). Patching immediately..." -f $pidNow) -ForegroundColor Cyan
                } elseif (($attempt % 5) -eq 0) {
                    Write-Host ("[TRUST] Retrying FIFA20.exe PID {0} (attempt {1})..." -f $pidNow, $attempt) -ForegroundColor DarkGray
                }

                if (Get-Process -Id $pidNow -ErrorAction SilentlyContinue) {
                    $patch = Invoke-TrustPatch $python.Source (Join-Path $ProjectRoot 'runtime_runner.py') $pidNow
                    $patch.Output | Add-Content -LiteralPath (Join-Path $RuntimeRoot 'trust-patch.log') -Encoding utf8
                    if ($patch.Output -match '\[SUCCESS\] Patched') {
                        $patchedFifaPids[$pidNow] = $true
                        $patchSucceeded = $true
                        $lastPatchedPid = $pidNow
                        $status.trustBridge = "PATCHED (FIFA20 PID $pidNow)"
                        $refreshResult = Add-RedirectHostsEntry -PythonSource $python.Source
                        if ($refreshResult.DnsProxy) { $dnsProxy = $refreshResult.DnsProxy }
                        Save-Status $status
                        Write-StatusLine 'Trust bridge' $status.trustBridge Green
                        Write-Host ("[GAME] Final FIFA20 process recognized: PID {0}. Waiting for local title authentication..." -f $pidNow) -ForegroundColor Green
                    }
                }
            }
        }

        if (Test-TitleAuthVerified) { break }

        $now = Get-Date
        if (($now - $lastWaitMessage).TotalSeconds -ge 5) {
            $lastWaitMessage = $now
            $alive = @(Get-Process -Name FIFA20 -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1)
            if ($alive) {
                $patchText = if ($patchSucceeded) { 'PATCHED' } else { 'waiting for patch' }
                Write-Host ("[WAIT] FIFA20.exe PID {0} is running; trust={1}; waiting for Blaze/title auth..." -f $alive.Id, $patchText) -ForegroundColor DarkGray
            } else {
                Write-Host '[WAIT] FIFA20.exe is not running right now; waiting for the direct executable process...' -ForegroundColor DarkGray
            }
        }

        if ($LegitimateEA -and $patchSucceeded -and -not $reconnectHintShown) {
            $reconnectHintShown = $true
            Write-Host '[ACTION] If FIFA shows "Press R to reconnect", press R ONCE now. The final FIFA20.exe is recognized and patched.' -ForegroundColor Yellow
        }

        Start-Sleep -Milliseconds 150
    } while ((Get-Date) -lt $authDeadline)

    if (Test-TitleAuthVerified) {
        $protocol = Get-ProtocolSnapshot
        if ($null -ne $protocol -and $protocol.status -eq 'FUT READY') {
            $status.status = 'FUT READY'
            $status.connection = 'FUT READY; Ultimate Team hub reached'
            Write-StatusLine 'Connection' $status.connection Green
            Write-Host '      READY - Ultimate Team hub reached.' -ForegroundColor Green
        } else {
            $status.status = 'TITLE AUTH READY'
            $status.connection = 'LOCAL TITLE AUTH VERIFIED; waiting for FUT hub'
            Write-StatusLine 'Connection' $status.connection Green
            Write-Host '      Local title authentication verified. Open Ultimate Team.' -ForegroundColor Green
        }
    } elseif ($patchSucceeded) {
        $status.status = 'TITLE AUTH WAITING'
        $status.connection = 'FINAL FIFA PROCESS PATCHED; title authentication not verified yet'
        Write-StatusLine 'Connection' $status.connection Yellow
        Write-Host '      FIFA20.exe is patched, but the title did not authenticate yet.' -ForegroundColor Yellow
        if ($LegitimateEA) {
            Write-Host '      If FIFASetup is still open, click PLAY once and wait. The launcher is monitoring process replacement.' -ForegroundColor DarkGray
            Write-Host '      If FIFA shows an EA age restriction, that restriction belongs to the EA account; Local FUT reports an adult local profile.' -ForegroundColor DarkGray
        }
    } else {
        $status.trustBridge = 'FAILED; no final FIFA20.exe process was successfully patched'
        $status.connection = 'NOT READY'
        Write-StatusLine 'Trust bridge' $status.trustBridge Red
        Write-Host '      The final FIFA20.exe process could not be patched. See runtime\trust-patch.log.' -ForegroundColor Red
    }
    Save-Status $status
    Write-Host "Status file: $StatusPath"
    Keep-LocalFUTAlive
} catch {
    if ($dnsProxy -and -not $dnsProxy.HasExited) {
        Stop-Process -Id $dnsProxy.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-MngDnsFallbackRules
    $status.status = 'FAILED'
    $status.server = if ($status.server -eq 'NOT STARTED') { 'FAILED' } else { $status.server }
    $status.connection = 'NOT READY'
    $status.detail += $_.Exception.Message
    Save-Status $status
    Write-StatusLine 'ERROR' $_.Exception.Message Red
    Write-Host "Status file: $StatusPath"
    exit 1
}
