param([string]$GameExe = '')

# MNG-BRIDGE-OWNS-FIFA-2.1.32
# Launcher 3.0.18 explicitly delegates FIFA launch ownership to the Bridge.

# MNG-LAUNCHER-HANDOFF-2.1.30
function Test-MngLocalPort([int]$Port,[int]$TimeoutMs=150){
    $c=$null;$ar=$null
    try{
        $c=New-Object Net.Sockets.TcpClient
        $ar=$c.BeginConnect('127.0.0.1',$Port,$null,$null)
        if(-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs)){return $false}
        $c.EndConnect($ar)
        return $c.Connected
    }catch{return $false}
    finally{
        try{if($ar){$ar.AsyncWaitHandle.Close()}}catch{}
        try{if($c){$c.Close()}}catch{}
    }
}

function Start-OrWait-MngFifa {
    param(
        [string]$FilePath,
        [string]$WorkingDirectory,
        [object[]]$ArgumentList=$null
    )

    if($env:MNG_FUT_LAUNCHER_OWNS_GAME -eq '1' -and $env:MNG_FUT_BRIDGE_OWNS_GAME -ne '1'){
        # 2.1.31: HANDOFF is emitted at the EXACT point where the historical
        # script would normally execute FIFA17.exe. No extra port gate here.
        # local-server has already been started earlier in this script.
        Write-Host "MNG FUT LAUNCHER HANDOFF READY: $FilePath" -ForegroundColor Green

        $deadline=[DateTime]::UtcNow.AddSeconds(60)
        do{
            $candidate=$null
            $all=@(Get-Process -Name FIFA17 -ErrorAction SilentlyContinue)

            foreach($p in $all){
                try{
                    if([IO.Path]::GetFullPath($p.Path) -ieq [IO.Path]::GetFullPath($FilePath)){
                        $candidate=$p
                        break
                    }
                }catch{}
            }

            if(-not $candidate -and $all.Count -gt 0){$candidate=$all[0]}

            if($candidate){
                Write-Host "MNG FUT LAUNCHER HANDOFF ATTACHED PID=$($candidate.Id)" -ForegroundColor Green
                return $candidate
            }

            Start-Sleep -Milliseconds 150
        }while([DateTime]::UtcNow -lt $deadline)

        throw 'Launcher handoff timed out: FIFA17.exe was not started by the launcher.'
    }

    if($ArgumentList -and $ArgumentList.Count -gt 0){
        return Start-Process -FilePath $FilePath -WorkingDirectory $WorkingDirectory -ArgumentList $ArgumentList -PassThru
    }

    return Start-Process -FilePath $FilePath -WorkingDirectory $WorkingDirectory -PassThru
}

# MNG-LOCALAPPDATA-RUNTIME-2.1.28
# Prefer the physical runtime installed by Launcher 3.0.9 in LOCALAPPDATA.
# Older launchers remain compatible: if that runtime is absent, keep their
# legacy <game>\ModData\MNGFUT path.
function Resolve-MngRuntimeRoot([string]$CurrentGameRoot){
    $candidate=''
    if($env:MNG_FUT_LOCAL_RUNTIME){
        try{$candidate=[IO.Path]::GetFullPath([string]$env:MNG_FUT_LOCAL_RUNTIME)}catch{$candidate=[string]$env:MNG_FUT_LOCAL_RUNTIME}
    }elseif($env:LOCALAPPDATA){
        $candidate=Join-Path $env:LOCALAPPDATA 'MNGFUTLauncher\runtime\MNGFUT'
    }
    if($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)){
        return $candidate
    }
    return (Join-Path $CurrentGameRoot 'ModData\MNGFUT')
}
# MNG FUT compact runtime + senorclutch hosts/DNS self-heal V54 - 2026-09-11

if (-not $GameExe) {
    $launcherSettings = Join-Path $PSScriptRoot 'launcher-settings.json'
    if (Test-Path -LiteralPath $launcherSettings) {
        try { $GameExe = [string](Get-Content -LiteralPath $launcherSettings -Raw | ConvertFrom-Json).gameExe }
        catch { $GameExe = '' }
    }
}
if (-not $GameExe) {
    Write-Host 'Open LANCER MNG FUT.bat and choose your FIFA17.exe first.' -ForegroundColor Yellow
    if($env:MNG_FUT_EMBEDDED -ne '1'){Read-Host 'Press Enter to close'}
    exit 1
}

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-GameExe',"`"$GameExe`"")
    exit
}

$ErrorActionPreference='Stop'

# MNG_PATH_FIX_2_1_10
# Aucun chemin ne doit dependre d'une lettre de disque fixe.
$MNGCanonicalServerRoot = $PSScriptRoot
$MNGSelectedGameExe = [IO.Path]::GetFullPath($GameExe)
$MNGSelectedGameDir = Split-Path -Parent $MNGSelectedGameExe
# MNG-RUNTIME-JUNCTION-2.1.29
function Resolve-MngRuntimeRoot([string]$CurrentGameRoot){
    return (Join-Path $CurrentGameRoot 'ModData\MNGFUT')
}
$MNGSelectedModRoot = Resolve-MngRuntimeRoot $MNGSelectedGameDir

if (-not $env:LOCALAPPDATA) {
    throw 'LOCALAPPDATA est introuvable. Impossible de determiner le dossier serveur MNG FUT.'
}

Write-Host ("MNG FUT SESSION: server -> {0}" -f $MNGCanonicalServerRoot) -ForegroundColor Cyan
Write-Host ("MNG FUT PATH FIX: game   -> {0}" -f $MNGSelectedGameExe)
Write-Host ("MNG FUT PATH FIX: mod    -> {0}" -f $MNGSelectedModRoot)

Remove-Item Env:MNG_FIFA17_SERVER_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:MNG_SERVER_E_DRIVE -ErrorAction SilentlyContinue
$root=$PSScriptRoot
$errorLog=Join-Path $root 'STARTUP-ERROR.txt'
$friendPreflight=Join-Path $root 'logs\friend-preflight.log'

# MNG V53 - only ONE Start-Local-FIFA17-Test.ps1 chain may own FIFA at a time.
# Double-clicking Play twice used to start two servers/two FIFA launch chains.
# One instance then restored version.dll while the other still had it loaded.
$launchMutex=$null
$launchMutexOwned=$false
try {
    $launchMutex=New-Object Threading.Mutex($false,'Local\MNGFUT-FIFA17-LAUNCH-V54')
    try {
        $launchMutexOwned=$launchMutex.WaitOne(0,$false)
    } catch [Threading.AbandonedMutexException] {
        $launchMutexOwned=$true
    }
} catch {
    # If Mutex creation itself ever fails, keep the old launch path rather than
    # preventing FIFA from starting. The version.dll cleanup retry below still
    # protects against a transient lock.
    $launchMutex=$null
    $launchMutexOwned=$true
}

if(-not $launchMutexOwned){
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null
    $msg='Une session MNG FUT / FIFA 17 est deja en cours. Le second lancement a ete ignore pour eviter un conflit version.dll.'
    Add-Content -LiteralPath (Join-Path $root 'logs\duplicate-launch-blocked.log') -Value "$(Get-Date -Format o) $msg" -Encoding UTF8
    Write-Host $msg -ForegroundColor Yellow
    if($env:MNG_FUT_EMBEDDED -ne '1'){Read-Host 'Press Enter to close'}
    exit 0
}

trap {
    $message = "FIFA 17 local test could not start.`r`n`r`n$($_.Exception.Message)`r`n`r`nLine: $($_.InvocationInfo.ScriptLineNumber)`r`nCommand: $($_.InvocationInfo.Line)"
    Set-Content -LiteralPath $errorLog -Value $message -Encoding UTF8
    Write-Host $message -ForegroundColor Red
    Write-Host "`nThe error was saved here:`n$errorLog" -ForegroundColor Yellow
    if($env:MNG_FUT_EMBEDDED -ne '1'){Read-Host 'Press Enter to close'}
    break
}
# Portable/friend preflight. Starting with an existing FIFA process is the most
# common reason the player-head cache cannot be refreshed.
if(Get-Process -Name FIFA17,stp-fifa17 -ErrorAction SilentlyContinue){
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

$gameDir=Split-Path -Parent ([IO.Path]::GetFullPath($GameExe))
$modDataRoot=Resolve-MngRuntimeRoot $gameDir

function Restore-MngLauncherFileWithRetry {
    param(
        [Parameter(Mandatory=$true)][string]$Source,
        [Parameter(Mandatory=$true)][string]$Destination,
        [Parameter(Mandatory=$true)][string]$LogPath,
        [int]$Attempts=40,
        [int]$DelayMs=500
    )

    $lastError=''
    for($attempt=1;$attempt -le $Attempts;$attempt++){
        try {
            Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
            if($attempt -gt 1){
                Add-Content -LiteralPath $LogPath -Value "version.dll restore succeeded after retry $attempt/$Attempts"
            }
            return $true
        } catch {
            $lastError=$_.Exception.Message
            if($attempt -lt $Attempts){Start-Sleep -Milliseconds $DelayMs}
        }
    }

    Add-Content -LiteralPath $LogPath -Value "CLEANUP WARNING: version.dll restore still locked after $Attempts attempts: $lastError"
    Write-Host "Avertissement nettoyage : version.dll est encore utilise. Le launcher ne plante plus; il sera remplace au prochain lancement." -ForegroundColor Yellow
    return $false
}

function Remove-MngLauncherFileWithRetry {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$LogPath,
        [int]$Attempts=40,
        [int]$DelayMs=500
    )

    if(-not(Test-Path -LiteralPath $Path)){return $true}
    $lastError=''
    for($attempt=1;$attempt -le $Attempts;$attempt++){
        try {
            Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
            return $true
        } catch {
            $lastError=$_.Exception.Message
            if($attempt -lt $Attempts){Start-Sleep -Milliseconds $DelayMs}
        }
    }

    Add-Content -LiteralPath $LogPath -Value "CLEANUP WARNING: file remove still locked after $Attempts attempts path=$Path error=$lastError"
    return $false
}

# MNG V54 - compact runtime reconstruction.
# The GitHub Release contains only the files really changed by Frosty. The
# unchanged FIFA 17 files are rebuilt locally as hardlinks, and Data is a
# junction to the player's own installation. No Frosty program is required.
function Initialize-MngCompactRuntime {
    param([string]$ModRoot,[string]$CurrentGameRoot,[string]$LogPath)

    $runtimeManifest=Join-Path $ModRoot 'mng-runtime-manifest.json'
    if(-not(Test-Path -LiteralPath $runtimeManifest -PathType Leaf)){
        return [pscustomobject]@{ Ready=$false; Reason='mng-runtime-manifest.json absent'; Linked=0; Copied=0; Payload=0 }
    }

    try { $manifest=Get-Content -LiteralPath $runtimeManifest -Raw | ConvertFrom-Json }
    catch { throw "Runtime MNG FUT invalide : impossible de lire mng-runtime-manifest.json. $($_.Exception.Message)" }

    if([string]$manifest.version -ne '2.0.3'){
        Add-Content -LiteralPath $LogPath -Value "MNG runtime version detectee=$($manifest.version) (attendue=2.0.3)"
    }

    $gameData=Join-Path $CurrentGameRoot 'Data'
    $runtimeData=Join-Path $ModRoot 'Data'
    if(-not(Test-Path -LiteralPath $gameData -PathType Container)){
        throw "Dossier Data FIFA 17 introuvable : $gameData"
    }

    $needDataLink=$true
    if(Test-Path -LiteralPath $runtimeData){
        $dataItem=Get-Item -LiteralPath $runtimeData -Force
        $isReparse=(($dataItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
        if(-not $isReparse){
            throw "Le runtime contient un vrai dossier Data au lieu d'un lien local : $runtimeData. Supprime ModData\MNGFUT puis reinstalle la mise a jour."
        }
        $targetRaw=$null
        try { $targets=@($dataItem.Target); if($targets.Count -gt 0){$targetRaw=[string]$targets[0]} } catch {}
        $resolvedTarget=$targetRaw
        if($targetRaw -and -not[IO.Path]::IsPathRooted($targetRaw)){
            $resolvedTarget=Join-Path (Split-Path -Parent $runtimeData) $targetRaw
        }
        if($resolvedTarget){
            try {
                $expectedFull=[IO.Path]::GetFullPath($gameData).TrimEnd('\')
                $actualFull=[IO.Path]::GetFullPath($resolvedTarget).TrimEnd('\')
                if($expectedFull -ieq $actualFull){ $needDataLink=$false }
            } catch {}
        }
        if($needDataLink){ Remove-Item -LiteralPath $runtimeData -Force -ErrorAction Stop }
    }
    if($needDataLink){
        New-Item -ItemType Junction -Path $runtimeData -Target $gameData -Force -ErrorAction Stop | Out-Null
        Add-Content -LiteralPath $LogPath -Value "MNG runtime Data junction: $runtimeData -> $gameData"
    }

    $linked=0
    $copied=0
    $payload=0
    $missing=New-Object System.Collections.Generic.List[string]
    foreach($entry in @($manifest.files)){
        $rel=([string]$entry.path).Replace('/','\').TrimStart('\')
        if([string]::IsNullOrWhiteSpace($rel)){ continue }
        $dst=Join-Path $ModRoot $rel
        $mode=[string]$entry.mode

        if($mode -eq 'payload'){
            if(-not(Test-Path -LiteralPath $dst -PathType Leaf)){
                [void]$missing.Add("payload:$rel")
                continue
            }
            if($null -ne $entry.size -and [int64](Get-Item -LiteralPath $dst -Force).Length -ne [int64]$entry.size){
                [void]$missing.Add("payload-size:$rel")
                continue
            }
            $payload++
            continue
        }

        if($mode -notlike 'base*'){ continue }
        $src=Join-Path $CurrentGameRoot $rel
        if(-not(Test-Path -LiteralPath $src -PathType Leaf)){
            [void]$missing.Add("base:$rel")
            continue
        }
        if($null -ne $entry.size -and [int64](Get-Item -LiteralPath $src -Force).Length -ne [int64]$entry.size){
            [void]$missing.Add("base-size:$rel")
            continue
        }

        $reuse=$false
        if(Test-Path -LiteralPath $dst -PathType Leaf){
            try {
                if((Get-Item -LiteralPath $dst -Force).Length -eq (Get-Item -LiteralPath $src -Force).Length){ $reuse=$true }
            } catch {}
        }
        if($reuse){ continue }

        $dstDir=Split-Path -Parent $dst
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
        if(Test-Path -LiteralPath $dst){ Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue }
        try {
            New-Item -ItemType HardLink -Path $dst -Target $src -ErrorAction Stop | Out-Null
            $linked++
        } catch {
            Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop
            $copied++
        }
    }

    if($missing.Count -gt 0){
        Add-Content -LiteralPath $LogPath -Value ("MNG runtime incomplet: " + ($missing -join ', '))
        return [pscustomobject]@{ Ready=$false; Reason=("fichiers absents/incompatibles: " + ($missing -join ', ')); Linked=$linked; Copied=$copied; Payload=$payload }
    }

    $layout=Join-Path $ModRoot 'update\patch\data\layout.toc'
    if(-not(Test-Path -LiteralPath $layout -PathType Leaf)){
        return [pscustomobject]@{ Ready=$false; Reason='update\\patch\\data\\layout.toc absent'; Linked=$linked; Copied=$copied; Payload=$payload }
    }

    Add-Content -LiteralPath $LogPath -Value "MNG runtime ready: version=$($manifest.version) hardlinks=$linked localCopies=$copied payload=$payload"
    return [pscustomobject]@{ Ready=$true; Reason='OK'; Linked=$linked; Copied=$copied; Payload=$payload }
}

$useModData=$false
if($env:MNG_FUT_NO_MODDATA -ne '1'){
    if(-not(Test-Path -LiteralPath $modDataRoot -PathType Container)){
        throw 'Runtime MNG FUT absent. Clique sur INSTALLER LA MISE A JOUR dans MNG FUT Launcher puis relance JOUER.'
    }
    $runtimeState=Initialize-MngCompactRuntime -ModRoot $modDataRoot -CurrentGameRoot $gameDir -LogPath $friendPreflight
    if(-not $runtimeState.Ready){
        throw "Runtime MNG FUT incomplet ou incompatible : $($runtimeState.Reason). Reinstalle la mise a jour depuis le launcher."
    }
    $useModData=$true
}
Add-Content -LiteralPath $friendPreflight -Value "ModDataMNGFUT=$modDataRoot enabled=$useModData requestedOff=$($env:MNG_FUT_NO_MODDATA -eq '1')"
Add-Content -LiteralPath $friendPreflight -Value "PHYSICAL_RUNTIME_ROOT=$modDataRoot"
$ini=Join-Path $gameDir 'senorclutch.ini'
$dll=Join-Path $gameDir 'version.dll'
$payloadDll=Join-Path $root 'payload\version.dll'
$caCertPath=Join-Path $root 'certs\local-server.crt'
$hosts=Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
if (-not (Test-Path -LiteralPath $GameExe)) { throw "FIFA17.exe was not found: $GameExe" }
if (-not (Test-Path -LiteralPath $payloadDll)) { throw 'The bundled FIFA 17 launcher file is missing.' }
if (-not (Test-Path -LiteralPath $caCertPath)) { throw 'The bundled local CA certificate is missing.' }

# MNG V52 - HOSTS/DNS SELF-HEAL
# Some FIFA 17 installs can have an old external mapping such as:
#   3.125.178.170 senorclutch.game
# together with the local mapping. Windows/FIFA can then resolve the external
# address and completely bypass the local Redirector on port 42230.
function Test-MngHostsLineForName {
    param([string]$Line,[string]$Name)

    if([string]::IsNullOrWhiteSpace($Line)){ return $false }
    $active=($Line -split '#',2)[0].Trim()
    if([string]::IsNullOrWhiteSpace($active)){ return $false }

    $parts=@($active -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if($parts.Count -lt 2){ return $false }

    for($i=1;$i-lt $parts.Count;$i++){
        if($parts[$i] -ieq $Name){ return $true }
    }
    return $false
}

function Remove-MngHostsEntries {
    param([string]$Text,[string[]]$Names)

    $kept=New-Object System.Collections.Generic.List[string]
    foreach($line in @($Text -split "`r?`n")){
        # Remove temporary routes left by an interrupted older run.
        if($line -match '#\s*FIFA17-OFFLINE-LOCAL\s*$'){ continue }

        $remove=$false
        foreach($name in $Names){
            if(Test-MngHostsLineForName -Line $line -Name $name){
                $remove=$true
                break
            }
        }
        if(-not $remove){ $kept.Add($line) }
    }
    return ($kept -join "`r`n").TrimEnd("`r","`n")
}

function Invoke-MngDnsFlush {
    param([string]$LogPath,[string]$Reason)

    $ipconfig=Join-Path $env:SystemRoot 'System32\ipconfig.exe'
    $out=@(& $ipconfig /flushdns 2>&1)
    $code=$LASTEXITCODE
    Add-Content -LiteralPath $LogPath -Value "DNS flush ($Reason): exit=$code :: $(($out -join ' ') -replace '\s+',' ')"
    if($code -ne 0){
        throw "Impossible de vider le cache DNS (ipconfig /flushdns, code $code)."
    }
}

function Assert-MngLocalSenorClutch {
    param([string]$LogPath)

    Start-Sleep -Milliseconds 300
    $resolved=@()
    try {
        $resolved=@([System.Net.Dns]::GetHostAddresses('senorclutch.game') |
            ForEach-Object { $_.IPAddressToString } |
            Sort-Object -Unique)
    } catch {
        Add-Content -LiteralPath $LogPath -Value "senorclutch resolver FAILED: $($_.Exception.Message)"
        throw "senorclutch.game ne peut pas etre resolu apres correction du hosts."
    }

    Add-Content -LiteralPath $LogPath -Value "senorclutch resolver: $($resolved -join ', ')"

    $bad=@($resolved | Where-Object { $_ -ne '127.0.0.1' -and $_ -ne '::1' })
    if($resolved -notcontains '127.0.0.1' -or $bad.Count -gt 0){
        throw "Resolution senorclutch.game invalide : $($resolved -join ', '). Attendu uniquement 127.0.0.1."
    }
}

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
[IO.File]::WriteAllText((Join-Path $backup 'hosts.before-mng-fut.txt'),$hostsOriginal,[Text.Encoding]::ASCII)

# Permanent safe base: remove every active senorclutch.game mapping, whether
# external or local, then keep exactly one canonical local mapping.
$hostsSanitizedBase=Remove-MngHostsEntries -Text $hostsOriginal -Names @('senorclutch.game')
if(-not [string]::IsNullOrWhiteSpace($hostsSanitizedBase)){
    $hostsSanitizedBase += "`r`n"
}
$hostsSanitizedBase += '127.0.0.1 senorclutch.game # MNG-FUT-LOCAL-PERSISTENT'
Add-Content -LiteralPath $friendPreflight -Value 'Hosts V52: all active senorclutch.game entries will be replaced by 127.0.0.1.'
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
    $launchMode=if($useModData){'MNG FUT compact runtime ModData\MNGFUT'}else{'MNG FUT diagnostic vanilla mode'}
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

    # Build the in-game hosts from the sanitized base. Remove all active
    # entries for the three local service names first, so an old external IP
    # can never win over 127.0.0.1.
    $hostsForGame=Remove-MngHostsEntries -Text $hostsSanitizedBase -Names @(
        'senorclutch.game',
        'gosca.ea.com',
        'pas.gt.easfc.ea.com'
    )
    $localRoutes=@(
        '127.0.0.1 senorclutch.game # FIFA17-OFFLINE-LOCAL',
        '127.0.0.1 gosca.ea.com # FIFA17-OFFLINE-LOCAL',
        '127.0.0.1 pas.gt.easfc.ea.com # FIFA17-OFFLINE-LOCAL'
    )
    if(-not [string]::IsNullOrWhiteSpace($hostsForGame)){
        $hostsForGame += "`r`n"
    }
    $hostsForGame += ($localRoutes -join "`r`n")
    [IO.File]::WriteAllText($hosts,$hostsForGame,[Text.Encoding]::ASCII)

    Invoke-MngDnsFlush -LogPath $friendPreflight -Reason 'before FIFA launch'
    Assert-MngLocalSenorClutch -LogPath $friendPreflight
    Write-Host 'Network fix OK: senorclutch.game -> 127.0.0.1' -ForegroundColor Green

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
        $launchMode='VANILLA'

        if($useModData -and $launchAttempt -eq 1){
            # MNG compact runtime uses GAME_DATA_DIR; no Frosty executable is involved.
            # Keep a relative -dataPath fallback for FIFA builds that ignore the environment variable.
            $launchMode='GAME_DATA_DIR'
            Write-Host "MNG FUT: runtime MNG via GAME_DATA_DIR -> $modDataRoot" -ForegroundColor Green
            $oldGameDataDir=$env:GAME_DATA_DIR
            try {
                $env:GAME_DATA_DIR=$modDataRoot
                $game=Start-OrWait-MngFifa -FilePath $GameExe -WorkingDirectory $gameDir
            } finally {
                if($null -eq $oldGameDataDir){
                    Remove-Item Env:\GAME_DATA_DIR -ErrorAction SilentlyContinue
                }else{
                    $env:GAME_DATA_DIR=$oldGameDataDir
                }
            }
        }elseif($useModData -and $launchAttempt -eq 2){
            # Second runtime mode: relative datapath from FIFA17.exe.
            $launchMode='DATAPATH_RELATIVE'
            Write-Host 'MNG FUT: seconde tentative runtime via -dataPath "ModData\MNGFUT"...' -ForegroundColor Yellow
            if([IO.Path]::GetFullPath($modDataRoot).StartsWith([IO.Path]::GetFullPath($gameDir),[StringComparison]::OrdinalIgnoreCase)){
                if([IO.Path]::GetFullPath($modDataRoot).StartsWith([IO.Path]::GetFullPath($gameDir),[StringComparison]::OrdinalIgnoreCase)){
                $gameArgs=@('-dataPath','"ModData\MNGFUT"')
            }else{
                Write-Host "MNG FUT: -dataPath LOCALAPPDATA -> $modDataRoot" -ForegroundColor Yellow
                $gameArgs=@('-dataPath',"`"$modDataRoot`"")
            }
            }else{
                Write-Host "MNG FUT: -dataPath LOCALAPPDATA -> $modDataRoot" -ForegroundColor Yellow
                $gameArgs=@('-dataPath',"`"$modDataRoot`"")
            }
            $game=Start-OrWait-MngFifa -FilePath $GameExe -WorkingDirectory $gameDir -ArgumentList $gameArgs
        }else{
            if($useModData){
                throw 'Les deux modes du runtime MNG FUT ont echoue. Reinstalle la mise a jour puis relance le jeu.'
            }else{
                Write-Host 'MNG FUT: mode diagnostic sans runtime demande par MNG_FUT_NO_MODDATA=1.' -ForegroundColor Yellow
            }
            Write-Host 'Local prototype is running. Starting FIFA 17...' -ForegroundColor Cyan
            $game=Start-OrWait-MngFifa -FilePath $GameExe -WorkingDirectory $gameDir
        }

        $attemptUseModData=($launchMode -ne 'VANILLA')
        Add-Content -LiteralPath $friendPreflight -Value "Mode lancement: tentative=$launchAttempt mode=$launchMode mngmodruntime=$attemptUseModData"
        $launchStartedAt=Get-Date
        $trackedGamePids=[Collections.Generic.HashSet[int]]::new()
        $relayCount=0
        $finalExitCode=$null
        while($game){
            $trackedProcessStartedAt=Get-Date
            [void]$trackedGamePids.Add([int]$game.Id)
            Add-Content -LiteralPath $friendPreflight -Value "Suivi FIFA: tentative=$launchAttempt pid=$($game.Id) relais=$relayCount"
            $monitorArgs="-NoProfile -ExecutionPolicy Bypass -File `"$routeTool`" -ProcessId $($game.Id) -OutputPath `"$routeLog`""
            $monitor=Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList $monitorArgs
            $moduleArgs="-NoProfile -ExecutionPolicy Bypass -File `"$moduleTool`" -ProcessId $($game.Id) -OutputPath `"$moduleLog`""
            $moduleMonitor=Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList $moduleArgs
            $game.WaitForExit()
            $exitCode=$game.ExitCode
            $trackedProcessSeconds=((Get-Date)-$trackedProcessStartedAt).TotalSeconds
            if($moduleMonitor -and -not $moduleMonitor.HasExited){Stop-Process -Id $moduleMonitor.Id -Force -ErrorAction SilentlyContinue}
            if($monitor -and -not $monitor.HasExited){Stop-Process -Id $monitor.Id -Force -ErrorAction SilentlyContinue}

            $replacementGame=$null
            $elapsedSeconds=((Get-Date)-$launchStartedAt).TotalSeconds
            $unknownRelayExit=($null -eq $exitCode -and $relayCount -gt 0)
            $relayExit=($exitCode -eq 0 -or $exitCode -eq -6 -or $exitCode -eq 42 -or $unknownRelayExit)
            if($relayExit -and $elapsedSeconds -lt 30 -and $relayCount -lt 8){
                $relayDeadline=(Get-Date).AddSeconds(15)
                do {
                    Start-Sleep -Milliseconds 100
                    $replacementGame=Get-Process -Name FIFA17,stp-fifa17 -ErrorAction SilentlyContinue |
                        Where-Object { -not $trackedGamePids.Contains([int]$_.Id) -and $_.StartTime -ge $launchStartedAt.AddSeconds(-1) } |
                        Sort-Object StartTime -Descending |
                        Select-Object -First 1
                } while(-not $replacementGame -and (Get-Date) -lt $relayDeadline)
            }
            if($replacementGame){
                $relayCount++
                Add-Content -LiteralPath $friendPreflight -Value "Processus FIFA relais: ancienPid=$($game.Id) nouveauPid=$($replacementGame.Id) code=$exitCode dureeProcessus=$([Math]::Round($trackedProcessSeconds,1))s relais=$relayCount"
                Write-Host "MNG FUT: processus FIFA relais detecte (PID $($replacementGame.Id))." -ForegroundColor Cyan
                $game=$replacementGame
                continue
            }
            $finalExitCode=if($null -eq $exitCode -and $relayCount -gt 0){-6}else{$exitCode}
            Add-Content -LiteralPath $friendPreflight -Value "Fin FIFA: pid=$($game.Id) code=$finalExitCode codeNatif=$exitCode dureeProcessus=$([Math]::Round($trackedProcessSeconds,1))s dureeTotale=$([Math]::Round($elapsedSeconds,1))s relais=$relayCount"
            break
        }
        $nativeEarlyExit=($finalExitCode -eq -6 -or $finalExitCode -eq 42)
        if($useModData){
            # Try GAME_DATA_DIR, then relative -dataPath. Do not silently fall back to vanilla.
            $retryEarlyNativeExit=($nativeEarlyExit -and $attemptUseModData -and $elapsedSeconds -lt 600 -and $launchAttempt -lt 2)
        }else{
            # Preserve the old one-time retry if there is no ModData at all.
            $retryEarlyNativeExit=($nativeEarlyExit -and $elapsedSeconds -lt 30 -and $launchAttempt -lt 2)
        }

        if($retryEarlyNativeExit){
            Add-Content -LiteralPath $friendPreflight -Value "Relance complete automatique: code=$finalExitCode duree=$([Math]::Round($elapsedSeconds,1))s tentative=$launchAttempt mode=$launchMode relais=$relayCount"
            if($useModData -and $launchAttempt -eq 1){
                Write-Host 'Runtime GAME_DATA_DIR a echoue. Essai automatique avec -dataPath relatif...' -ForegroundColor Yellow
            }elseif($useModData -and $launchAttempt -eq 2){
                Write-Host 'Runtime -dataPath a echoue.' -ForegroundColor Yellow
            }else{
                Write-Host 'La chaine de demarrage a echoue trop tot. Nouvelle tentative automatique...' -ForegroundColor Yellow
            }
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
    if($dllExisted -and (Test-Path (Join-Path $backup 'version.dll'))){
        [void](Restore-MngLauncherFileWithRetry -Source (Join-Path $backup 'version.dll') -Destination $dll -LogPath $friendPreflight)
    }
    elseif($dllInstalledByLauncher -and (Test-Path -LiteralPath $dll)){
        [void](Remove-MngLauncherFileWithRetry -Path $dll -LogPath $friendPreflight)
    }
    if($caInstalledByLauncher -and (Test-Path -LiteralPath $trustedCaPath)){Remove-Item -LiteralPath $trustedCaPath -Force -ErrorAction SilentlyContinue}
    # Keep senorclutch.game repaired after FIFA closes. Temporary gosca/PAS
    # routes are removed because hostsSanitizedBase contains only the persistent
    # senorclutch local mapping plus the user's unrelated original entries.
    [IO.File]::WriteAllText($hosts,$hostsSanitizedBase,[Text.Encoding]::ASCII)
    try { Invoke-MngDnsFlush -LogPath $friendPreflight -Reason 'after FIFA cleanup' } catch {
        Add-Content -LiteralPath $friendPreflight -Value "DNS cleanup warning: $($_.Exception.Message)"
    }
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
if($launchMutexOwned -and $launchMutex){
    try {$launchMutex.ReleaseMutex()} catch {}
    $launchMutexOwned=$false
}
if($launchMutex){
    try {$launchMutex.Dispose()} catch {}
    $launchMutex=$null
}
if($env:MNG_FUT_EMBEDDED -ne '1'){Read-Host 'Press Enter to close'}
