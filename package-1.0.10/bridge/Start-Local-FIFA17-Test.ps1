param([string]$GameExe='')

$ErrorActionPreference='Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$root=$PSScriptRoot
$bridgeExe=Join-Path $root 'MNGBridge.exe'
$errorLog=Join-Path $root 'BRIDGE-ERROR.txt'
$runtimeLog=Join-Path $root 'BRIDGE-RUNTIME.log'
$bridgeConfig=Join-Path $root 'bridge-config.json'
$bridgeConfigOriginal=$null
$dataDir=Join-Path $root 'data'
$marker=Join-Path $root '.mng-bridge-oneclick-v22'

function Add-MngCacheBuster([string]$Url,[string]$Token){
    if([string]::IsNullOrWhiteSpace($Url)){return $Url}
    $clean=$Url -replace '([?&])mng=[^&]*',''
    $clean=$clean.TrimEnd('?','&')
    if($clean.Contains('?')){return "${clean}&mng=$Token"}
    return "${clean}?mng=$Token"
}

function Enable-MngBridgeNoCacheConfig {
    if(-not(Test-Path -LiteralPath $bridgeConfig -PathType Leaf)){return}

    $script:bridgeConfigOriginal=Get-Content -LiteralPath $bridgeConfig -Raw
    $cfg=$script:bridgeConfigOriginal | ConvertFrom-Json
    $token=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()

    if($cfg.PSObject.Properties.Name -contains 'serverManifestUrl'){
        $cfg.serverManifestUrl=Add-MngCacheBuster ([string]$cfg.serverManifestUrl) $token
    }
    if($cfg.PSObject.Properties.Name -contains 'serverManifestSigUrl'){
        $cfg.serverManifestSigUrl=Add-MngCacheBuster ([string]$cfg.serverManifestSigUrl) $token
    }

    $json=$cfg | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($bridgeConfig,$json,(New-Object Text.UTF8Encoding($false)))

    Info "GitHub manifest cache-buster: $token"
}

function Restore-MngBridgeConfig {
    if($null -ne $script:bridgeConfigOriginal){
        try{
            [IO.File]::WriteAllText(
                $bridgeConfig,
                [string]$script:bridgeConfigOriginal,
                (New-Object Text.UTF8Encoding($false))
            )
        }catch{}
        $script:bridgeConfigOriginal=$null
    }
}

# MNG_FINAL_BUNDLED_BRIDGE_PERSISTENT_STATE
$persistentStateRoot=Join-Path $env:LOCALAPPDATA 'MNGFUTLauncher'
$localRuntimeRoot=Join-Path $persistentStateRoot 'runtime\MNGFUT'
$persistentCloudNames=@('mng-cloud-session.json','mng-cloud-club.json')

function Sync-MngPersistentCloudStateToBridge {
    New-Item -ItemType Directory -Path $persistentStateRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    foreach($name in $persistentCloudNames){
        $persistent=Join-Path $persistentStateRoot $name
        $bridgeCopy=Join-Path $dataDir $name
        if(Test-Path -LiteralPath $persistent -PathType Leaf){
            Copy-Item -LiteralPath $persistent -Destination $bridgeCopy -Force
        }elseif(Test-Path -LiteralPath $bridgeCopy -PathType Leaf){
            Copy-Item -LiteralPath $bridgeCopy -Destination $persistent -Force
        }
    }
}
function Sync-MngPersistentCloudStateFromBridge {
    New-Item -ItemType Directory -Path $persistentStateRoot -Force | Out-Null
    foreach($name in $persistentCloudNames){
        $bridgeCopy=Join-Path $dataDir $name
        if(Test-Path -LiteralPath $bridgeCopy -PathType Leaf){
            Copy-Item -LiteralPath $bridgeCopy -Destination (Join-Path $persistentStateRoot $name) -Force
        }
    }
}
function Remove-MngCloudCopiesFromPortableBridge {
    foreach($name in $persistentCloudNames){
        $bridgeCopy=Join-Path $dataDir $name
        if(Test-Path -LiteralPath $bridgeCopy -PathType Leaf){
            Remove-Item -LiteralPath $bridgeCopy -Force -ErrorAction SilentlyContinue
        }
    }
}

function Info([string]$m){Write-Host "[INFO] $m" -ForegroundColor Cyan}
function Ok([string]$m){Write-Host "[OK] $m" -ForegroundColor Green}
function Warn([string]$m){Write-Host "[WARN] $m" -ForegroundColor Yellow}

function Copy-PlayerData([string]$legacyRoot){
    if(-not(Test-Path -LiteralPath $legacyRoot -PathType Container)){return $false}
    $legacyData=Join-Path $legacyRoot 'data'
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    if(Test-Path -LiteralPath $legacyData -PathType Container){
        Get-ChildItem -LiteralPath $legacyData -File -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -eq 'fut-first-run-trace.json' -or $_.Name -like 'mng-cloud-*.json' -or $_.Name -like 'mng-founder-*.json'
        } | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dataDir $_.Name) -Force
        }
        foreach($dirName in @('profiles','reset-backups')){
            $src=Join-Path $legacyData $dirName
            if(Test-Path -LiteralPath $src -PathType Container){
                Copy-Item -LiteralPath $src -Destination $dataDir -Recurse -Force
            }
        }
    }
    return $true
}

if(-not $GameExe){
    # The launcher normally passes -GameExe. Fallback to any settings file nearby.
    $candidateRoots=@($persistentStateRoot, (Split-Path -Parent $root), (Get-Location).Path)
    foreach($base in $candidateRoots){
        foreach($name in @('launcher-oneclick.json','launcher-settings.json')){
            $settingsPath=Join-Path $base $name
            if(Test-Path -LiteralPath $settingsPath){
                try{
                    $s=Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
                    $GameExe=[string]$s.GameExe
                    if(-not $GameExe){$GameExe=[string]$s.gameExe}
                }catch{}
                if($GameExe){break}
            }
        }
        if($GameExe){break}
    }
}

if(-not $GameExe){throw 'FIFA17.exe is not configured in the launcher.'}
if(-not(Test-Path -LiteralPath $GameExe -PathType Leaf)){throw "FIFA17.exe not found: $GameExe"}
if(-not(Test-Path -LiteralPath $bridgeExe -PathType Leaf)){throw "MNGBridge.exe not found: $bridgeExe"}

# Elevation is automatic; the player still launches only MNG FUT Launcher.exe.
$isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $isAdmin){
    $args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-GameExe',"`"$GameExe`"")
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args
    exit 0
}

# 3.0.4 cross-process launch/session lock.
$sessionLock=$null
try{
    $lockRoot=Join-Path $env:TEMP 'MNGFUT'
    New-Item -ItemType Directory -Path $lockRoot -Force | Out-Null
    $lockPath=Join-Path $lockRoot 'bridge-session.lock'
    $sessionLock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
}catch{
    throw 'Une autre session MNG FUT est deja en cours de demarrage ou active.'
}

# 3.0.4: never kill a Bridge that may still be starting.
# A second click/launcher instance must not cancel the first launch.
$runningBridge=@(Get-Process -Name 'MNGBridge' -ErrorAction SilentlyContinue)
if($runningBridge.Count -gt 0){
    $runningFifa=@(Get-Process -Name 'FIFA17','stp-fifa17' -ErrorAction SilentlyContinue)
    if($runningFifa.Count -gt 0){
        throw 'Une session MNG FUT/FIFA 17 est deja active. Ferme FIFA 17 avant de relancer.'
    }
    throw 'MNG Bridge est deja en cours de demarrage. Attends le lancement de FIFA 17.'
}

# Remove ONLY obsolete Bridge binaries left by older launchers in LOCALAPPDATA.
# Keep settings, session, backups and player data.
if($env:LOCALAPPDATA){
    $oldBridgeRoot=Join-Path $env:LOCALAPPDATA 'MNGFUTLauncher'
    if([IO.Path]::GetFullPath($oldBridgeRoot) -ine [IO.Path]::GetFullPath($root)){
        foreach($oldName in @('MNGBridge.exe','Start-Local-FIFA17-Test.ps1','bridge-config.json','BRIDGE-ERROR.txt')){
            $oldFile=Join-Path $oldBridgeRoot $oldName
            if(Test-Path -LiteralPath $oldFile -PathType Leaf){
                Remove-Item -LiteralPath $oldFile -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# Automatic migration from the legacy permanent server. No BAT or manual cleanup required.
$legacyRoots=New-Object System.Collections.Generic.List[string]
if($env:LOCALAPPDATA){
    $legacy=Join-Path $env:LOCALAPPDATA 'MNGFUTLauncher\server'
    if((Test-Path -LiteralPath $legacy -PathType Container) -and ([IO.Path]::GetFullPath($legacy) -ine [IO.Path]::GetFullPath($root))){$legacyRoots.Add($legacy)}
}
foreach($legacy in $legacyRoots){
    Info "Legacy MNG FUT server detected: $legacy"
    try{
        [void](Copy-PlayerData $legacy)
        Remove-Item -LiteralPath $legacy -Recurse -Force
        Ok 'Legacy server removed; player data preserved.'
    }catch{
        Warn "Legacy cleanup skipped: $($_.Exception.Message)"
    }
}

# The persistent bridge may keep only bridge components + player state/logs.
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
foreach($f in @('fut-backend.js','local-server.js','mng-online-images.js','mng-online-packs.js','mng-sbc-set-images.js','launcher-update-test.txt')){
    $p=Join-Path $root $f
    if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue}
}
foreach($d in @('certs','payload','runtime','tools')){
    $p=Join-Path $root $d
    if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue}
}
if(Test-Path -LiteralPath $dataDir){
    Get-ChildItem -LiteralPath $dataDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $keep=$false
        if($_.PSIsContainer){$keep=$_.Name -in @('profiles','reset-backups')}
        else{$keep=($_.Name -eq 'fut-first-run-trace.json' -or $_.Name -like 'mng-cloud-*.json' -or $_.Name -like 'mng-founder-*.json')}
        if(-not $keep){Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue}
    }
}
Sync-MngPersistentCloudStateToBridge
[IO.File]::WriteAllText($marker,(Get-Date -Format o),(New-Object Text.UTF8Encoding($false)))
if(Test-Path -LiteralPath $errorLog){Remove-Item -LiteralPath $errorLog -Force -ErrorAction SilentlyContinue}
if(Test-Path -LiteralPath $runtimeLog){Remove-Item -LiteralPath $runtimeLog -Force -ErrorAction SilentlyContinue}

try{
    $env:MNG_FUT_BRIDGE_OWNS_GAME='1'
    $env:MNG_FUT_NO_MODDATA='1'
    Info 'Server-only mode: ModData disabled; FIFA starts separately.'
    Enable-MngBridgeNoCacheConfig
    Info 'Starting MNG Secure Bridge...'

    # 3.0.8: the Bridge console is hidden for players, so persist its native
    # stdout/stderr. On code 1 we can finally see the REAL cause instead of
    # only "MNGBridge.exe exited with code 1".
    $env:MNG_FUT_SERVER_ONLY='1'
    & $bridgeExe '-game-exe' $GameExe 2>&1 | Tee-Object -FilePath $runtimeLog
    $code=$LASTEXITCODE
    Restore-MngBridgeConfig

    Sync-MngPersistentCloudStateFromBridge
    Remove-MngCloudCopiesFromPortableBridge

    if($code -ne 0){
        $tail=''
        try{
            if(Test-Path -LiteralPath $runtimeLog){
                $tail=((Get-Content -LiteralPath $runtimeLog -Tail 40 -ErrorAction SilentlyContinue) -join "`r`n")
            }
        }catch{}
        if($tail){
            throw "MNGBridge.exe exited with code $code`r`n`r`n--- BRIDGE RUNTIME ---`r`n$tail"
        }
        throw "MNGBridge.exe exited with code $code"
    }

    # Final automatic cleanup: no verification script required for players.
    $tempRoot=Join-Path $env:TEMP 'MNGFUT'
    if(Test-Path -LiteralPath $tempRoot){
        Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'server-*' -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    Get-ChildItem -LiteralPath $root -Recurse -File -Include *.js -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
    if($env:LOCALAPPDATA){
        $old=Join-Path $env:LOCALAPPDATA 'MNGFUTLauncher\server'
        if(Test-Path -LiteralPath $old){Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue}
    }

    $temps=@(Get-ChildItem (Join-Path $env:TEMP 'MNGFUT') -Directory -ErrorAction SilentlyContinue)
    $js=@(Get-ChildItem $root -Recurse -File -Include *.js -ErrorAction SilentlyContinue)
    $legacyLeft=$false
    if($env:LOCALAPPDATA){$legacyLeft=Test-Path (Join-Path $env:LOCALAPPDATA 'MNGFUTLauncher\server')}
    if((-not $legacyLeft) -and $temps.Count -eq 0 -and $js.Count -eq 0){
        Ok 'Secure Bridge cleanup validated: no permanent server, no TEMP session, no JS source.'
    }else{
        Warn "Cleanup check: legacy=$legacyLeft temp=$($temps.Count) js=$($js.Count)"
    }
    if(Test-Path -LiteralPath $errorLog){Remove-Item -LiteralPath $errorLog -Force -ErrorAction SilentlyContinue}
    try{if($sessionLock){$sessionLock.Dispose();$sessionLock=$null}}catch{}
    Remove-Item Env:\MNG_FUT_NO_MODDATA -ErrorAction SilentlyContinue
    Remove-Item Env:\MNG_FUT_BRIDGE_OWNS_GAME -ErrorAction SilentlyContinue
    Ok 'MNG FUT session completed successfully.'
}catch{
    Restore-MngBridgeConfig
    Remove-Item Env:\MNG_FUT_NO_MODDATA -ErrorAction SilentlyContinue
    try{if($sessionLock){$sessionLock.Dispose();$sessionLock=$null}}catch{}
    try{ Sync-MngPersistentCloudStateFromBridge }catch{}
    try{ Remove-MngCloudCopiesFromPortableBridge }catch{}
    Remove-Item Env:\MNG_FUT_BRIDGE_OWNS_GAME -ErrorAction SilentlyContinue
    $msg="MNG Bridge could not start.`r`n`r`n$($_.Exception.Message)`r`n`r`nDate: $(Get-Date -Format o)"
    [IO.File]::WriteAllText($errorLog,$msg,(New-Object Text.UTF8Encoding($false)))
    Write-Host $msg -ForegroundColor Red
    Write-Host "`nReport: $errorLog" -ForegroundColor Yellow
    # 3.0.1: no hidden Read-Host; write BRIDGE-ERROR.txt and exit immediately.
    exit 1
}
