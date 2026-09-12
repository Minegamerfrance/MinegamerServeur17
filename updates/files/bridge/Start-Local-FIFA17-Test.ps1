param([string]$GameExe='')

$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$launcherRoot=Split-Path -Parent $root
$bridgeExe=Join-Path $root 'MNGBridge.exe'
$errorLog=Join-Path $root 'BRIDGE-ERROR.txt'

function Info([string]$m){Write-Host "[INFO] $m" -ForegroundColor Cyan}
function Ok([string]$m){Write-Host "[OK] $m" -ForegroundColor Green}
function Warn([string]$m){Write-Host "[WARN] $m" -ForegroundColor Yellow}

if(-not $GameExe){
    foreach($settingsPath in @((Join-Path $launcherRoot 'launcher-settings.json'),(Join-Path $root 'launcher-settings.json'))){
        if(Test-Path -LiteralPath $settingsPath){
            try{
                $s=Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
                $GameExe=[string]$s.GameExe
                if(-not $GameExe){$GameExe=[string]$s.gameExe}
            }catch{}
            if($GameExe){break}
        }
    }
}

if(-not $GameExe){
    throw 'FIFA17.exe n est pas configure dans le launcher.'
}

if(-not(Test-Path -LiteralPath $bridgeExe -PathType Leaf)){
    throw "MNGBridge.exe introuvable : $bridgeExe"
}

# Le bridge et le script de lancement doivent tourner en administrateur, car
# la chaine FIFA modifie temporairement hosts / certificat / version.dll.
$isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $isAdmin){
    $args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-GameExe',"`"$GameExe`"")
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args
    exit 0
}

# Migration propre des anciennes installations. Le dossier du bridge ne garde
# que les donnees de l'utilisateur, les logs et les trois fichiers du bridge.
$marker=Join-Path $root '.mng-bridge-mode-v1'
if(-not(Test-Path -LiteralPath $marker)){
    Info 'Migration vers le mode MNG Bridge...'

    foreach($f in @('fut-backend.js','local-server.js','mng-online-images.js','mng-online-packs.js','mng-sbc-set-images.js','launcher-update-test.txt')){
        $p=Join-Path $root $f
        if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue}
    }
    foreach($d in @('certs','payload','runtime','tools')){
        $p=Join-Path $root $d
        if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue}
    }

    $dataDir=Join-Path $root 'data'
    if(Test-Path -LiteralPath $dataDir){
        $keep=@('mng-cloud-session.json','mng-cloud-club.json','fut-first-run-trace.json','profiles')
        Get-ChildItem -LiteralPath $dataDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
            if($keep -notcontains $_.Name){
                Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    [IO.File]::WriteAllText($marker,(Get-Date -Format o),(New-Object Text.UTF8Encoding($false)))
    Ok 'Ancien serveur local retire. Donnees joueur conservees.'
}

try{
    Info 'Demarrage du MNG Bridge securise...'
    & $bridgeExe '-game-exe' $GameExe
    $code=$LASTEXITCODE
    if($code -ne 0){throw "MNGBridge.exe a quitte avec le code $code"}
}catch{
    $msg="MNG Bridge n a pas pu demarrer.`r`n`r`n$($_.Exception.Message)`r`n`r`nDate: $(Get-Date -Format o)"
    Set-Content -LiteralPath $errorLog -Value $msg -Encoding UTF8
    Write-Host $msg -ForegroundColor Red
    Write-Host "`nRapport : $errorLog" -ForegroundColor Yellow
    if($env:MNG_FUT_EMBEDDED -ne '1'){Read-Host 'ENTREE pour fermer'}
    exit 1
}
