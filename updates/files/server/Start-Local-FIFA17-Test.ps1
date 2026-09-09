param([string]$GameExe = '')

if (-not $GameExe) {
    $launcherSettings = Join-Path $PSScriptRoot 'launcher-settings.json'
    if (Test-Path -LiteralPath $launcherSettings) {
        try { $GameExe = [string](Get-Content -LiteralPath $launcherSettings -Raw | ConvertFrom-Json).gameExe }
        catch { $GameExe = '' }
    }
}
if (-not $GameExe) {
    Write-Host 'Open LANCER MNG FUT.bat and choose your FIFA17.exe first.' -ForegroundColor Yellow
    Read-Host 'Press Enter to close'
    exit 1
}

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-GameExe',"`"$GameExe`"")
    exit
}

$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$errorLog=Join-Path $root 'STARTUP-ERROR.txt'
$friendPreflight=Join-Path $root 'logs\friend-preflight.log'
trap {
    $message = "FIFA 17 local test could not start.`r`n`r`n$($_.Exception.Message)`r`n`r`nLine: $($_.InvocationInfo.ScriptLineNumber)`r`nCommand: $($_.InvocationInfo.Line)"
    Set-Content -LiteralPath $errorLog -Value $message -Encoding UTF8
    Write-Host $message -ForegroundColor Red
    Write-Host "`nThe error was saved here:`n$errorLog" -ForegroundColor Yellow
    Read-Host 'Press Enter to close'
    break
}
# Portable/friend preflight. Starting with an existing FIFA process is the most
# common reason the player-head cache cannot be refreshed.
if(Get-Process FIFA17 -ErrorAction SilentlyContinue){
    throw 'FIFA 17 est deja ouvert. Ferme completement FIFA17.exe puis relance MNG FUT.'
}
New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null
@(
    "MNG FUT FRIEND PREFLIGHT $(Get-Date -Format o)",
    "User=$env:USERNAME",
    "ServerRoot=$root",
    "GameExe=$GameExe",
    "PowerShell=$($PSVersionTable.PSVersion)",
    "Admin=$(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"
) | Set-Content -LiteralPath $friendPreflight -Encoding UTF8

$gameDir=Split-Path -Parent $GameExe
$modDataRoot=Join-Path $gameDir 'ModData\Editor'
$useModData=$false
if($env:MNG_FUT_NO_MODDATA -ne '1' -and (Test-Path -LiteralPath $modDataRoot -PathType Container)){
    $useModData=@(Get-ChildItem -LiteralPath $modDataRoot -Recurse -File -ErrorAction SilentlyContinue).Count -gt 0
}
Add-Content -LiteralPath $friendPreflight -Value "ModDataEditor=$modDataRoot enabled=$useModData requestedOff=$($env:MNG_FUT_NO_MODDATA -eq '1')"
$ini=Join-Path $gameDir 'senorclutch.ini'
$dll=Join-Path $gameDir 'version.dll'
$payloadDll=Join-Path $root 'payload\version.dll'
$caCertPath=Join-Path $root 'certs\local-server.crt'
$hosts=Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
if (-not (Test-Path -LiteralPath $GameExe)) { throw "FIFA17.exe was not found: $GameExe" }
if (-not (Test-Path -LiteralPath $payloadDll)) { throw 'The bundled FIFA 17 launcher file is missing.' }
if (-not (Test-Path -LiteralPath $caCertPath)) { throw 'The bundled local CA certificate is missing.' }

# A launcher that is closed early can leave its bundled Node server running.
# Stop only a previous FIFA local server, never an unrelated Node application.
$tcpPorts=@(80,5139,44325,42230,44321,8000,8085,8094,17502)
$udpPorts=@(17503)
$stalePids=[Collections.Generic.HashSet[int]]::new()
try {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
        Where-Object {
            $_.ExecutablePath -match '(?i)[\\/]runtime[\\/]node\.exe$' -and
            $_.CommandLine -match '(?i)[\\/]local-server\.js(?:["'']|\s|$)'
        } | ForEach-Object { [void]$stalePids.Add([int]$_.ProcessId) }
} catch {
    # The port-owner check below is also able to identify the bundled runtime.
}
$portOwners=@(
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $tcpPorts -contains $_.LocalPort } |
        Select-Object -ExpandProperty OwningProcess
    Get-NetUDPEndpoint -ErrorAction SilentlyContinue |
        Where-Object { $udpPorts -contains $_.LocalPort } |
        Select-Object -ExpandProperty OwningProcess
) | Sort-Object -Unique
foreach($ownerPid in $portOwners){
    $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue
    $identity=(([string]$owner.ExecutablePath)+' '+([string]$owner.CommandLine))
    if($owner -and $owner.Name -ieq 'node.exe' -and $identity -match '(?i)[\\/]local-server\.js(?:["'']|\s|$)'){
        [void]$stalePids.Add([int]$ownerPid)
    }
}
foreach($stalePid in $stalePids){
    Write-Host "Closing previous FIFA local server (PID $stalePid)..." -ForegroundColor Yellow
    Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
}
if($stalePids.Count -gt 0){ Start-Sleep -Milliseconds 750 }

$remainingOwners=@(
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $tcpPorts -contains $_.LocalPort } |
        ForEach-Object { "TCP $($_.LocalPort) (PID $($_.OwningProcess))" }
    Get-NetUDPEndpoint -ErrorAction SilentlyContinue |
        Where-Object { $udpPorts -contains $_.LocalPort } |
        ForEach-Object { "UDP $($_.LocalPort) (PID $($_.OwningProcess))" }
)
if($remainingOwners.Count -gt 0){
    throw "A different app is using a FIFA local-server port: $($remainingOwners -join ', '). Close that app or restart Windows, then run OPEN-ME.bat again."
}

$logDir=Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# FIFA caches FUT player-head DDS files under Documents and loads those copies
# before contacting the local CDN. Refresh every installed OTW/TOTW portrait
# with a compatible uncompressed RGBA texture before each launch.
$playerHeadCache=Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'FIFA 17\filesystemcache\atlFUTPlayerHeads'
# TEST HIGUAIN: remove the stale dynamic image previously copied into his BASE definition slot.
$higuainBaseCache=Join-Path $playerHeadCache 'p16944880.dds'
if(Test-Path -LiteralPath $higuainBaseCache){
    Remove-Item -LiteralPath $higuainBaseCache -Force -ErrorAction SilentlyContinue
}
$xaviDynamicCacheNames=@(
    'p100673831.dds','p16787751.dds','p10535.dds',
    'p100691426.dds','p100990004.dds','p16805346.dds','p16805347.dds','p28130.dds','p28131.dds',
    'p100798751.dds','p100987654.dds','p117630001.dds',
    'p100990003.dds','p16778613.dds','p1397.dds',
    'p100990002.dds','p16884931.dds','p107715.dds'
)
$baseIconCacheNames=@(
    'p100664921.dds','p16778841.dds','p1625.dds',
    'p117575967.dds','p16912671.dds','p135455.dds',
    'p17038809.dds','p261593.dds',
    'p16992775.dds','p215559.dds',
    'p16968406.dds','p191190.dds'
)
$soloFallbackCacheNames=@(
    'p16967699.dds','p16966812.dds','p16961123.dds','p16798017.dds',
    'p16953796.dds','p17008963.dds','p16944711.dds','p16935239.dds','p16968087.dds',
    'p100663784.dds','p16777704.dds','p488.dds',
    'p100853344.dds','p16967264.dds','p190048.dds',
    'p100664405.dds','p16778325.dds','p1109.dds',
    'p16778326.dds','p1110.dds'
)
foreach($cacheName in ($xaviDynamicCacheNames+$baseIconCacheNames+$soloFallbackCacheNames)){
    $cachePath=Join-Path $playerHeadCache $cacheName
    if(Test-Path -LiteralPath $cachePath){
        Remove-Item -LiteralPath $cachePath -Force -ErrorAction SilentlyContinue
    }
}
$catalogPath=Join-Path $root 'data\fifa17-card-catalog.json'
$dynamicHeadCopies=@{}
if(Test-Path -LiteralPath $catalogPath){
    $cardCatalog=Get-Content -LiteralPath $catalogPath -Raw | ConvertFrom-Json
    foreach($card in $cardCatalog.specials){
        if($card.cardType -notin @('otw','totw','sbc','premium_sbc')){ continue }
        $resourceId=[int64]$card.resourceId
        $sourceId=$resourceId
        if($resourceId -eq 50499312){ $sourceId=184717040 }
        if($resourceId -eq 100785235){ $sourceId=117562451 }
        $sourceDds=Join-Path $root "data\playerheads\p$sourceId.dds"
        if(-not (Test-Path -LiteralPath $sourceDds)){ continue }

        $dynamicHeadCopies["p$resourceId.dds"]=$sourceDds
        $baseDefinitionId=16777216+[int64]$card.assetId
        $baseCacheName="p$baseDefinitionId.dds"
        # TEST HIGUAIN: do not overwrite his base-card cache slot with the OTW dynamic portrait.
        if($baseDefinitionId -ne 16944880 -and -not $dynamicHeadCopies.ContainsKey($baseCacheName)){
            $dynamicHeadCopies[$baseCacheName]=$sourceDds
        }
        $dynamicHeadCopies["p$sourceId.dds"]=$sourceDds
    }
}
# Custom community-pack cards are injected by fut-backend and therefore absent
# from the static catalog. Refresh all request aliases in FIFA's DDS cache.
$customDynamicHeads=@(
    @{ ResourceId=100785240; AssetId=121944 },
    @{ ResourceId=100671059; AssetId=7763 },
    @{ ResourceId=100813714; AssetId=150418 },
    @{ ResourceId=100677039; AssetId=13743 },
    @{ ResourceId=100668767; AssetId=5471 },
    @{ ResourceId=100694728; AssetId=31432 },
    @{ ResourceId=117578961; AssetId=138449 },
    @{ ResourceId=117485709; AssetId=45197 },
    @{ ResourceId=117553934; AssetId=113422 },
    @{ ResourceId=117492603; AssetId=52091 },
    @{ ResourceId=117629079; AssetId=188567 },
    @{ ResourceId=117597128; AssetId=156616 },
    @{ ResourceId=100987654; AssetId=167397 },
    @{ ResourceId=17038809; AssetId=261593 },
    @{ ResourceId=16992775; AssetId=215559 },
    @{ ResourceId=16968406; AssetId=191190 }
)
foreach($head in $customDynamicHeads){
    $sourceDds=Join-Path $root "data\playerheads\p$($head.ResourceId).dds"
    if(-not (Test-Path -LiteralPath $sourceDds)){ continue }
    $dynamicHeadCopies["p$($head.ResourceId).dds"]=$sourceDds
    $dynamicHeadCopies["p$($head.AssetId).dds"]=$sourceDds
    $baseDefinitionId=16777216+[int64]$head.AssetId
    $dynamicHeadCopies["p$baseDefinitionId.dds"]=$sourceDds
}
$maldiniPortraitSource=Join-Path $root 'data\playerheads\p100664876.dds'
if(Test-Path -LiteralPath $maldiniPortraitSource){
    foreach($cacheName in @('p100664405.dds','p16778325.dds','p1109.dds')){
        $dynamicHeadCopies[$cacheName]=$maldiniPortraitSource
    }
}
if($dynamicHeadCopies.Count -gt 0){
    New-Item -ItemType Directory -Force -Path $playerHeadCache | Out-Null
    foreach($copy in $dynamicHeadCopies.GetEnumerator()){
        $cacheDestination=Join-Path $playerHeadCache $copy.Key
        $copied=$false
        $sourceLength=(Get-Item -LiteralPath $copy.Value).Length
        for($attempt=1;$attempt -le 10 -and -not $copied;$attempt++){
            try{
                Copy-Item -LiteralPath $copy.Value -Destination $cacheDestination -Force -ErrorAction Stop
                $copied=$true
            }catch [System.IO.IOException]{
                Start-Sleep -Milliseconds 250
            }catch [System.UnauthorizedAccessException]{
                Start-Sleep -Milliseconds 250
            }
        }
        if(-not $copied){
            # Do NOT cancel the complete local server because one cached portrait
            # is still locked. If the existing file is already identical in size,
            # it is good enough; otherwise log the skipped portrait and continue.
            if((Test-Path -LiteralPath $cacheDestination) -and (Get-Item -LiteralPath $cacheDestination).Length -eq $sourceLength){
                Add-Content -LiteralPath $friendPreflight -Value "DDS cache deja OK: $cacheDestination"
            }else{
                Add-Content -LiteralPath $friendPreflight -Value "AVERTISSEMENT DDS verrouille, copie ignoree: $cacheDestination"
                Write-Host "Avertissement: image dynamique verrouillee, FIFA sera quand meme lance: $($copy.Key)" -ForegroundColor Yellow
            }
        }
    }
}

$stamp=Get-Date -Format yyyyMMdd-HHmmss
$backup=Join-Path $root "backups\$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
$iniExisted=Test-Path -LiteralPath $ini
$dllExisted=Test-Path -LiteralPath $dll
if ($iniExisted) { Copy-Item -LiteralPath $ini -Destination (Join-Path $backup 'senorclutch.ini') }
if ($dllExisted) { Copy-Item -LiteralPath $dll -Destination (Join-Path $backup 'version.dll') -Force }
$hostsOriginal=[IO.File]::ReadAllText($hosts)
$caCert=New-Object Security.Cryptography.X509Certificates.X509Certificate2($caCertPath)
$trustedCaPath="Cert:\LocalMachine\Root\$($caCert.Thumbprint)"
$caAlreadyTrusted=Test-Path -LiteralPath $trustedCaPath
$caInstalledByLauncher=$false
$dllInstalledByLauncher=$false
$server=$null
$monitor=$null
$moduleMonitor=$null

try {
    if (-not $dllExisted) {
        $dllInstalledByLauncher=$true
        Copy-Item -LiteralPath $payloadDll -Destination $dll -Force
    }

    # Follow the working revival order: CardsDLL must be loaded naturally by
    # OSDKCards_Init after RetrieveUserData, not injected before FUT login.
    $launchMode=if($useModData){'MNG FUT with Frosty ModData\Editor assets'}else{'MNG FUT without ModData\Editor assets'}
    Set-Content -LiteralPath (Join-Path $logDir 'launcher-mode.txt') -Value $launchMode -Encoding UTF8

    if(-not $caAlreadyTrusted){
        Import-Certificate -FilePath $caCertPath -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
        $caInstalledByLauncher=$true
    }
    if(-not (Test-Path -LiteralPath $trustedCaPath)){throw 'The local CA certificate could not be trusted.'}

    $cfg=@'
[Login]
Host=senorclutch.game
Port=42230
Debug=1

[Credentials]
Username=local
Password=local

[Server]
login_port=5139
fut_port=8000
cdn_port=8085
blaze_port=44321
'@
    Set-Content -LiteralPath $ini -Value $cfg -Encoding ASCII

    $cleanLines=$hostsOriginal -split "`r?`n" | Where-Object {$_ -notmatch '# FIFA17-OFFLINE-LOCAL$'}
    $localRoutes=@(
        '127.0.0.1 senorclutch.game # FIFA17-OFFLINE-LOCAL',
        '127.0.0.1 gosca.ea.com # FIFA17-OFFLINE-LOCAL',
        '127.0.0.1 pas.gt.easfc.ea.com # FIFA17-OFFLINE-LOCAL'
    )
    [IO.File]::WriteAllText($hosts,(($cleanLines+$localRoutes) -join "`r`n"),[Text.Encoding]::ASCII)

    $node=Join-Path $root 'runtime\node.exe'
    if(-not (Test-Path $node)){throw 'The bundled local-server runtime is missing.'}
    $server=Start-Process -FilePath $node -WindowStyle Hidden -PassThru -ArgumentList @("`"$(Join-Path $root 'local-server.js')`"") -WorkingDirectory $root
    $ready=$false
    $readyDeadline=(Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 250
        $server.Refresh()
        if($server.HasExited){ break }
        $serverTcp=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $server.Id } | Select-Object -ExpandProperty LocalPort)
        $serverUdp=@(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $server.Id } | Select-Object -ExpandProperty LocalPort)
        $missingTcp=@($tcpPorts | Where-Object { $serverTcp -notcontains $_ })
        $missingUdp=@($udpPorts | Where-Object { $serverUdp -notcontains $_ })
        $ready=($missingTcp.Count -eq 0 -and $missingUdp.Count -eq 0)
    } while(-not $ready -and (Get-Date) -lt $readyDeadline)
    if(-not $ready){
        $server.Refresh()
        if(-not $server.HasExited){ Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
        $serverLog=Join-Path $logDir 'local-server.log'
        $details='No local-server log was written.'
        if(Test-Path -LiteralPath $serverLog){ $details=(Get-Content -LiteralPath $serverLog -Tail 40) -join "`r`n" }
        $missingSummary=@()
        if($missingTcp.Count -gt 0){$missingSummary += ('TCP manquants: '+(($missingTcp | Sort-Object) -join ', '))}
        if($missingUdp.Count -gt 0){$missingSummary += ('UDP manquants: '+(($missingUdp | Sort-Object) -join ', '))}
        $missingText=if($missingSummary.Count -gt 0){($missingSummary -join "`r`n")}else{'Ports manquants non determines.'}
        throw "The FIFA local server did not claim all required ports after 30 seconds.`r`n$missingText`r`n`r`n$details"
    }

    $routeLog=Join-Path $root 'logs\fifa17-route-capture.log'
    $routeTool=Join-Path $root 'tools\capture-fifa17-routes.ps1'
    $moduleLog=Join-Path $root 'logs\fifa17-modules.log'
    $moduleTool=Join-Path $root 'tools\capture-fifa17-modules.ps1'
    $launchAttempt=0
    do {
        $launchAttempt++
        $attemptUseModData=($useModData -and $launchAttempt -eq 1)
        if($attemptUseModData){
            Write-Host "MNG FUT: chargement des images Frosty depuis $modDataRoot" -ForegroundColor Green
            $gameArgs=@('-dataPath',('"{0}"' -f $modDataRoot))
            $game=Start-Process -FilePath $GameExe -WorkingDirectory $gameDir -ArgumentList $gameArgs -PassThru
        }else{
            if($useModData){
                Write-Host 'MNG FUT: test de secours sans les images Frosty apres l echec du moteur ModData.' -ForegroundColor Yellow
            }else{
                Write-Host 'ATTENTION: ModData\Editor est introuvable ou vide. Les images personnalisees Frosty peuvent manquer.' -ForegroundColor Yellow
            }
            Write-Host 'Local prototype is running. Starting FIFA 17...' -ForegroundColor Cyan
            $game=Start-Process -FilePath $GameExe -WorkingDirectory $gameDir -PassThru
        }
        Add-Content -LiteralPath $friendPreflight -Value "Mode lancement: tentative=$launchAttempt frostymoddata=$attemptUseModData"
        $launchStartedAt=Get-Date
        $trackedGamePids=[Collections.Generic.HashSet[int]]::new()
        $relayCount=0
        $finalExitCode=$null
        while($game){
            [void]$trackedGamePids.Add([int]$game.Id)
            Add-Content -LiteralPath $friendPreflight -Value "Suivi FIFA: tentative=$launchAttempt pid=$($game.Id) relais=$relayCount"
            $monitorArgs="-NoProfile -ExecutionPolicy Bypass -File `"$routeTool`" -ProcessId $($game.Id) -OutputPath `"$routeLog`""
            $monitor=Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList $monitorArgs
            $moduleArgs="-NoProfile -ExecutionPolicy Bypass -File `"$moduleTool`" -ProcessId $($game.Id) -OutputPath `"$moduleLog`""
            $moduleMonitor=Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList $moduleArgs
            $game.WaitForExit()
            $exitCode=$game.ExitCode
            if($moduleMonitor -and -not $moduleMonitor.HasExited){Stop-Process -Id $moduleMonitor.Id -Force -ErrorAction SilentlyContinue}
            if($monitor -and -not $monitor.HasExited){Stop-Process -Id $monitor.Id -Force -ErrorAction SilentlyContinue}

            $replacementGame=$null
            $elapsedSeconds=((Get-Date)-$launchStartedAt).TotalSeconds
            $unknownRelayExit=($null -eq $exitCode -and $relayCount -gt 0)
            if(($exitCode -eq -6 -or $unknownRelayExit) -and $elapsedSeconds -lt 30 -and $relayCount -lt 8){
                $relayDeadline=(Get-Date).AddSeconds(5)
                do {
                    Start-Sleep -Milliseconds 100
                    $replacementGame=Get-Process -Name FIFA17 -ErrorAction SilentlyContinue |
                        Where-Object { -not $trackedGamePids.Contains([int]$_.Id) } |
                        Sort-Object StartTime -Descending |
                        Select-Object -First 1
                } while(-not $replacementGame -and (Get-Date) -lt $relayDeadline)
            }
            if($replacementGame){
                $relayCount++
                Add-Content -LiteralPath $friendPreflight -Value "Processus FIFA relais: ancienPid=$($game.Id) nouveauPid=$($replacementGame.Id) code=$exitCode relais=$relayCount"
                Write-Host "MNG FUT: processus FIFA relais detecte (PID $($replacementGame.Id))." -ForegroundColor Cyan
                $game=$replacementGame
                continue
            }
            $finalExitCode=if($null -eq $exitCode -and $relayCount -gt 0){-6}else{$exitCode}
            Add-Content -LiteralPath $friendPreflight -Value "Fin FIFA: pid=$($game.Id) code=$finalExitCode codeNatif=$exitCode duree=$([Math]::Round($elapsedSeconds,1))s relais=$relayCount"
            break
        }
        $retryEarlyNativeExit=($finalExitCode -eq -6 -and $elapsedSeconds -lt 30 -and $launchAttempt -eq 1)
        if($retryEarlyNativeExit){
            Add-Content -LiteralPath $friendPreflight -Value "Relance complete automatique: code=-6 duree=$([Math]::Round($elapsedSeconds,1))s tentative=$launchAttempt relais=$relayCount"
            Write-Host 'La chaine de démarrage a échoué trop tôt. Nouvelle tentative automatique...' -ForegroundColor Yellow
            Start-Sleep -Seconds 2
        }
    } while($retryEarlyNativeExit)
    Write-Host "FIFA 17 exited with code $finalExitCode." -ForegroundColor Yellow
} finally {
    if($moduleMonitor -and -not $moduleMonitor.HasExited){Stop-Process -Id $moduleMonitor.Id -Force -ErrorAction SilentlyContinue}
    if($monitor -and -not $monitor.HasExited){Stop-Process -Id $monitor.Id -Force -ErrorAction SilentlyContinue}
    if($server -and -not $server.HasExited){Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}
    if($iniExisted -and (Test-Path (Join-Path $backup 'senorclutch.ini'))){Copy-Item -LiteralPath (Join-Path $backup 'senorclutch.ini') -Destination $ini -Force}
    elseif(-not $iniExisted -and (Test-Path -LiteralPath $ini)){Remove-Item -LiteralPath $ini -Force}
    if($dllExisted -and (Test-Path (Join-Path $backup 'version.dll'))){Copy-Item -LiteralPath (Join-Path $backup 'version.dll') -Destination $dll -Force}
    elseif($dllInstalledByLauncher -and (Test-Path -LiteralPath $dll)){Remove-Item -LiteralPath $dll -Force}
    if($caInstalledByLauncher -and (Test-Path -LiteralPath $trustedCaPath)){Remove-Item -LiteralPath $trustedCaPath -Force -ErrorAction SilentlyContinue}
    [IO.File]::WriteAllText($hosts,$hostsOriginal,[Text.Encoding]::ASCII)
}

$zip=Join-Path $root "results\FIFA17-local-prototype-$stamp.zip"
New-Item -ItemType Directory -Force -Path (Split-Path $zip) | Out-Null
$diagnosticPaths=@((Join-Path $root 'logs\*'))
$senorClutchLog=Join-Path $gameDir 'senorclutch-log.txt'
if(Test-Path -LiteralPath $senorClutchLog){
    $diagnosticPaths += $senorClutchLog
}
$archiveError=''
try {
    Compress-Archive -Path $diagnosticPaths -DestinationPath $zip -Force -ErrorAction Stop
} catch {
    $archiveError=$_.Exception.Message
    Add-Content -LiteralPath (Join-Path $logDir 'launcher-archive-error.log') -Value "$(Get-Date -Format o) $archiveError" -Encoding UTF8 -ErrorAction SilentlyContinue
}
if($archiveError){
    Write-Host "Test complete. FIFA exited normally; diagnostic archive unavailable: $archiveError" -ForegroundColor Yellow
}else{
    Write-Host "Test complete. Send me this file:`n$zip" -ForegroundColor Green
}
Read-Host 'Press Enter to close'

