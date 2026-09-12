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

if(-not $GameExe){throw 'FIFA17.exe n est pas configure dans le launcher.'}
if(-not(Test-Path -LiteralPath $bridgeExe -PathType Leaf)){throw "MNGBridge.exe introuvable : $bridgeExe"}

# Le bridge et la chaine FIFA ont besoin des droits administrateur pour les
# modifications temporaires de hosts/certificat/version.dll.
$isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $isAdmin){
    $args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-GameExe',"`"$GameExe`"")
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args
    exit 0
}

# Nettoyage/migration locale : le dossier bridge ne garde que l'etat joueur,
# les logs/results et les composants du bridge. Les sources serveur ne doivent
# jamais y rester.
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
        Get-ChildItem -LiteralPath $dataDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
            $keep=$false
            if($_.PSIsContainer){
                $keep=$_.Name -in @('profiles','reset-backups')
            }else{
                $keep=($_.Name -eq 'fut-first-run-trace.json' -or $_.Name -like 'mng-cloud-*.json' -or $_.Name -like 'mng-founder-*.json')
            }
            if(-not $keep){Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue}
        }
    }

    [IO.File]::WriteAllText($marker,(Get-Date -Format o),(New-Object Text.UTF8Encoding($false)))
    Ok 'Ancien serveur local retire. Donnees joueur conservees.'
}

# Un ancien rapport d'erreur ne doit pas faire croire qu'un nouveau lancement a echoue.
if(Test-Path -LiteralPath $errorLog){Remove-Item -LiteralPath $errorLog -Force -ErrorAction SilentlyContinue}

try{
    Info 'Demarrage du MNG Bridge securise...'
    & $bridgeExe '-game-exe' $GameExe
    $code=$LASTEXITCODE
    if($code -ne 0){throw "MNGBridge.exe a quitte avec le code $code"}
    if(Test-Path -LiteralPath $errorLog){Remove-Item -LiteralPath $errorLog -Force -ErrorAction SilentlyContinue}
    Ok 'Session MNG Bridge terminee proprement.'
}catch{
    $msg="MNG Bridge n a pas pu demarrer.`r`n`r`n$($_.Exception.Message)`r`n`r`nDate: $(Get-Date -Format o)"
    [IO.File]::WriteAllText($errorLog,$msg,(New-Object Text.UTF8Encoding($false)))
    Write-Host $msg -ForegroundColor Red
    Write-Host "`nRapport : $errorLog" -ForegroundColor Yellow
    if($env:MNG_FUT_EMBEDDED -ne '1'){Read-Host 'ENTREE pour fermer'}
    exit 1
}
