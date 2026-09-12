param([string]$GameExe='')

$ErrorActionPreference='Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$root=$PSScriptRoot
$bridgeExe=Join-Path $root 'MNGBridge.exe'
$errorLog=Join-Path $root 'BRIDGE-ERROR.txt'
$dataDir=Join-Path $root 'data'
$marker=Join-Path $root '.mng-bridge-oneclick-v22'
# MNG_2_1_25_PERSISTENT_CLOUD_STATE
$persistentStateRoot=Join-Path $env:LOCALAPPDATA 'MNGFUTLauncher'
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
            # Migration d'une ancienne installation : conserve la session existante.
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
    $candidateRoots=@((Split-Path -Parent $root), (Get-Location).Path)
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

try{
    Info 'Starting MNG Secure Bridge...'
    & $bridgeExe '-game-exe' $GameExe
    $code=$LASTEXITCODE
    Sync-MngPersistentCloudStateFromBridge
    if($code -ne 0){throw "MNGBridge.exe exited with code $code"}

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
    Ok 'MNG FUT session completed successfully.'
}catch{
    $msg="MNG Bridge could not start.`r`n`r`n$($_.Exception.Message)`r`n`r`nDate: $(Get-Date -Format o)"
    [IO.File]::WriteAllText($errorLog,$msg,(New-Object Text.UTF8Encoding($false)))
    Write-Host $msg -ForegroundColor Red
    Write-Host "`nReport: $errorLog" -ForegroundColor Yellow
    if($env:MNG_FUT_EMBEDDED -ne '1'){Read-Host 'ENTER to close'}
    exit 1
}
