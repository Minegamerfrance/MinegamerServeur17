$ErrorActionPreference='Stop'
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Need($name){
  $cmd=Get-Command $name -ErrorAction SilentlyContinue
  if(-not $cmd){throw "$name introuvable. Installe Node.js LTS avant de continuer."}
}

Need node
Need npm

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " MNG FUT FULL CLOUD SAVE 2.1.0 - DEPLOIEMENT CLOUDFLARE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if(-not(Test-Path node_modules)){
  Write-Host "Installation de Wrangler..." -ForegroundColor Yellow
  npm install
  if($LASTEXITCODE-ne0){throw "npm install a echoue."}
}

Write-Host "Verification connexion Cloudflare..." -ForegroundColor Yellow
npx wrangler whoami
if($LASTEXITCODE-ne0){
  Write-Host ""
  Write-Host "Connexion Cloudflare requise. Une page web va s'ouvrir." -ForegroundColor Yellow
  npx wrangler login
  if($LASTEXITCODE-ne0){throw "Connexion Cloudflare annulee."}
}

$config=Join-Path $here 'wrangler.jsonc'
$raw=Get-Content -LiteralPath $config -Raw -Encoding UTF8
if($raw -match 'PASTE_D1_DATABASE_ID_HERE'){
  Write-Host ""
  Write-Host "Creation de la base D1 mng-fut-full-save..." -ForegroundColor Yellow
  $output = (& npx wrangler d1 create mng-fut-full-save 2>&1 | Out-String)
  Write-Host $output

  $m=[regex]::Match($output,'database_id["''\s:=]+([0-9a-fA-F-]{36})')
  if(-not $m.Success){
    Write-Host ""
    Write-Host "Je n'ai pas pu extraire automatiquement le database_id." -ForegroundColor Red
    Write-Host "Copie le database_id affiche ci-dessus et colle-le dans wrangler.jsonc" -ForegroundColor Yellow
    Write-Host "a la place de PASTE_D1_DATABASE_ID_HERE, puis relance ce BAT." -ForegroundColor Yellow
    pause
    exit 2
  }

  $databaseId=$m.Groups[1].Value
  $raw=$raw.Replace('PASTE_D1_DATABASE_ID_HERE',$databaseId)
  Set-Content -LiteralPath $config -Value $raw -Encoding UTF8
  Write-Host "OK - database_id ajoute automatiquement : $databaseId" -ForegroundColor Green
}

Write-Host ""
Write-Host "Application de la migration D1..." -ForegroundColor Yellow
npx wrangler d1 migrations apply mng-fut-full-save --remote
if($LASTEXITCODE-ne0){throw "Migration D1 echouee."}

Write-Host ""
Write-Host "Deploiement du Worker..." -ForegroundColor Yellow
npx wrangler deploy
if($LASTEXITCODE-ne0){throw "Deploiement Worker echoue."}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " CLOUD FULL SAVE DEPLOYE" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "URL attendue :" -ForegroundColor White
Write-Host "https://mng-fut-full-save.minegamerfrance.workers.dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Test :" -ForegroundColor White
Write-Host "https://mng-fut-full-save.minegamerfrance.workers.dev/health" -ForegroundColor Cyan
Write-Host ""
pause
