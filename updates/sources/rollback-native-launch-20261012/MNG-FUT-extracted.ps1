$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression.FileSystem

$launcherPath = [string]$MyInvocation.MyCommand.Path
if([string]::IsNullOrWhiteSpace($launcherPath)){
    try{$launcherPath=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName}catch{}
}
if([string]::IsNullOrWhiteSpace($launcherPath)){$launcherPath=[string]$PSCommandPath}
if([string]::IsNullOrWhiteSpace($launcherPath)){$launcherPath=Join-Path (Get-Location) 'MNG FUT.exe'}
$script:AppRoot = Split-Path -Parent $launcherPath
if($env:MNG_FUT_LAUNCHER_ROOT){ $script:AppRoot = $env:MNG_FUT_LAUNCHER_ROOT }
$script:StateRoot = Join-Path $env:LOCALAPPDATA 'MNGFUTLauncher'
$script:SessionPath = Join-Path $script:StateRoot 'mng-cloud-session.json'
$script:SettingsPath = Join-Path $script:StateRoot 'launcher-oneclick.json'
$script:SocialApi = 'https://mng-fut-social.minegamerfrance.workers.dev'
$script:AuthApiDefault = 'https://mng-fut-api.minegamerfrance.workers.dev'
$script:Session = $null
$script:Profile = $null
$script:FriendsOpen = $false
$script:PendingFriendRequests = 0
$script:AccountOpen = $false
$script:LastPresence = ''
$script:Refreshing = $false
$script:Lang = 'en'
$script:ServerProcess = $null
$script:SelectedGame = '17'
$script:ActiveServerGame = ''
$script:LauncherVersion = '1.3.13'
$script:ThemeAccent = '#DDFD45'
$script:NotificationsUrl = 'https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/notifications.json'
$script:NotificationsSeenPath = Join-Path $script:StateRoot 'notifications-seen.json'
$script:Notifications = @()
$script:InstallManifestUrl = 'https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/manifest.json'
$script:ServerManifestUrl = 'https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/bridge-server-manifest.json'
$script:LauncherManifestUrl = 'https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/launcher-manifest.json'
$script:GameServerManifestUrl = 'https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/game-servers-manifest.json'
New-Item -ItemType Directory -Force -Path $script:StateRoot | Out-Null

function Read-JsonFile([string]$Path){
    if(-not(Test-Path -LiteralPath $Path)){ return $null }
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { return $null }
}
function Write-JsonFile([string]$Path,$Object){
    $dir=Split-Path -Parent $Path
    if($dir){New-Item -ItemType Directory -Force -Path $dir | Out-Null}
    $json=$Object | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($Path,$json,(New-Object Text.UTF8Encoding($false)))
}
function Get-Settings(){
    $s=Read-JsonFile $script:SettingsPath
    if(-not $s){
        $s=[pscustomobject]@{
            ManifestUrl='https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/updates/manifest.json'
            ServerRoot=(Join-Path $script:AppRoot 'bridge')
            GameRoot=''; GameExe=''; Fifa14Exe=''; Fifa15Exe=''; Fifa20Exe=''
            Fifa14ServerRoot=(Join-Path $script:AppRoot 'fifa14-server')
            Fifa15ServerRoot=(Join-Path $script:AppRoot 'fifa15-server')
            Fifa20ServerRoot=(Join-Path $script:AppRoot 'fifa20-server')
            LaunchScript=(Join-Path $script:AppRoot 'bridge\Start-Local-FIFA17-Test.ps1')
            InstalledVersion='0.0.0'; CloudApiBaseUrl=$script:AuthApiDefault
            InstallationId=[guid]::NewGuid().ToString(); Language='en'
        }
    }
    foreach($entry in @(
        @{Name='Fifa14Exe';Value=''},
        @{Name='Fifa15Exe';Value=''},
        @{Name='Fifa20Exe';Value=''},
        @{Name='Fifa21Exe';Value='C:\Program Files\EA Games\FIFA 21\FIFA21.exe'},
        @{Name='Fifa21ServerRoot';Value=(Join-Path $script:AppRoot 'fifa21-server')},
        @{Name='Fifa14ServerRoot';Value=(Join-Path $script:AppRoot 'fifa14-server')},
        @{Name='Fifa15ServerRoot';Value=(Join-Path $script:AppRoot 'fifa15-server')},
        @{Name='Fifa20ServerRoot';Value=(Join-Path $script:AppRoot 'fifa20-server')}
    )){if(-not($s.PSObject.Properties.Name -contains $entry.Name)){$s|Add-Member -NotePropertyName $entry.Name -NotePropertyValue $entry.Value}}
    return $s
}
function Set-Property($obj,[string]$name,$value){
    if($obj.PSObject.Properties.Name -contains $name){ $obj.$name=$value }
    else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}
function T([string]$en,[string]$fr,[string]$es){
    if($script:Lang -eq 'fr'){return $fr}
    if($script:Lang -eq 'es'){return $es}
    return $en
}
function Get-HexBytes([string]$hex){[byte[]]$bytes=New-Object byte[] ($hex.Length/2);for($i=0;$i -lt $bytes.Length;$i++){$bytes[$i]=[Convert]::ToByte($hex.Substring($i*2,2),16)};Write-Output -NoEnumerate $bytes}
function Get-SignedManifest([string]$url){
    $lastError='Manifest signature is invalid.'
    for($attempt=1;$attempt -le 4;$attempt++){
        $client=$null;$key=$null;$ecdsa=$null;$sha=$null
        try{
            $nonce=[DateTime]::UtcNow.Ticks;$separator=if($url.Contains('?')){'&'}else{'?'};$manifestUrl=$url+$separator+'mng='+$nonce;$signatureUrl=$url+'.sig'+$separator+'mng='+$nonce
            $client=New-Object Net.Http.HttpClient;$client.DefaultRequestHeaders.CacheControl=New-Object Net.Http.Headers.CacheControlHeaderValue;$client.DefaultRequestHeaders.CacheControl.NoCache=$true;$client.DefaultRequestHeaders.CacheControl.NoStore=$true
            if($url -in @($script:LauncherManifestUrl,$script:GameServerManifestUrl)){
                $client.DefaultRequestHeaders.UserAgent.ParseAdd('MNG-FUT-Launcher');$apiRoot='https://api.github.com/repos/Minegamerfrance/MinegamerServeur17/';$revision=$client.GetStringAsync($apiRoot+'commits/main?mng='+$nonce).GetAwaiter().GetResult()|ConvertFrom-Json
                if([string]$revision.sha -notmatch '^[a-f0-9]{40}$'){throw 'Invalid publication revision.'}
                $manifestName=[IO.Path]::GetFileName(([Uri]$url).AbsolutePath);$manifestApi=$apiRoot+'contents/updates/'+$manifestName+'?ref='+$revision.sha+'&mng='+$nonce;$signatureApi=$apiRoot+'contents/updates/'+$manifestName+'.sig?ref='+$revision.sha+'&mng='+$nonce
                $manifestPayload=$client.GetStringAsync($manifestApi).GetAwaiter().GetResult()|ConvertFrom-Json;$signaturePayload=$client.GetStringAsync($signatureApi).GetAwaiter().GetResult()|ConvertFrom-Json
                $data=[Convert]::FromBase64String(([string]$manifestPayload.content -replace '\s',''));$signatureText=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(([string]$signaturePayload.content -replace '\s','')));$signature=[Convert]::FromBase64String($signatureText.Trim())
            }else{$data=$client.GetByteArrayAsync($manifestUrl).GetAwaiter().GetResult();$signature=[Convert]::FromBase64String(($client.GetStringAsync($signatureUrl).GetAwaiter().GetResult()).Trim())}
            $x=Get-HexBytes '10f99d18b877af169c4012024f48a7bd909436112476b44df7758ff88fe47a92';$y=Get-HexBytes '8c7b9013a62228ce93b65e36878d7d6f78b87e1efd2d72a51dca35c276483b5e';$blob=New-Object byte[] 72
            [Buffer]::BlockCopy([BitConverter]::GetBytes(0x31534345),0,$blob,0,4);[Buffer]::BlockCopy([BitConverter]::GetBytes(32),0,$blob,4,4);[Buffer]::BlockCopy($x,0,$blob,8,32);[Buffer]::BlockCopy($y,0,$blob,40,32)
            $key=[Security.Cryptography.CngKey]::Import($blob,[Security.Cryptography.CngKeyBlobFormat]::EccPublicBlob);$ecdsa=New-Object Security.Cryptography.ECDsaCng($key);$sha=[Security.Cryptography.SHA256]::Create()
            if($ecdsa.VerifyHash($sha.ComputeHash($data),$signature)){return ([Text.Encoding]::UTF8.GetString($data)|ConvertFrom-Json)}
            $lastError='Manifest signature is invalid.'
        }catch{$lastError=$_.Exception.Message
        }finally{if($sha){$sha.Dispose()};if($ecdsa){$ecdsa.Dispose()};if($key){$key.Dispose()};if($client){$client.Dispose()}}
        if($attempt -lt 4){Start-Sleep -Milliseconds 500}
    }
    throw $lastError
}
function Resolve-ManifestUrl([string]$manifestUrl,[string]$source){$absolute=$null;if([Uri]::TryCreate($source,[UriKind]::Absolute,[ref]$absolute)){return $absolute.AbsoluteUri};return ([Uri]::new([Uri]$manifestUrl,$source)).AbsoluteUri}
function Save-VerifiedDownload([string]$url,[string]$path,[string]$sha256,[long]$size){
    $dir=Split-Path -Parent $path;if($dir){New-Item -ItemType Directory -Path $dir -Force|Out-Null};(New-Object Net.WebClient).DownloadFile($url,$path);$item=Get-Item -LiteralPath $path
    if($size -gt 0 -and $item.Length -ne $size){throw 'Downloaded file size is invalid.'};$hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();if($sha256 -and $hash -ne $sha256.ToLowerInvariant()){throw 'Downloaded file SHA256 is invalid.'}
}
function Expand-MngZip([string]$Path,[string]$Destination){
    if(-not(Test-Path -LiteralPath $Path)){throw 'ZIP package is missing.'}
    New-Item -ItemType Directory -Path $Destination -Force|Out-Null
    [IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($Path),[IO.Path]::GetFullPath($Destination))
}
function Wait-Ui([int]$Milliseconds){
    $until=[DateTime]::UtcNow.AddMilliseconds($Milliseconds)
    do{
        Start-Sleep -Milliseconds 25
        if($window){$window.Dispatcher.Invoke([action]{},[Windows.Threading.DispatcherPriority]::Background)}
    }while([DateTime]::UtcNow -lt $until)
}
function Set-OperationStatus([string]$text,[string]$color='#E3CF66'){$LaunchStatus.Text='●  '+$text;$LaunchStatus.Foreground=$color;$window.Dispatcher.Invoke([action]{},[Windows.Threading.DispatcherPriority]::Background)}
function Install-GameServerPackage([string]$GameId){
    $game=Get-SelectedGame;$settings=Get-Settings;$manifest=Get-SignedManifest $script:GameServerManifestUrl;$package=@($manifest.packages|Where-Object{[string]$_.gameId -eq $GameId})|Select-Object -First 1
    if(-not $package){throw ('No remote server package is available for FIFA '+$GameId+'.')}
    $destination=[string]$settings.($game.ServerProperty);if([string]::IsNullOrWhiteSpace($destination)){$destination=Join-Path $script:AppRoot ('fifa'+$GameId+'-server');Set-Property $settings $game.ServerProperty $destination;Write-JsonFile $script:SettingsPath $settings}
    Set-OperationStatus ((T 'Downloading FIFA ' 'Téléchargement de FIFA ' 'Descargando FIFA ')+$GameId+'...')
    $temporaryRoot=Join-Path $env:TEMP ('MNGFUT-FIFA'+$GameId+'-'+[guid]::NewGuid().ToString('N'));$zip=Join-Path $temporaryRoot 'server.zip';$payload=Join-Path $temporaryRoot 'payload';New-Item -ItemType Directory -Path $temporaryRoot -Force|Out-Null
    Save-VerifiedDownload ([string]$package.source) $zip ([string]$package.sha256) ([long]$package.size);Expand-MngZip $zip $payload;New-Item -ItemType Directory -Path $destination -Force|Out-Null
    Get-ChildItem -LiteralPath $payload -Force|ForEach-Object{Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force}
    Set-OperationStatus ((T 'FIFA server installed: ' 'Serveur FIFA installé : ' 'Servidor FIFA instalado: ')+$GameId) '#87DB72';[Windows.MessageBox]::Show(((T 'FIFA server installation completed: ' 'Installation du serveur FIFA terminée : ' 'Instalación del servidor FIFA terminada: ')+$GameId),'MNG FUT')|Out-Null
}
function Install-ServerInternal(){
    try{
        $game=Get-SelectedGame;$s=Get-Settings
        if($game.Id -eq '21'){Show-Fifa21Preparation;return}
        if($game.Id -in @('14','15','20')){Install-GameServerPackage $game.Id;return}
        if(-not $s.GameExe -or -not(Test-Path -LiteralPath ([string]$s.GameExe))){Choose-GameExe;$s=Get-Settings;if(-not $s.GameExe){return}}
        Set-OperationStatus (T 'Installing server...' 'Installation du serveur...' 'Instalando servidor...');$manifest=Get-SignedManifest $script:InstallManifestUrl;$file=@($manifest.files|Where-Object{[IO.Path]::GetFileName([string]$_.target) -ieq 'version.dll'})|Select-Object -First 1;if(-not $file){throw 'version.dll is missing from manifest.'}
        $destination=Join-Path (Split-Path -Parent ([string]$s.GameExe)) 'version.dll';$temporary=$destination+'.mng-download';Save-VerifiedDownload (Resolve-ManifestUrl $script:InstallManifestUrl ([string]$file.source)) $temporary ([string]$file.sha256) ([long]$file.size);Move-Item -LiteralPath $temporary -Destination $destination -Force
        $server=Get-SignedManifest $script:ServerManifestUrl;Set-Property $s 'installedServerVersion' ([string]$server.version);Set-Property $s 'installationCompleted' $true;Write-JsonFile $script:SettingsPath $s;Set-OperationStatus (T 'Server installed and verified' 'Serveur installé et vérifié' 'Servidor instalado y verificado') '#87DB72';[Windows.MessageBox]::Show((T 'Server installation completed.' 'Installation du serveur terminée.' 'Instalación del servidor terminada.'),'MNG FUT')|Out-Null
    }catch{Set-OperationStatus (T 'Installation failed' 'Échec de l installation' 'Error de instalación') '#E76F6F';[Windows.MessageBox]::Show($_.Exception.Message,'MNG FUT')|Out-Null}
}
function Check-ServerUpdateInternal(){
    try{
        $game=Get-SelectedGame
        if($game.Id -eq '21'){Show-Fifa21Preparation;return}
        if($game.Id -in @('14','15','20')){
            Set-OperationStatus ((T 'Checking FIFA ' 'Recherche de mise à jour FIFA ' 'Buscando actualización de FIFA ')+$game.Id+'...')
            $manifest=Get-SignedManifest $script:GameServerManifestUrl
            $package=@($manifest.packages|Where-Object{[string]$_.gameId -eq $game.Id})|Select-Object -First 1
            if(-not $package){throw ('No remote server package is available for FIFA '+$game.Id+'.')}
            $settings=Get-Settings;$root=[string]$settings.($game.ServerProperty);$installed='0.0.0'
            $localManifest=Join-Path $root 'localfut20-manifest.json'
            if($game.Id -eq '20' -and (Test-Path -LiteralPath $localManifest)){
                $local=Read-JsonFile $localManifest;if($local -and $local.version){$installed=[string]$local.version}
            }
            if([version]$installed -lt [version]$package.version){
                $answer=[Windows.MessageBox]::Show(((T 'Install FIFA ' 'Installer la mise à jour FIFA ' 'Instalar la actualización de FIFA ')+$game.Id+' '+$package.version+' ?'),'MNG FUT',[Windows.MessageBoxButton]::YesNo,[Windows.MessageBoxImage]::Question)
                if($answer -eq [Windows.MessageBoxResult]::Yes){Stop-MngServer;Install-GameServerPackage $game.Id}
                else{Set-OperationStatus ((T 'Server update available: ' 'Mise à jour serveur disponible : ' 'Actualización del servidor disponible: ')+$package.version) '#E3CF66'}
            }else{
                $displayVersion=if($installed -ne '0.0.0'){$installed}else{[string]$package.version}
                $statusText=(T 'The FIFA server is up to date: ' 'Le serveur FIFA est à jour : ' 'El servidor FIFA está actualizado: ')+$game.Id+' '+$displayVersion
                if([version]$installed -gt [version]$package.version){$statusText=(T 'Installed FIFA server version: ' 'Version du serveur FIFA installée : ' 'Versión del servidor FIFA instalada: ')+$game.Id+' '+$displayVersion+' ('+(T 'publication catalogue: ' 'catalogue publié : ' 'catálogo publicado: ')+$package.version+')'}
                Set-OperationStatus $statusText '#87DB72'
                [Windows.MessageBox]::Show($statusText,'MNG FUT')|Out-Null
            }
            return
        }
        Set-OperationStatus (T 'Checking server update...' 'Recherche de mise à jour serveur...' 'Buscando actualización del servidor...');$server=Get-SignedManifest $script:ServerManifestUrl;$s=Get-Settings;$installed=[string]$s.installedServerVersion;if(-not $installed){$installed='0.0.0'};Set-Property $s 'installedServerVersion' ([string]$server.version);Write-JsonFile $script:SettingsPath $s;Set-OperationStatus ((T 'Server ready: ' 'Serveur prêt : ' 'Servidor listo: ')+$server.version) '#87DB72'
    }catch{Set-OperationStatus (T 'Update check failed' 'Échec de la vérification' 'Error de comprobación') '#E76F6F';[Windows.MessageBox]::Show($_.Exception.Message,'MNG FUT')|Out-Null}
}
function Repair-ServerInternal(){if($script:SelectedGame -eq '21'){Show-Fifa21Preparation;return};Stop-MngServer;Install-ServerInternal}
function Update-ApplicationInternal(){
    try{
        Set-OperationStatus (T 'Checking application update...' 'Recherche de mise à jour application...' 'Buscando actualización de la aplicación...');$manifest=Get-SignedManifest $script:LauncherManifestUrl
        if([version]$manifest.version -le [version]$script:LauncherVersion){Set-OperationStatus (T 'Application is up to date' 'Application à jour' 'Aplicación actualizada') '#87DB72';[Windows.MessageBox]::Show((T 'MNG FUT is up to date.' 'MNG FUT est à jour.' 'MNG FUT está actualizado.'),'MNG FUT')|Out-Null;return}
        $answer=[Windows.MessageBox]::Show(((T 'Install MNG FUT update ' 'Installer la mise à jour MNG FUT ' 'Instalar actualización MNG FUT ')+$manifest.version+' ?'),'MNG FUT',[Windows.MessageBoxButton]::YesNo,[Windows.MessageBoxImage]::Question);if($answer -ne [Windows.MessageBoxResult]::Yes){return}
        Set-OperationStatus (T 'Downloading application update...' 'Téléchargement de la mise à jour...' 'Descargando actualización...');$updateRoot=Join-Path $env:TEMP ('MNGFUT-V1-Update-'+[guid]::NewGuid().ToString('N'));$zip=Join-Path $updateRoot 'update.zip';$payload=Join-Path $updateRoot 'payload';New-Item -ItemType Directory -Path $payload -Force|Out-Null
        Save-VerifiedDownload (Resolve-ManifestUrl $script:LauncherManifestUrl ([string]$manifest.source)) $zip ([string]$manifest.sha256) ([long]$manifest.size);Expand-MngZip $zip $payload
        $newExe=Get-ChildItem -LiteralPath $payload -Filter 'MNG FUT.exe' -File -Recurse|Select-Object -First 1;if(-not $newExe){throw 'MNG FUT.exe is missing from update package.'};$packageRoot=$newExe.Directory.FullName;$updater=Join-Path $updateRoot 'apply-update.ps1'
        $source64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($packageRoot));$target64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script:AppRoot));$updateLog64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Join-Path $script:StateRoot 'launcher-update.log')));$launcherPid=$PID
        $updateCode=@"
`$ErrorActionPreference='Stop'
`$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$source64'))
`$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$target64'))
`$log=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$updateLog64'))
try {
    if([string]::IsNullOrWhiteSpace(`$source) -or [string]::IsNullOrWhiteSpace(`$target)){throw 'Update source or destination is empty.'}
    Wait-Process -Id $launcherPid -Timeout 60 -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    New-Item -ItemType Directory -Path `$target -Force|Out-Null
    Get-ChildItem -LiteralPath `$source -Force|ForEach-Object { Copy-Item -LiteralPath `$_.FullName -Destination `$target -Recurse -Force }
    `$launcher=Join-Path `$target 'MNG FUT.exe'
    if(-not(Test-Path -LiteralPath `$launcher)){throw 'Updated launcher executable is missing.'}
    Start-Process -FilePath `$launcher -WorkingDirectory `$target
} catch {
    ('['+(Get-Date -Format s)+'] '+`$_.Exception.ToString())|Out-File -LiteralPath `$log -Encoding UTF8 -Append
}
"@
        [IO.File]::WriteAllText($updater,$updateCode,(New-Object Text.UTF8Encoding($false)));$arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$updater+'"';Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden|Out-Null;$window.Close()
    }catch{Set-OperationStatus (T 'Application update failed' 'Échec de la mise à jour' 'Error de actualización') '#E76F6F';[Windows.MessageBox]::Show($_.Exception.Message,'MNG FUT')|Out-Null}
}

function Get-AuthBase(){
    $settings=Get-Settings
    $base=[string]$settings.CloudApiBaseUrl
    if([string]::IsNullOrWhiteSpace($base)){ $base=$script:AuthApiDefault }
    return $base.TrimEnd('/')
}
function Get-SessionToken(){
    if($script:Session -and $script:Session.token){ return [string]$script:Session.token }
    return ''
}
function Invoke-JsonApi([string]$Method,[string]$Uri,$Body=$null,[hashtable]$Headers=$null,[int]$TimeoutSec=12){
    $params=@{Method=$Method;Uri=$Uri;TimeoutSec=$TimeoutSec;UseBasicParsing=$true;ErrorAction='Stop'}
    if($Headers){$params.Headers=$Headers}
    if($null -ne $Body){
        $params.ContentType='application/json; charset=utf-8'
        $params.Body=($Body|ConvertTo-Json -Depth 10 -Compress)
    }
    return Invoke-RestMethod @params
}
function Validate-Session(){
    $script:Session=Read-JsonFile $script:SessionPath
    if(-not $script:Session -or -not $script:Session.token){$script:Profile=$null;return $false}
    $base=[string]$script:Session.apiBaseUrl
    if([string]::IsNullOrWhiteSpace($base)){$base=Get-AuthBase}
    try{
        $r=Invoke-JsonApi 'GET' ($base.TrimEnd('/')+'/api/me') $null @{Authorization=('Bearer '+[string]$script:Session.token);Accept='application/json'} 8
        if($r -and $r.ok -eq $true -and $r.profile){
            $script:Profile=$r.profile
            Set-Property $script:Session 'profile' $r.profile
            Set-Property $script:Session 'apiBaseUrl' $base.TrimEnd('/')
            Set-Property $script:Session 'savedAt' ([DateTime]::UtcNow.ToString('o'))
            Write-JsonFile $script:SessionPath $script:Session
            return $true
        }
    }catch{}
    $script:Profile=$null
    return $false
}
function Try-AccountEndpoint([string]$Mode,[string]$Username,[string]$Password){
    $base=Get-AuthBase
    $paths = if($Mode -eq 'register'){@('/api/register','/api/auth/register')}else{@('/api/login','/api/auth/login')}
    $last='Connexion refusee.'
    foreach($path in $paths){
        try{
            $r=Invoke-JsonApi 'POST' ($base+$path) @{username=$Username;password=$Password} $null 12
            $token=''
            if($r.token){$token=[string]$r.token}
            elseif($r.accessToken){$token=[string]$r.accessToken}
            elseif($r.session -and $r.session.token){$token=[string]$r.session.token}
            if($token){
                $accountProfile=$r.profile
                $session=[pscustomobject]@{apiBaseUrl=$base;token=$token;profile=$accountProfile;savedAt=[DateTime]::UtcNow.ToString('o')}
                Write-JsonFile $script:SessionPath $session
                $script:Session=$session
                if(Validate-Session){return @{ok=$true;message='OK'}}
                Remove-Item -LiteralPath $script:SessionPath -Force -ErrorAction SilentlyContinue
                $last='Le serveur a renvoye un token invalide.'
            } else { $last='Reponse de connexion sans token.' }
        }catch{
            $last=$_.Exception.Message
        }
    }
    return @{ok=$false;message=$last}
}
function Logout-Mng(){
    try{ Send-Presence 'offline' 'Launcher ferme' | Out-Null }catch{}
    Remove-Item -LiteralPath $script:SessionPath -Force -ErrorAction SilentlyContinue
    $script:Session=$null;$script:Profile=$null
}

function Invoke-Social([string]$Method,[string]$Path,$Body=$null){
    $token=Get-SessionToken
    if(-not $token){ throw 'NOT_LOGGED_IN' }
    return Invoke-JsonApi $Method ($script:SocialApi+$Path) $Body @{Authorization=('Bearer '+$token);Accept='application/json'} 10
}
function Send-Presence([string]$State,[string]$Text=''){
    if(-not $script:Profile){return}
    if($State -eq $script:LastPresence -and $State -eq 'offline'){return}
    $r=Invoke-Social 'POST' '/api/presence' @{state=$State;statusText=$Text}
    $script:LastPresence=$State
    return $r
}

[xml]$xaml=@'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="MNG FUT Launcher" Width="1280" Height="720" MinWidth="960" MinHeight="620"
        WindowStartupLocation="CenterScreen" WindowStyle="None" ResizeMode="CanResizeWithGrip"
        Background="#06100E" Foreground="#F5F7F5" FontFamily="Segoe UI">
  <Window.Resources>
    <SolidColorBrush x:Key="Accent" Color="#DDFD45"/>
    <SolidColorBrush x:Key="AccentSoft" Color="#80DDFD45"/>
    <SolidColorBrush x:Key="Text" Color="#F5F7F5"/>
    <SolidColorBrush x:Key="Muted" Color="#93A09A"/>
    <SolidColorBrush x:Key="Card" Color="#E00B1513"/>
    <DropShadowEffect x:Key="SoftShadow" BlurRadius="26" ShadowDepth="0" Opacity="0.42" Color="#000000"/>

    <Style x:Key="NavButton" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="#A9B5AF"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" CornerRadius="16" Background="{TemplateBinding Background}" BorderBrush="#33453D" BorderThickness="{TemplateBinding BorderThickness}" Padding="8">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#1B2A25"/><Setter Property="Foreground" Value="#FFFFFF"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="TopPill" TargetType="Button">
      <Setter Property="Background" Value="#B90A1412"/>
      <Setter Property="Foreground" Value="#F4F7F5"/>
      <Setter Property="BorderBrush" Value="#344A40"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="16,10"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" CornerRadius="18" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#17251F"/><Setter TargetName="bd" Property="BorderBrush" Value="#708C7A"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="PrimaryButton" TargetType="Button">
      <Setter Property="Background" Value="#DDFD45"/>
      <Setter Property="Foreground" Value="#0A110D"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="FontWeight" Value="Bold"/>
      <Setter Property="FontSize" Value="16"/>
      <Setter Property="Padding" Value="22,13"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" CornerRadius="11" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#ECFF78"/></Trigger>
              <Trigger Property="IsPressed" Value="True"><Setter TargetName="bd" Property="Opacity" Value="0.78"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="GhostButton" TargetType="Button">
      <Setter Property="Background" Value="#A6121E1A"/>
      <Setter Property="Foreground" Value="#EEF3F0"/>
      <Setter Property="BorderBrush" Value="#31463C"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="14,10"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" CornerRadius="10" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#1B2A24"/><Setter TargetName="bd" Property="BorderBrush" Value="#718A79"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="GameTile" TargetType="Button">
      <Setter Property="Background" Value="#C30A1412"/>
      <Setter Property="Foreground" Value="#DCE5E0"/>
      <Setter Property="BorderBrush" Value="#34473F"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Margin" Value="10,5"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" CornerRadius="18" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" Padding="7">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#19251F"/><Setter TargetName="bd" Property="BorderBrush" Value="#81977F"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style TargetType="TextBox"><Setter Property="Background" Value="#0D1714"/><Setter Property="Foreground" Value="#F3F6F4"/><Setter Property="BorderBrush" Value="#364A41"/><Setter Property="BorderThickness" Value="1"/><Setter Property="Padding" Value="11,8"/><Setter Property="CaretBrush" Value="#DDFD45"/></Style>
    <Style TargetType="PasswordBox"><Setter Property="Background" Value="#0D1714"/><Setter Property="Foreground" Value="#F3F6F4"/><Setter Property="BorderBrush" Value="#364A41"/><Setter Property="BorderThickness" Value="1"/><Setter Property="Padding" Value="11,8"/><Setter Property="CaretBrush" Value="#DDFD45"/></Style>
  </Window.Resources>

  <Grid x:Name="RootGrid">
    <Image x:Name="BackgroundImage" Stretch="UniformToFill" Opacity="0.23"/>
    <Rectangle>
      <Rectangle.Fill>
        <RadialGradientBrush Center="0.32,0.12" RadiusX="0.95" RadiusY="0.95">
          <GradientStop Color="#A51E3429" Offset="0"/>
          <GradientStop Color="#E30A1512" Offset="0.52"/>
          <GradientStop Color="#FB050B09" Offset="1"/>
        </RadialGradientBrush>
      </Rectangle.Fill>
    </Rectangle>

    <Canvas IsHitTestVisible="False" Opacity="0.7">
      <Ellipse Width="5" Height="5" Fill="#DDFD45" Canvas.Left="165" Canvas.Top="118"/>
      <Ellipse Width="3" Height="3" Fill="#B8D545" Canvas.Left="410" Canvas.Top="52"/>
      <Ellipse Width="4" Height="4" Fill="#DDFD45" Canvas.Left="728" Canvas.Top="132"/>
      <Ellipse Width="3" Height="3" Fill="#DDFD45" Canvas.Left="1160" Canvas.Top="85"/>
      <Ellipse Width="4" Height="4" Fill="#C8E648" Canvas.Left="1390" Canvas.Top="580"/>
      <Ellipse Width="3" Height="3" Fill="#DDFD45" Canvas.Left="330" Canvas.Top="790"/>
      <Ellipse Width="5" Height="5" Fill="#DDFD45" Canvas.Left="1010" Canvas.Top="735"/>
    </Canvas>

    <ScrollViewer x:Name="MainScrollViewer" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled" PanningMode="VerticalOnly" CanContentScroll="False">
    <Grid MinWidth="920" MinHeight="700">
      <Grid.RowDefinitions><RowDefinition Height="42"/><RowDefinition Height="*"/></Grid.RowDefinitions>
      <Grid.ColumnDefinitions><ColumnDefinition Width="88"/><ColumnDefinition Width="*"/><ColumnDefinition Width="120"/></Grid.ColumnDefinitions>

      <!-- custom titlebar -->
      <Grid x:Name="TitleBar" Grid.Row="0" Grid.ColumnSpan="3" Background="#50000000" Panel.ZIndex="15">
        <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
        <TextBlock Text="MNG FUT LAUNCHER" Foreground="#77857F" FontSize="9" FontWeight="SemiBold" VerticalAlignment="Center" Margin="22,0,0,0"/>
        <StackPanel Grid.Column="1" Orientation="Horizontal" Margin="0,0,9,0">
          <Button x:Name="MinButton" Style="{StaticResource NavButton}" Width="42" Height="36" Content="—" FontSize="17"/>
          <Button x:Name="MaxButton" Style="{StaticResource NavButton}" Width="42" Height="36" Content="□" FontSize="16" ToolTip="Agrandir ou réduire"/>
          <Button x:Name="CloseButton" Style="{StaticResource NavButton}" Width="42" Height="36" Content="×" FontSize="20"/>
        </StackPanel>
      </Grid>

      <!-- left navigation; game logos deliberately NOT here -->
      <Border Grid.Row="1" Grid.Column="0" Background="#8E07100E" BorderBrush="#25342E" BorderThickness="0,0,1,0">
        <Grid Margin="12,18">
          <Grid.RowDefinitions><RowDefinition Height="100"/><RowDefinition Height="76"/><RowDefinition Height="76"/><RowDefinition Height="76"/><RowDefinition Height="*"/><RowDefinition Height="110"/></Grid.RowDefinitions>
          <Border Grid.Row="0" Width="60" Height="60" CornerRadius="14" ClipToBounds="True" HorizontalAlignment="Center" VerticalAlignment="Top" Background="#FFFFFF"><Image x:Name="AppLogoImage" Stretch="Uniform"/></Border>
          <Button x:Name="HomeButton" Grid.Row="1" Style="{StaticResource NavButton}" Background="#16241F" BorderThickness="1" Foreground="#DDFD45">
            <StackPanel><TextBlock Text="⌂" FontSize="28" HorizontalAlignment="Center"/><TextBlock x:Name="HomeNavText" Text="Home" FontSize="10" HorizontalAlignment="Center" Margin="0,4,0,0"/></StackPanel>
          </Button>
          <Button x:Name="FriendsNavButton" Grid.Row="2" Style="{StaticResource NavButton}">
            <StackPanel><TextBlock Text="♟♟" FontSize="20" HorizontalAlignment="Center"/><TextBlock x:Name="FriendsNavText" Text="Friends" FontSize="10" HorizontalAlignment="Center" Margin="0,4,0,0"/></StackPanel>
          </Button>
          <Button x:Name="SettingsNavButton" Grid.Row="3" Style="{StaticResource NavButton}">
            <StackPanel><TextBlock Text="⚙" FontSize="23" HorizontalAlignment="Center"/><TextBlock x:Name="SettingsNavText" Text="Settings" FontSize="10" HorizontalAlignment="Center" Margin="0,4,0,0"/></StackPanel>
          </Button>
          <StackPanel Grid.Row="5" VerticalAlignment="Bottom" HorizontalAlignment="Center">
            <TextBlock Text="MORE" FontSize="8" Foreground="#73817B" HorizontalAlignment="Center"/>
            <TextBlock Text="THAN" FontSize="8" Foreground="#73817B" HorizontalAlignment="Center" Margin="0,6,0,0"/>
            <TextBlock Text="A GAME" FontSize="8" Foreground="#73817B" HorizontalAlignment="Center" Margin="0,6,0,0"/>
            <Border Width="28" Height="2" Background="#DDFD45" Margin="0,12,0,0"/>
          </StackPanel>
        </Grid>
      </Border>

      <!-- center content -->
      <Grid Grid.Row="1" Grid.Column="1" Margin="24,12,24,24">
        <Grid.RowDefinitions><RowDefinition Height="88"/><RowDefinition Height="340"/><RowDefinition Height="18"/><RowDefinition Height="*"/></Grid.RowDefinitions>

        <Grid Grid.Row="0">
          <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
          <StackPanel VerticalAlignment="Center">
            <StackPanel Orientation="Horizontal">
              <TextBlock Text="MNG" FontSize="48" FontWeight="Black" Foreground="#F6F7F6"/>
              <TextBlock Text=" FUT" FontSize="48" FontWeight="Black" Foreground="#DDFD45"/>
            </StackPanel>
            <TextBlock x:Name="GameHeaderText" Text="FIFA 17  •  COMMUNITY SERVER" FontSize="10" Foreground="#A5B0AB" FontWeight="SemiBold" Margin="2,-3,0,0"/>
          </StackPanel>
          <StackPanel Grid.Column="1" Orientation="Horizontal" VerticalAlignment="Center">
            <Button x:Name="NotificationsButton" Style="{StaticResource TopPill}" Width="48" Height="44" Content="🔔" Margin="0,0,8,0"/>
            <Button x:Name="AccountButton" Style="{StaticResource TopPill}" MinWidth="132" Height="44" Content="👤  Login" Margin="0,0,8,0"/>
            <Button x:Name="FriendsTopButton" Style="{StaticResource TopPill}" MinWidth="120" Height="44" Content="👥  Friends  •  0"/>
          </StackPanel>
        </Grid>

        <!-- cinematic hero -->
        <Border Grid.Row="1" CornerRadius="24" BorderBrush="#607556" BorderThickness="1" ClipToBounds="True" Effect="{StaticResource SoftShadow}">
          <Grid>
            <Image x:Name="HeroImage" Stretch="UniformToFill" Opacity="0.9"/>
            <Rectangle>
              <Rectangle.Fill>
                <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                  <GradientStop Color="#FC07110F" Offset="0"/>
                  <GradientStop Color="#E2081210" Offset="0.42"/>
                  <GradientStop Color="#62081210" Offset="0.72"/>
                  <GradientStop Color="#28081210" Offset="1"/>
                </LinearGradientBrush>
              </Rectangle.Fill>
            </Rectangle>
            <Grid Margin="28,24">
              <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="0"/></Grid.ColumnDefinitions>
              <StackPanel VerticalAlignment="Center">
                <Border BorderBrush="#627169" BorderThickness="1" CornerRadius="12" Padding="12,5" HorizontalAlignment="Left" Background="#480B1512">
                  <TextBlock Text="ULTIMATE TEAM" FontSize="9" FontWeight="Bold" Foreground="#DDE5E1"/>
                </Border>
                <TextBlock x:Name="HeroTitleText" Text="RELIVE" FontSize="44" FontWeight="Black" Margin="0,16,0,0"/>
                <TextBlock x:Name="HeroSubtitleText" Text="the good days." FontSize="36" FontWeight="Bold" Foreground="#F1F4F2"/>
                <TextBlock x:Name="HeroDescriptionText" Text="Your club. Your colors. Your next great match." FontSize="13" Foreground="#A7B2AD" Margin="2,13,0,0"/>
                <WrapPanel Margin="0,20,0,0">
                  <Button x:Name="PlayButton" Style="{StaticResource PrimaryButton}" Content="▶   START SERVER" MinWidth="190" Height="54"/>
                  <Button x:Name="LaunchGameButton" Style="{StaticResource GhostButton}" Content="▶   PLAY" MinWidth="112" Height="54" Margin="8,0,0,0" IsEnabled="False"/>
                  <StackPanel Margin="18,5,0,0">
                    <TextBlock x:Name="LaunchStatus" Text="●  Ready to launch" Foreground="#AAB7B0" FontSize="12"/>
                    <TextBlock x:Name="AccountStatus" Text="Account: checking..." Foreground="#69766F" FontSize="10" Margin="0,4,0,0"/>
                  </StackPanel>
                  <CheckBox x:Name="ShowLogsCheckBox" Content="Show logs" Foreground="#DDFD45" VerticalAlignment="Center" Margin="22,0,0,0" Cursor="Hand"/>
                </WrapPanel>
              </StackPanel>
              <Grid Grid.ColumnSpan="2" Margin="12,0,8,5" ClipToBounds="True" HorizontalAlignment="Right" VerticalAlignment="Top" IsHitTestVisible="True">
                <StackPanel x:Name="HeroSlogan" Visibility="Collapsed" VerticalAlignment="Bottom" HorizontalAlignment="Right"><TextBlock Text="FOOTBALL" FontFamily="Segoe Print" FontSize="18" Foreground="#DDFD45" HorizontalAlignment="Right"/><TextBlock Text="LIVES FOREVER" FontFamily="Segoe Print" FontSize="18" Foreground="#DDFD45" HorizontalAlignment="Right" Margin="0,-2,0,0"/></StackPanel>
                <Border x:Name="LogsPanel" Visibility="Collapsed" Width="620" MaxWidth="620" Height="250" HorizontalAlignment="Right" VerticalAlignment="Top" Background="#E9060D0B" BorderBrush="#52685B" BorderThickness="1" CornerRadius="10" Padding="12">
                  <TextBox x:Name="ServerLogsBox" Width="594" MaxWidth="594" IsReadOnly="True" AcceptsReturn="True" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Background="Transparent" Foreground="#B8D6C4" BorderThickness="0" FontFamily="Consolas" FontSize="10"/>
                </Border>
              </Grid>
            </Grid>
          </Grid>
        </Border>

        <!-- lower cards -->
        <Grid Grid.Row="3">
          <Grid.ColumnDefinitions><ColumnDefinition Width="1.03*"/><ColumnDefinition Width="18"/><ColumnDefinition Width="0.97*"/></Grid.ColumnDefinitions>
          <Border Grid.Column="0" Grid.ColumnSpan="3" Height="245" VerticalAlignment="Top" Background="#DB0B1513" CornerRadius="20" BorderBrush="#2D4137" BorderThickness="1" Padding="30" Effect="{StaticResource SoftShadow}">
            <Grid>
              <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
              <TextBlock x:Name="NextSessionLabel" Text="YOUR NEXT SESSION" Foreground="#87958E" FontSize="10" FontWeight="SemiBold"/>
              <StackPanel Grid.Row="1" Margin="0,14,0,0"><TextBlock x:Name="NextSessionTitle" Text="Make every match count." FontSize="25" FontWeight="SemiBold"/><TextBlock x:Name="NextSessionDescription" Text="Your game is connected. Pick up exactly where you left off." Foreground="#87948E" FontSize="11" Margin="0,7,0,0"/></StackPanel>
              <StackPanel Grid.Row="2" Margin="0,20,0,0">
                <WrapPanel><Button x:Name="InstallButton" Style="{StaticResource GhostButton}" Content="INSTALL" Margin="0,0,8,8"/><Button x:Name="UpdateServerButton" Style="{StaticResource GhostButton}" Content="CHECK SERVER UPDATE" Margin="0,0,8,8"/><Button x:Name="RepairButton" Style="{StaticResource GhostButton}" Content="REPAIR" Margin="0,0,8,8"/><Button x:Name="ChangeFolderButton" Style="{StaticResource GhostButton}" Content="▣  CHOOSE GAME EXE" Margin="0,0,8,8"/></WrapPanel>
                <TextBlock x:Name="GamePathText" Text="Game folder: not selected" Foreground="#5F6D66" FontSize="9" TextTrimming="CharacterEllipsis" Margin="0,20,0,0"/>
                <TextBlock x:Name="PassionText" Text="SAME PASSION. A STRONGER COMMUNITY." Foreground="#52605A" FontSize="8" Margin="0,20,0,0"/>
              </StackPanel>
            </Grid>
          </Border>

          <Border Grid.Column="2" Visibility="Collapsed" Background="#DB0B1513" CornerRadius="20" BorderBrush="#2D4137" BorderThickness="1" Padding="30" Effect="{StaticResource SoftShadow}">
            <Grid>
              <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
              <TextBlock x:Name="CommunityLabel" Text="ALL SET, TOGETHER" Foreground="#87958E" FontSize="10" FontWeight="SemiBold"/>
              <StackPanel Grid.Row="1" Margin="0,14,0,0"><TextBlock x:Name="CommunityTitle" Text="A community that plays together." FontSize="24" FontWeight="SemiBold"/><TextBlock x:Name="CommunityDescription" Text="Your MNG account connects Friends, Cloud Save and FIFA 17." Foreground="#87948E" FontSize="11" Margin="0,7,0,0"/></StackPanel>
              <StackPanel Grid.Row="2" Margin="0,19,0,0">
                <Button x:Name="FindFriendsButton" Style="{StaticResource GhostButton}" HorizontalContentAlignment="Left" Content="👥   Find friends and requests                                         →" Margin="0,0,0,8"/>
                <Button x:Name="SettingsButton" Style="{StaticResource GhostButton}" HorizontalContentAlignment="Left" Content="⚙    Launcher settings                                                →" Margin="0,0,0,8"/>
                <Button x:Name="MaintenanceButton" Style="{StaticResource GhostButton}" HorizontalContentAlignment="Left" Content="↻    Repair / maintenance tools                                       →"/>
              </StackPanel>
            </Grid>
          </Border>
        </Grid>
      </Grid>

      <!-- game rail moved to RIGHT, as requested -->
      <Border Grid.Row="1" Grid.Column="2" Background="#8E07100E" BorderBrush="#25342E" BorderThickness="1,0,0,0">
        <Grid Margin="8,18,8,20">
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="92"/><RowDefinition Height="92"/><RowDefinition Height="92"/><RowDefinition Height="92"/><RowDefinition Height="92"/><RowDefinition Height="*"/></Grid.RowDefinitions>
          <TextBlock x:Name="GamesLabel" Grid.Row="0" Text="GAMES" FontSize="8" Foreground="#66736D" HorizontalAlignment="Center" Margin="0,0,0,10"/>
          <Button x:Name="Fifa14Tile" Grid.Row="1" Style="{StaticResource GameTile}"><Image x:Name="Fifa14Image" Stretch="Uniform"/></Button>
          <Button x:Name="Fifa15Tile" Grid.Row="2" Style="{StaticResource GameTile}"><Image x:Name="Fifa15Image" Stretch="Uniform"/></Button>
          <Button x:Name="Fifa17Tile" Grid.Row="3" Style="{StaticResource GameTile}" BorderBrush="#DDFD45" BorderThickness="2" Background="#B818241D">
            <Image x:Name="Fifa17Image" Stretch="Uniform"/>
          </Button>
          <Button x:Name="Fifa20Tile" Grid.Row="4" Style="{StaticResource GameTile}"><Image x:Name="Fifa20Image" Stretch="Uniform"/></Button>
          <Button x:Name="Fifa21Tile" Grid.Row="5" Style="{StaticResource GameTile}" ToolTip="FIFA 21"><Image x:Name="Fifa21Image" Stretch="Uniform"/></Button>
          <StackPanel Grid.Row="6" VerticalAlignment="Bottom" HorizontalAlignment="Center"><TextBlock Text="v1.3.10" Foreground="#6E7B75" FontSize="8" HorizontalAlignment="Center"/><TextBlock Text="CINEMATIC UI" Foreground="#52605A" FontSize="7" HorizontalAlignment="Center" Margin="0,4,0,0"/></StackPanel>
        </Grid>
      </Border>

      <Border x:Name="NotificationsPopup" Grid.RowSpan="2" Grid.ColumnSpan="3" Width="430" Height="390" HorizontalAlignment="Right" VerticalAlignment="Top" Margin="0,92,205,0" Background="#FE08110F" BorderBrush="#52685B" BorderThickness="1" CornerRadius="16" Visibility="Collapsed" Panel.ZIndex="70" Effect="{StaticResource SoftShadow}">
        <Grid Margin="20"><Grid.RowDefinitions><RowDefinition Height="52"/><RowDefinition Height="*"/></Grid.RowDefinitions>
          <Grid><StackPanel VerticalAlignment="Center"><TextBlock x:Name="NotificationsTitle" Text="NOTIFICATIONS" FontSize="18" FontWeight="Bold"/><TextBlock Text="MNG FUT NEWS" FontSize="8" Foreground="#68766F"/></StackPanel><Button x:Name="CloseNotificationsButton" Style="{StaticResource NavButton}" Content="×" Width="38" Height="38" HorizontalAlignment="Right" FontSize="20"/></Grid>
          <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto"><StackPanel x:Name="NotificationsList"/></ScrollViewer>
        </Grid>
      </Border>

      <Border x:Name="NotificationImageOverlay" Grid.RowSpan="2" Grid.ColumnSpan="3" Background="#EC000000" Visibility="Collapsed" Panel.ZIndex="90">
        <Border Width="1180" Height="720" HorizontalAlignment="Center" VerticalAlignment="Center" Background="#FF07100E" BorderBrush="#52685B" BorderThickness="1" CornerRadius="16" Padding="24">
          <Grid><Image x:Name="NotificationLargeImage" Width="1100" Height="619" HorizontalAlignment="Center" VerticalAlignment="Center" Stretch="Uniform"/><Button x:Name="CloseNotificationImageButton" Style="{StaticResource PrimaryButton}" Content="FERMER" Width="130" Height="44" HorizontalAlignment="Right" VerticalAlignment="Top" Panel.ZIndex="2"/></Grid>
        </Border>
      </Border>

      <!-- integrated settings drawer -->
      <Border x:Name="SettingsDrawer" Grid.RowSpan="2" Grid.ColumnSpan="3" Width="470" HorizontalAlignment="Right" Background="#FB08110F" BorderBrush="#385044" BorderThickness="1,0,0,0" Visibility="Collapsed" Panel.ZIndex="55" Effect="{StaticResource SoftShadow}">
        <Grid Margin="26"><Grid.RowDefinitions><RowDefinition Height="62"/><RowDefinition Height="*"/></Grid.RowDefinitions>
          <Grid><TextBlock x:Name="SettingsTitle" Text="SETTINGS" FontSize="22" FontWeight="Bold" VerticalAlignment="Center"/><Button x:Name="CloseSettingsButton" Style="{StaticResource NavButton}" Content="×" Width="40" Height="40" HorizontalAlignment="Right" FontSize="21"/></Grid>
          <StackPanel Grid.Row="1" Margin="0,22,0,0">
            <TextBlock x:Name="LanguageLabel" Text="Language" Foreground="#9AA69F" Margin="0,0,0,7"/>
            <ComboBox x:Name="LanguageBox" Height="42" SelectedIndex="0"><ComboBoxItem Content="English" Tag="en"/><ComboBoxItem Content="Français" Tag="fr"/><ComboBoxItem Content="Español" Tag="es"/></ComboBox>
            <Button x:Name="AppUpdateButton" Style="{StaticResource GhostButton}" Content="UPDATE APPLICATION" Margin="0,20,0,8"/>
            <Button x:Name="FrostyButton" Style="{StaticResource GhostButton}" Content="INSTALL / OPEN FROSTY MOD MANAGER" Margin="0,0,0,8"/>
            <Button x:Name="SettingsInstallButton" Style="{StaticResource GhostButton}" Content="INSTALL SERVER" Margin="0,0,0,8"/>
            <Button x:Name="SettingsRepairButton" Style="{StaticResource GhostButton}" Content="REPAIR SERVER" Margin="0,0,0,8"/>
            <TextBlock x:Name="SettingsHint" Text="FIFA starts separately after the local server is ready." Foreground="#78857E" TextWrapping="Wrap" Margin="0,18,0,0"/>
          </StackPanel>
        </Grid>
      </Border>

      <!-- friends drawer -->
      <Border x:Name="FriendsDrawer" Grid.RowSpan="2" Grid.ColumnSpan="3" Width="430" HorizontalAlignment="Right" Background="#FB08110F" BorderBrush="#385044" BorderThickness="1,0,0,0" Visibility="Collapsed" Panel.ZIndex="50" Effect="{StaticResource SoftShadow}">
        <Grid Margin="24">
          <Grid.RowDefinitions><RowDefinition Height="62"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
          <Grid><StackPanel VerticalAlignment="Center"><TextBlock x:Name="FriendsTitleText" Text="FRIENDS" FontSize="19" FontWeight="Bold"/><TextBlock Text="MNG FUT SOCIAL" FontSize="8" Foreground="#68766F" Margin="0,3,0,0"/></StackPanel><Button x:Name="CloseFriendsButton" Style="{StaticResource NavButton}" Content="×" Width="40" Height="40" HorizontalAlignment="Right" FontSize="21"/></Grid>
          <Border Grid.Row="1" Background="#0F1A17" CornerRadius="11" BorderBrush="#30453B" BorderThickness="1" Padding="9" Margin="0,6,0,14"><Grid><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><TextBox x:Name="FriendSearchBox" Grid.Column="0" BorderThickness="0" Background="Transparent" ToolTip="Pseudo MNG"/><Button x:Name="FriendSearchButton" Grid.Column="1" Style="{StaticResource PrimaryButton}" Content="Search" Padding="13,8" Margin="8,0,0,0"/></Grid></Border>
          <StackPanel Grid.Row="2"><TextBlock x:Name="SocialStatusText" Text="Social server: checking..." Foreground="#738078" FontSize="10" Margin="2,0,0,10"/><StackPanel x:Name="SearchResultsPanel"/></StackPanel>
          <ScrollViewer Grid.Row="3" VerticalScrollBarVisibility="Auto"><StackPanel><TextBlock x:Name="RequestsLabel" Text="REQUESTS" Foreground="#8D9A93" FontSize="9" FontWeight="SemiBold" Margin="0,6,0,8"/><StackPanel x:Name="RequestsPanel"/><TextBlock x:Name="MyFriendsLabel" Text="MY FRIENDS" Foreground="#8D9A93" FontSize="9" FontWeight="SemiBold" Margin="0,18,0,8"/><StackPanel x:Name="FriendsListPanel"/></StackPanel></ScrollViewer>
          <Button x:Name="RefreshFriendsButton" Grid.Row="4" Style="{StaticResource GhostButton}" Content="Refresh friends" Margin="0,12,0,0"/>
        </Grid>
      </Border>

      <!-- account drawer -->
      <Border x:Name="AccountDrawer" Grid.RowSpan="2" Grid.ColumnSpan="3" Width="430" HorizontalAlignment="Right" Background="#FB08110F" BorderBrush="#385044" BorderThickness="1,0,0,0" Visibility="Collapsed" Panel.ZIndex="51" Effect="{StaticResource SoftShadow}">
        <Grid Margin="26"><Grid.RowDefinitions><RowDefinition Height="62"/><RowDefinition Height="*"/></Grid.RowDefinitions>
          <Grid><StackPanel VerticalAlignment="Center"><TextBlock x:Name="AccountTitleText" Text="MNG ACCOUNT" FontSize="19" FontWeight="Bold"/><TextBlock x:Name="AccountFeaturesText" Text="LOGIN • CLOUD SAVE • SOCIAL" FontSize="8" Foreground="#68766F" Margin="0,3,0,0"/></StackPanel><Button x:Name="CloseAccountButton" Style="{StaticResource NavButton}" Content="×" Width="40" Height="40" HorizontalAlignment="Right" FontSize="21"/></Grid>
          <StackPanel Grid.Row="1" x:Name="LoginPanel"><TextBlock x:Name="LoginTitleText" Text="Connect to MNG FUT" FontSize="25" FontWeight="SemiBold" Margin="0,24,0,6"/><TextBlock x:Name="LoginDescriptionText" Text="Use the same MNG account as your FIFA 17 Cloud Save." Foreground="#84918A" TextWrapping="Wrap" Margin="0,0,0,24"/><TextBlock x:Name="UsernameLabel" Text="Username" Foreground="#9AA69F" FontSize="10" Margin="0,0,0,5"/><TextBox x:Name="LoginUserBox" Height="42"/><TextBlock x:Name="PasswordLabel" Text="Password" Foreground="#9AA69F" FontSize="10" Margin="0,15,0,5"/><PasswordBox x:Name="LoginPasswordBox" Height="42"/><TextBlock x:Name="LoginMessage" Foreground="#E4C665" TextWrapping="Wrap" Margin="0,14,0,0"/><StackPanel Orientation="Horizontal" Margin="0,20,0,0"><Button x:Name="LoginSubmitButton" Style="{StaticResource PrimaryButton}" Content="Login" Width="150"/><Button x:Name="RegisterButton" Style="{StaticResource GhostButton}" Content="Create account" Width="160" Margin="10,0,0,0"/></StackPanel><Button x:Name="LegacyLoginButton" Style="{StaticResource GhostButton}" Content="Open maintenance launcher" Margin="0,26,0,0"/></StackPanel>
          <StackPanel Grid.Row="1" x:Name="LoggedPanel" Visibility="Collapsed"><Border Width="84" Height="84" CornerRadius="42" Background="#16241E" BorderBrush="#DDFD45" BorderThickness="2" HorizontalAlignment="Left" Margin="0,25,0,16"><TextBlock Text="M" FontSize="34" FontWeight="Black" Foreground="#DDFD45" HorizontalAlignment="Center" VerticalAlignment="Center"/></Border><TextBlock x:Name="LoggedUserText" Text="Player" FontSize="27" FontWeight="SemiBold"/><TextBlock x:Name="LoggedPersonaText" Text="MNG FUT account" Foreground="#839087" Margin="0,6,0,0"/><Border Background="#0F1A17" CornerRadius="12" BorderBrush="#31463C" BorderThickness="1" Padding="15" Margin="0,24,0,0"><StackPanel><TextBlock Text="●  Connected" Foreground="#9BEA70" FontWeight="SemiBold"/><TextBlock Text="Friends and presence are synchronized while this launcher is open." Foreground="#78857E" FontSize="10" TextWrapping="Wrap" Margin="0,7,0,0"/></StackPanel></Border><Button x:Name="LogoutButton" Style="{StaticResource GhostButton}" Content="Logout" Margin="0,24,0,0" Width="120" HorizontalAlignment="Left"/></StackPanel>
        </Grid>
      </Border>
    </Grid>
    </ScrollViewer>
    <Border Width="24" Height="24" HorizontalAlignment="Right" VerticalAlignment="Bottom" Margin="0,0,3,3" Background="#B616241F" BorderBrush="#62786B" BorderThickness="1" CornerRadius="4" Panel.ZIndex="80" ToolTip="Redimensionner la fenêtre">
      <ResizeGrip Foreground="#DDFD45" HorizontalAlignment="Stretch" VerticalAlignment="Stretch"/>
    </Border>
  </Grid>
</Window>
'@

$reader=New-Object System.Xml.XmlNodeReader $xaml
$window=[Windows.Markup.XamlReader]::Load($reader)
function C([string]$name){return $window.FindName($name)}

$AccountButton=C 'AccountButton'; $FriendsTopButton=C 'FriendsTopButton'; $FriendsNavButton=C 'FriendsNavButton'; $FindFriendsButton=C 'FindFriendsButton'
$NotificationsButton=C 'NotificationsButton';$NotificationsPopup=C 'NotificationsPopup';$CloseNotificationsButton=C 'CloseNotificationsButton';$NotificationsList=C 'NotificationsList';$NotificationsTitle=C 'NotificationsTitle'
$NotificationImageOverlay=C 'NotificationImageOverlay';$NotificationLargeImage=C 'NotificationLargeImage';$CloseNotificationImageButton=C 'CloseNotificationImageButton'
$FriendsDrawer=C 'FriendsDrawer'; $AccountDrawer=C 'AccountDrawer'; $CloseFriendsButton=C 'CloseFriendsButton'; $CloseAccountButton=C 'CloseAccountButton'
$FriendsListPanel=C 'FriendsListPanel'; $RequestsPanel=C 'RequestsPanel'; $SearchResultsPanel=C 'SearchResultsPanel'; $SocialStatusText=C 'SocialStatusText'
$FriendSearchBox=C 'FriendSearchBox'; $FriendSearchButton=C 'FriendSearchButton'; $RefreshFriendsButton=C 'RefreshFriendsButton'
$PlayButton=C 'PlayButton'; $LaunchGameButton=C 'LaunchGameButton'; $LaunchStatus=C 'LaunchStatus'; $AccountStatus=C 'AccountStatus'; $GamePathText=C 'GamePathText'; $ChangeFolderButton=C 'ChangeFolderButton'; $GameHeaderText=C 'GameHeaderText'
$ShowLogsCheckBox=C 'ShowLogsCheckBox';$LogsPanel=C 'LogsPanel';$ServerLogsBox=C 'ServerLogsBox';$HeroSlogan=C 'HeroSlogan'
$SettingsButton=C 'SettingsButton'; $SettingsNavButton=C 'SettingsNavButton'; $MaintenanceButton=C 'MaintenanceButton'; $FindSquadButton=C 'FindSquadButton'
$InstallButton=C 'InstallButton';$UpdateServerButton=C 'UpdateServerButton';$RepairButton=C 'RepairButton'
$SettingsDrawer=C 'SettingsDrawer';$CloseSettingsButton=C 'CloseSettingsButton';$SettingsTitle=C 'SettingsTitle';$LanguageLabel=C 'LanguageLabel';$LanguageBox=C 'LanguageBox'
$AppUpdateButton=C 'AppUpdateButton';$FrostyButton=C 'FrostyButton';$SettingsInstallButton=C 'SettingsInstallButton';$SettingsRepairButton=C 'SettingsRepairButton';$SettingsHint=C 'SettingsHint'
$LoginPanel=C 'LoginPanel';$LoggedPanel=C 'LoggedPanel';$LoginUserBox=C 'LoginUserBox';$LoginPasswordBox=C 'LoginPasswordBox';$LoginMessage=C 'LoginMessage'
$LoginSubmitButton=C 'LoginSubmitButton';$RegisterButton=C 'RegisterButton';$LegacyLoginButton=C 'LegacyLoginButton';$LoggedUserText=C 'LoggedUserText';$LoggedPersonaText=C 'LoggedPersonaText';$LogoutButton=C 'LogoutButton'
$HomeNavText=C 'HomeNavText';$FriendsNavText=C 'FriendsNavText';$SettingsNavText=C 'SettingsNavText';$GamesLabel=C 'GamesLabel'
$HeroTitleText=C 'HeroTitleText';$HeroSubtitleText=C 'HeroSubtitleText';$HeroDescriptionText=C 'HeroDescriptionText'
$NextSessionLabel=C 'NextSessionLabel';$NextSessionTitle=C 'NextSessionTitle';$NextSessionDescription=C 'NextSessionDescription';$PassionText=C 'PassionText'
$CommunityLabel=C 'CommunityLabel';$CommunityTitle=C 'CommunityTitle';$CommunityDescription=C 'CommunityDescription'
$FriendsTitleText=C 'FriendsTitleText';$RequestsLabel=C 'RequestsLabel';$MyFriendsLabel=C 'MyFriendsLabel'
$AccountTitleText=C 'AccountTitleText';$AccountFeaturesText=C 'AccountFeaturesText';$LoginTitleText=C 'LoginTitleText';$LoginDescriptionText=C 'LoginDescriptionText';$UsernameLabel=C 'UsernameLabel';$PasswordLabel=C 'PasswordLabel'
$HeroImage=C 'HeroImage';$BackgroundImage=C 'BackgroundImage'
$AppLogoImage=C 'AppLogoImage';$Fifa14Image=C 'Fifa14Image';$Fifa15Image=C 'Fifa15Image';$Fifa17Image=C 'Fifa17Image';$Fifa20Image=C 'Fifa20Image'
$Fifa14Tile=C 'Fifa14Tile';$Fifa15Tile=C 'Fifa15Tile';$Fifa17Tile=C 'Fifa17Tile';$Fifa20Tile=C 'Fifa20Tile'
$Fifa21Tile=C 'Fifa21Tile';$Fifa21Image=C 'Fifa21Image'
try{
  $heroPath=Join-Path $script:AppRoot 'assets\hero.jpg'
  if(Test-Path -LiteralPath $heroPath){$HeroImage.Source=[Windows.Media.Imaging.BitmapImage]::new([Uri]$heroPath)}
  $bgPath=Join-Path $script:AppRoot 'assets\background.jpg'
  if(Test-Path -LiteralPath $bgPath){$BackgroundImage.Source=[Windows.Media.Imaging.BitmapImage]::new([Uri]$bgPath)}
  $logoPath=Join-Path $script:AppRoot 'assets\logo.png'
  if(Test-Path -LiteralPath $logoPath){$logoBitmap=[Windows.Media.Imaging.BitmapImage]::new([Uri]$logoPath);$AppLogoImage.Source=$logoBitmap;$window.Icon=$logoBitmap}
  $fifa14ImagePath=Join-Path $script:AppRoot 'assets\numero\fifa14.png'
  if(Test-Path -LiteralPath $fifa14ImagePath){$Fifa14Image.Source=[Windows.Media.Imaging.BitmapImage]::new([Uri]$fifa14ImagePath)}
  $fifa15ImagePath=Join-Path $script:AppRoot 'assets\numero\fifa15.png'
  if(Test-Path -LiteralPath $fifa15ImagePath){$Fifa15Image.Source=[Windows.Media.Imaging.BitmapImage]::new([Uri]$fifa15ImagePath)}
  $fifa17ImagePath=Join-Path $script:AppRoot 'assets\numero\fifa17.png'
  if(Test-Path -LiteralPath $fifa17ImagePath){$Fifa17Image.Source=[Windows.Media.Imaging.BitmapImage]::new([Uri]$fifa17ImagePath)}
  $fifa20ImagePath=Join-Path $script:AppRoot 'assets\numero\fifa20.png'
  if(Test-Path -LiteralPath $fifa20ImagePath){$Fifa20Image.Source=[Windows.Media.Imaging.BitmapImage]::new([Uri]$fifa20ImagePath)}
  $fifa21ImagePath=Join-Path $script:AppRoot 'assets\numero\fifa21.png'
  if(Test-Path -LiteralPath $fifa21ImagePath){$Fifa21Image.Source=[Windows.Media.Imaging.BitmapImage]::new([Uri]$fifa21ImagePath)}
}catch{}

function New-Text([string]$Text,[string]$Color='#EAF0EC',[double]$Size=12,[string]$Weight='Normal'){
    $tb=New-Object Windows.Controls.TextBlock;$tb.Text=$Text;$tb.Foreground=$Color;$tb.FontSize=$Size;$tb.FontWeight=$Weight;$tb.VerticalAlignment='Center';$tb.TextTrimming='CharacterEllipsis';return $tb
}
function New-MiniButton([string]$Text,[scriptblock]$Handler,[bool]$Accent=$false){
    $b=New-Object Windows.Controls.Button;$b.Content=$Text;$b.Padding='9,5';$b.Margin='5,0,0,0';$b.Cursor='Hand';$b.BorderThickness='1';$b.BorderBrush='#3B4B43';$b.FontSize=10
    if($Accent){$b.Background='#D9FF45';$b.Foreground='#0C120E'}else{$b.Background='#17221E';$b.Foreground='#EAF0EC'}
    $b.Add_Click($Handler);return $b
}
function New-RowBorder(){ $b=New-Object Windows.Controls.Border;$b.Background='#0E1814';$b.BorderBrush='#26372F';$b.BorderThickness='1';$b.CornerRadius='9';$b.Padding='11';$b.Margin='0,0,0,7';return $b }

function Get-NotificationText($notification,[string]$field){
    $localized=$field+'_'+$script:Lang
    if($notification.PSObject.Properties.Name -contains $localized -and -not [string]::IsNullOrWhiteSpace([string]$notification.$localized)){return [string]$notification.$localized}
    return [string]$notification.$field
}
function Show-NotificationImage([string]$url){
    if([string]::IsNullOrWhiteSpace($url)){return}
    try{$bitmap=New-Object Windows.Media.Imaging.BitmapImage;$bitmap.BeginInit();$bitmap.CacheOption='OnLoad';$bitmap.UriSource=[Uri]$url;$bitmap.EndInit();$NotificationLargeImage.Source=$bitmap;$NotificationImageOverlay.Visibility='Visible'}catch{}
}
function Refresh-Notifications(){
    try{
        $url=$script:NotificationsUrl+'?mng='+[DateTime]::UtcNow.Ticks
        $feed=Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 12
        $script:Notifications=@($feed.notifications|Where-Object{$_.enabled -ne $false})
        $seen=Read-JsonFile $script:NotificationsSeenPath;$seenIds=if($seen){@($seen.ids|ForEach-Object{[string]$_})}else{@()}
        $unread=@($script:Notifications|Where-Object{$seenIds -notcontains [string]$_.id}).Count
        $badge=if($unread -gt 9){'9+'}elseif($unread -gt 0){[string]$unread}else{''}
        $NotificationsButton.Content=if($badge){'🔔  '+$badge}else{'🔔'}
        $NotificationsButton.BorderBrush=if($unread -gt 0){$script:ThemeAccent}else{'#344A40'}
        $NotificationsList.Children.Clear()
        foreach($notification in $script:Notifications){
            $card=New-RowBorder;$card.Padding='10';$button=New-Object Windows.Controls.Button;$button.Background='Transparent';$button.BorderThickness='0';$button.HorizontalContentAlignment='Stretch';$button.Cursor='Hand'
            $grid=New-Object Windows.Controls.Grid;$grid.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition -Property @{Width='82'}));$grid.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition -Property @{Width='*'}))|Out-Null
            $imageUrl=[string]$notification.imageUrl
            if($imageUrl){try{$thumb=New-Object Windows.Controls.Image;$thumb.Width=72;$thumb.Height=54;$thumb.Stretch='UniformToFill';$thumb.Source=[Windows.Media.Imaging.BitmapImage]::new([Uri]$imageUrl);$grid.Children.Add($thumb)|Out-Null}catch{}}
            $stack=New-Object Windows.Controls.StackPanel;[Windows.Controls.Grid]::SetColumn($stack,1);$stack.Children.Add((New-Text (Get-NotificationText $notification 'title') '#F3F6F4' 12 'SemiBold'))|Out-Null
            $description=New-Text (Get-NotificationText $notification 'description') '#829088' 10;$description.TextWrapping='Wrap';$description.TextTrimming='CharacterEllipsis';$description.MaxHeight=34;$stack.Children.Add($description)|Out-Null;$grid.Children.Add($stack)|Out-Null
            $button.Content=$grid;if($imageUrl){$button.Add_Click({param($s,$e) Show-NotificationImage $imageUrl}.GetNewClosure())};$card.Child=$button;$NotificationsList.Children.Add($card)|Out-Null
        }
        if($NotificationsList.Children.Count -eq 0){$NotificationsList.Children.Add((New-Text (T 'No notifications.' 'Aucune notification.' 'No hay notificaciones.') '#68766F' 11))|Out-Null}
    }catch{$NotificationsList.Children.Clear();$NotificationsList.Children.Add((New-Text (T 'Notifications unavailable.' 'Notifications indisponibles.' 'Notificaciones no disponibles.') '#D19C67' 11))|Out-Null}
}
function Open-Notifications(){
    Refresh-Notifications;$NotificationsPopup.Visibility='Visible'
    $ids=@($script:Notifications|ForEach-Object{[string]$_.id});Write-JsonFile $script:NotificationsSeenPath ([pscustomobject]@{ids=$ids});$NotificationsButton.Content='🔔';$NotificationsButton.BorderBrush='#344A40'
}

function Update-AccountUi(){
    if($script:Profile){
        $name=[string]$script:Profile.username
        $AccountButton.Content=('👤  '+$name)
        $AccountStatus.Text=((T 'Account: ' 'Compte : ' 'Cuenta: ')+$name+(T ' connected' ' connecté' ' conectada'))
        $AccountStatus.Foreground='#78A96B'
        $LoginPanel.Visibility='Collapsed';$LoggedPanel.Visibility='Visible';$LoggedUserText.Text=$name
        $personaIdText=[string]$script:Profile.personaId;$LoggedPersonaText.Text= if($personaIdText){'Persona '+$personaIdText}else{T 'MNG FUT account' 'Compte MNG FUT' 'Cuenta MNG FUT'}
    }else{
        $AccountButton.Content=('👤  '+(T 'Login' 'Connexion' 'Iniciar sesión'));$AccountStatus.Text=T 'Account: not connected' 'Compte : non connecté' 'Cuenta: no conectada';$AccountStatus.Foreground='#7F8A84';$LoginPanel.Visibility='Visible';$LoggedPanel.Visibility='Collapsed'
    }
}
function Get-SelectedGame(){
    switch($script:SelectedGame){
        '14' { return [pscustomobject]@{Id='14';Name='FIFA 14';ExeProperty='Fifa14Exe';Filter='FIFA14.exe|FIFA14.exe';ServerProperty='Fifa14ServerRoot';ServerScript='tools\launch_fifa14_hub_store.ps1'} }
        '15' { return [pscustomobject]@{Id='15';Name='FIFA 15';ExeProperty='Fifa15Exe';Filter='fifa15.exe|fifa15.exe';ServerProperty='Fifa15ServerRoot';ServerScript='payload\START_LOCAL_FUT15.cmd'} }
        '20' { return [pscustomobject]@{Id='20';Name='FIFA 20';ExeProperty='Fifa20Exe';Filter='FIFA20.exe|FIFA20.exe';ServerProperty='Fifa20ServerRoot';ServerScript='Launch.ps1'} }
        '21' { return [pscustomobject]@{Id='21';Name='FIFA 21';ExeProperty='Fifa21Exe';Filter='FIFA21.exe|FIFA21.exe';ServerProperty='Fifa21ServerRoot';ServerScript=''} }
        default { return [pscustomobject]@{Id='17';Name='FIFA 17';ExeProperty='GameExe';Filter='FIFA17.exe|FIFA17.exe';ServerProperty='';ServerScript=''} }
    }
}
function Get-SelectedGameExe(){
    $game=Get-SelectedGame;$s=Get-Settings
    return [string]$s.($game.ExeProperty)
}
function Update-GamePathUi(){
    $game=Get-SelectedGame;$p=Get-SelectedGameExe
    if($p){$GamePathText.Text=($game.Name+': '+$p)}else{$GamePathText.Text=(T ($game.Name+' folder: not selected') ('Dossier '+$game.Name+' : non sélectionné') ('Carpeta de '+$game.Name+': no seleccionada'))}
    $GameHeaderText.Text=($game.Name+'  •  '+(T 'COMMUNITY SERVER' 'SERVEUR COMMUNAUTAIRE' 'SERVIDOR COMUNITARIO'))
    if($game.Id -eq '21'){$GameHeaderText.Text='FIFA 21  •  '+(T 'SERVER IN PREPARATION' 'SERVEUR EN PRÉPARATION' 'SERVIDOR EN PREPARACIÓN')}
}
function Set-GameTheme([string]$GameId){
    $accent=switch($GameId){'14'{'#9D1F2D'}'20'{'#FF365E'}'21'{'#B25CFF'}default{'#DDFD45'}}
    $previous=$script:ThemeAccent
    $previousColor=[Windows.Media.ColorConverter]::ConvertFromString($previous)
    function Update-ThemeElement($element){
        if(-not $element){return}
        foreach($property in @('Background','Foreground','BorderBrush','Fill','Stroke','CaretBrush')){
            try{
                $brush=$element.$property
                if($brush -is [Windows.Media.SolidColorBrush] -and $brush.Color -eq $previousColor){
                    $element.$property=[Windows.Media.BrushConverter]::new().ConvertFromString($accent)
                }
            }catch{}
        }
        try{for($index=0;$index -lt [Windows.Media.VisualTreeHelper]::GetChildrenCount($element);$index++){Update-ThemeElement ([Windows.Media.VisualTreeHelper]::GetChild($element,$index))}}catch{}
    }
    Update-ThemeElement $window
    try{$window.Resources['Accent'].Color=[Windows.Media.ColorConverter]::ConvertFromString($accent)}catch{}
    $script:ThemeAccent=$accent
}
function Select-Game([string]$GameId){
    $script:SelectedGame=$GameId
    Set-GameTheme $GameId
    foreach($tile in @($Fifa14Tile,$Fifa15Tile,$Fifa17Tile,$Fifa20Tile,$Fifa21Tile)){$tile.BorderBrush='#30453B';$tile.BorderThickness='1';$tile.Background='Transparent'}
    $selectedTile=@{'14'=$Fifa14Tile;'15'=$Fifa15Tile;'17'=$Fifa17Tile;'20'=$Fifa20Tile;'21'=$Fifa21Tile}[$GameId]
    $selectedTile.BorderBrush=$script:ThemeAccent;$selectedTile.BorderThickness='2';$selectedTile.Background='#B818241D'
    $LaunchGameButton.IsEnabled=$false
    Apply-Language
    $LaunchStatus.Text=('●  '+(Get-SelectedGame).Name+' '+(T 'selected' 'sélectionné' 'seleccionado'));$LaunchStatus.Foreground=$script:ThemeAccent
}
function Test-ManagedServerRunning([string]$GameId=$script:SelectedGame){
    if($GameId -eq '21'){return $false}
    if($script:ActiveServerGame -and $script:ActiveServerGame -ne $GameId){return $false}
    try{
        if($script:ServerProcess -and -not $script:ServerProcess.HasExited){return $true}
    }catch{$script:ServerProcess=$null}
    $ports=switch($GameId){
        '17' {@(8000,8094)}
        '20' {@(8080,8081,42232,47220)}
        default {@()}
    }
    if($ports -and @((Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$ports -contains $_.LocalPort})).Count -gt 0){return $true}
    if($GameId -eq '14'){
        return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.CommandLine -match 'launch_fifa14_hub_store\.ps1|fifa14'}).Count -gt 0
    }
    if($GameId -eq '15'){
        return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.CommandLine -match 'START_LOCAL_FUT15\.cmd|localfut15[\\/]server\.py'}).Count -gt 0
    }
    return $false
}
function Apply-Language(){
    $running=Test-ManagedServerRunning
    $PlayButton.Content=if($running){T '■   STOP SERVER' '■   ARRÊTER LE SERVEUR' '■   DETENER SERVIDOR'}else{T '▶   START SERVER' '▶   LANCER LE SERVEUR' '▶   INICIAR SERVIDOR'}
    if($script:SelectedGame -in @('17','20')){
        $frostyInstalled=Test-Path -LiteralPath (Join-Path $script:AppRoot 'frosty-package\FrostyModManager.exe')
        $LaunchGameButton.IsEnabled=$true
        $LaunchGameButton.Content=if($frostyInstalled){T '▶   OPEN FROSTY' '▶   OUVRIR FROSTY' '▶   ABRIR FROSTY'}else{T '↓   INSTALL FROSTY' '↓   INSTALLER FROSTY' '↓   INSTALAR FROSTY'}
    }else{
        $LaunchGameButton.IsEnabled=$running
        $LaunchGameButton.Content=T '▶   PLAY' '▶   JOUER' '▶   JUGAR'
    }
    $InstallButton.Content=T 'INSTALL' 'INSTALLER' 'INSTALAR';$UpdateServerButton.Content=T 'CHECK SERVER UPDATE' 'RECHERCHER UNE MISE À JOUR' 'BUSCAR ACTUALIZACIÓN';$RepairButton.Content=T 'REPAIR' 'RÉPARER' 'REPARAR'
    $ChangeFolderButton.Content=(T '▣  CHOOSE ' '▣  CHOISIR ' '▣  ELEGIR ')+(Get-SelectedGame).Name+'.EXE'
    $SettingsTitle.Text=T 'SETTINGS' 'RÉGLAGES' 'AJUSTES';$LanguageLabel.Text=T 'Language' 'Langue' 'Idioma'
    $AppUpdateButton.Content=T 'UPDATE APPLICATION' "METTRE À JOUR L’APPLICATION" 'ACTUALIZAR APLICACIÓN';$FrostyButton.Content=T 'INSTALL / OPEN FROSTY MOD MANAGER' 'INSTALLER / OUVRIR FROSTY MOD MANAGER' 'INSTALAR / ABRIR FROSTY MOD MANAGER'
    $SettingsInstallButton.Content=T 'INSTALL SERVER' 'INSTALLER LE SERVEUR' 'INSTALAR SERVIDOR';$SettingsRepairButton.Content=T 'REPAIR SERVER' 'RÉPARER LE SERVEUR' 'REPARAR SERVIDOR'
    $SettingsHint.Text=T 'FIFA starts separately after the local server is ready.' 'FIFA se lance séparément lorsque le serveur local est prêt.' 'FIFA se inicia por separado cuando el servidor local está listo.'
    $preparing=$script:SelectedGame -eq '21'
    foreach($button in @($InstallButton,$UpdateServerButton,$RepairButton,$SettingsInstallButton,$SettingsRepairButton,$FrostyButton)){$button.IsEnabled=-not $preparing}
    if($preparing){
        $PlayButton.Content=T 'SERVER IN PREPARATION' 'SERVEUR EN PRÉPARATION' 'SERVIDOR EN PREPARACIÓN'
        $LaunchGameButton.IsEnabled=$true
        $LaunchGameButton.Content=T '▶   LAUNCH FIFA 21' '▶   LANCER FIFA 21' '▶   INICIAR FIFA 21'
        $SettingsHint.Text=T 'FIFA 21 launches normally. The private server connection is not validated yet.' 'FIFA 21 se lance normalement. La connexion au serveur privé reste à valider.' 'FIFA 21 se inicia normalmente. La conexión al servidor privado aún no está validada.'
    }
    $ShowLogsCheckBox.Content=T 'Show logs' 'Afficher les logs' 'Mostrar registros'
    $HomeNavText.Text=T 'Home' 'Accueil' 'Inicio';$FriendsNavText.Text=T 'Friends' 'Amis' 'Amigos';$SettingsNavText.Text=T 'Settings' 'Réglages' 'Ajustes';$GamesLabel.Text=T 'GAMES' 'JEUX' 'JUEGOS'
    $HeroTitleText.Text=T 'RELIVE' 'REVIVEZ' 'REVIVE';$HeroSubtitleText.Text=T 'the good days.' 'les beaux jours.' 'los buenos tiempos.';$HeroDescriptionText.Text=T 'Your club. Your colors. Your next great match.' 'Votre club. Vos couleurs. Votre prochain grand match.' 'Tu club. Tus colores. Tu próximo gran partido.'
    $NextSessionLabel.Text=T 'YOUR NEXT SESSION' 'VOTRE PROCHAINE SESSION' 'TU PRÓXIMA SESIÓN';$NextSessionTitle.Text=T 'Make every match count.' 'Faites compter chaque match.' 'Haz que cada partido cuente.';$NextSessionDescription.Text=T 'Your game is connected. Pick up exactly where you left off.' 'Votre jeu est connecté. Reprenez exactement là où vous vous étiez arrêté.' 'Tu juego está conectado. Continúa exactamente donde lo dejaste.'
    $PassionText.Text=T 'SAME PASSION. A STRONGER COMMUNITY.' 'UNE MÊME PASSION. UNE COMMUNAUTÉ PLUS FORTE.' 'UNA MISMA PASIÓN. UNA COMUNIDAD MÁS FUERTE.'
    $CommunityLabel.Text=T 'ALL SET, TOGETHER' 'TOUT EST PRÊT, ENSEMBLE' 'TODO LISTO, JUNTOS';$CommunityTitle.Text=T 'A community that plays together.' 'Une communauté qui joue ensemble.' 'Una comunidad que juega unida.';$CommunityDescription.Text=T 'Your MNG account connects Friends, Cloud Save and FIFA 17.' 'Votre compte MNG relie vos amis, votre sauvegarde cloud et FIFA 17.' 'Tu cuenta MNG conecta tus amigos, tu guardado en la nube y FIFA 17.'
    $FindFriendsButton.Content=T '👥   Find friends and requests                                      →' '👥   Rechercher des amis et demandes                              →' '👥   Buscar amigos y solicitudes                                    →';$SettingsButton.Content=T '⚙    Launcher settings                                             →' '⚙    Réglages du lanceur                                           →' '⚙    Ajustes del lanzador                                           →';$MaintenanceButton.Content=T '↻    Repair / maintenance tools                                    →' '↻    Outils de réparation / maintenance                            →' '↻    Herramientas de reparación / mantenimiento                    →'
    $FriendsTitleText.Text=T 'FRIENDS' 'AMIS' 'AMIGOS';$FriendSearchButton.Content=T 'Search' 'Rechercher' 'Buscar';$RequestsLabel.Text=T 'REQUESTS' 'DEMANDES' 'SOLICITUDES';$MyFriendsLabel.Text=T 'MY FRIENDS' 'MES AMIS' 'MIS AMIGOS';$RefreshFriendsButton.Content=T 'Refresh friends' 'Actualiser les amis' 'Actualizar amigos'
    $AccountTitleText.Text=T 'MNG ACCOUNT' 'COMPTE MNG' 'CUENTA MNG';$AccountFeaturesText.Text=T 'LOGIN • CLOUD SAVE • SOCIAL' 'CONNEXION • SAUVEGARDE CLOUD • SOCIAL' 'INICIO DE SESIÓN • GUARDADO EN LA NUBE • SOCIAL';$LoginTitleText.Text=T 'Connect to MNG FUT' 'Se connecter à MNG FUT' 'Conectarse a MNG FUT';$LoginDescriptionText.Text=T 'Use the same MNG account as your FIFA 17 Cloud Save.' 'Utilisez le même compte MNG que pour votre sauvegarde cloud FIFA 17.' 'Usa la misma cuenta MNG que para tu guardado en la nube de FIFA 17.'
    $UsernameLabel.Text=T 'Username' 'Identifiant' 'Nombre de usuario';$PasswordLabel.Text=T 'Password' 'Mot de passe' 'Contraseña';$LoginSubmitButton.Content=T 'Login' 'Se connecter' 'Iniciar sesión';$RegisterButton.Content=T 'Create account' 'Créer un compte' 'Crear una cuenta';$LegacyLoginButton.Content=T 'Open maintenance tools' 'Ouvrir les outils de maintenance' 'Abrir herramientas de mantenimiento';$LogoutButton.Content=T 'Logout' 'Se déconnecter' 'Cerrar sesión'
    Update-GamePathUi
    Update-AccountUi
}
function Read-ServerLogFile([string]$Path,[int]$MaxCharacters=18000){
    if(-not(Test-Path -LiteralPath $Path)){return ''}
    try{
        $stream=New-Object IO.FileStream($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
        try{$reader=New-Object IO.StreamReader($stream);$text=$reader.ReadToEnd();$reader.Dispose()}finally{$stream.Dispose()}
        if($text.Length -gt $MaxCharacters){return $text.Substring($text.Length-$MaxCharacters)}
        return $text
    }catch{return ''}
}
function Refresh-ServerLogs(){
    $settings=Get-Settings;$sections=@()
    switch($script:SelectedGame){
        '20' {
            $runtime=Join-Path ([string]$settings.Fifa20ServerRoot) 'runtime'
            foreach($entry in @(
                @{Title='FIFA 20 - STATUS';Path=(Join-Path $runtime 'launcher-status.json')},
                @{Title='FIFA 20 - LAUNCHER';Path=(Join-Path $runtime 'launcher-console.log')},
                @{Title='FIFA 20 - SERVER';Path=(Join-Path $runtime 'server.error.log')},
                @{Title='FIFA 20 - REDIRECTOR';Path=(Join-Path $runtime 'redirector.log')},
                @{Title='FIFA 20 - CONTROL';Path=(Join-Path $runtime 'control.log')}
            )){$content=Read-ServerLogFile $entry.Path;if($content){$sections+=('['+$entry.Title+"]`r`n"+$content)}}
        }
        '17' {
            $content=Read-ServerLogFile (Join-Path $script:AppRoot 'bridge\BRIDGE-RUNTIME.log')
            if($content){$sections+=('[FIFA 17 - BRIDGE]'+"`r`n"+$content)}
        }
        default {
            $sections+=(T ('Logs for FIFA '+$script:SelectedGame+' will appear when its server writes them.') ('Les logs de FIFA '+$script:SelectedGame+' apparaîtront lorsque son serveur en produira.') ('Los registros de FIFA '+$script:SelectedGame+' aparecerán cuando su servidor los genere.'))
        }
    }
    $text=$sections -join "`r`n`r`n"
    if($ServerLogsBox.Text -ne $text){$ServerLogsBox.Text=$text;$ServerLogsBox.ScrollToEnd()}
}
function Choose-GameExe(){
    $game=Get-SelectedGame;$dlg=New-Object Microsoft.Win32.OpenFileDialog;$dlg.Title=(T 'Select ' 'Sélectionner ' 'Seleccionar ')+$game.Name+'.exe';$dlg.Filter=$game.Filter
    if($dlg.ShowDialog() -eq $true){$exe=[IO.Path]::GetFullPath($dlg.FileName);$s=Get-Settings;Set-Property $s $game.ExeProperty $exe;if($game.Id -eq '17'){Set-Property $s 'GameRoot' (Split-Path -Parent $exe)};Write-JsonFile $script:SettingsPath $s;Apply-Language}
}
function Open-Settings(){
    $FriendsDrawer.Visibility='Collapsed';$AccountDrawer.Visibility='Collapsed';$SettingsDrawer.Visibility='Visible'
    for($i=0;$i -lt $LanguageBox.Items.Count;$i++){if([string]$LanguageBox.Items[$i].Tag -eq $script:Lang){$LanguageBox.SelectedIndex=$i;break}}
}
function Stop-MngServer(){
    try{if($script:ServerProcess -and -not $script:ServerProcess.HasExited){$script:ServerProcess.Kill()}}catch{};$script:ServerProcess=$null
    $script:ActiveServerGame=''
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessId -ne $PID -and (
            $_.Name -eq 'MNGBridge.exe' -or
            ($_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'Start-Local-FIFA17-Test\.ps1|launch_fifa14_hub_store\.ps1|\\MNG-FUT-20\\Launch\.ps1') -or
            ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'local-server\.js|fut-backend\.js') -or
            ($_.Name -match '^(?:python|pythonw|py|pyw)(?:\.exe)?$' -and $_.CommandLine -match 'localfut15[\\/]server\.py|fifa14|localfut20|launcher\.py|runtime_runner\.py|redirector_tls\.py')
        )
    } | ForEach-Object {try{Stop-ProcessTree $_.ProcessId}catch{}}
    $LaunchStatus.Text=T '●  Server stopped' '●  Serveur arrêté' '●  Servidor detenido';$LaunchStatus.Foreground='#AAB7B0';Apply-Language
}
function Start-Fifa14Server(){
    $s=Get-Settings;$root=[string]$s.Fifa14ServerRoot;$scriptPath=Join-Path $root 'tools\launch_fifa14_hub_store.ps1'
    if(-not(Test-Path -LiteralPath $scriptPath)){throw (T 'FIFA 14 server files were not found.' 'Les fichiers serveur FIFA 14 sont introuvables.' 'No se encontraron los archivos del servidor FIFA 14.')}
    Stop-MngServer;Stop-FifaLocalServerPortOwners;Set-OperationStatus (T 'Starting FIFA 14 server...' 'Démarrage du serveur FIFA 14...' 'Iniciando servidor FIFA 14...')
    $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName='powershell.exe';$psi.Arguments=('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath);$psi.WorkingDirectory=$root;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    $script:ServerProcess=[Diagnostics.Process]::Start($psi);$script:ActiveServerGame='14';Wait-Ui 1200;$LaunchGameButton.IsEnabled=$true;Set-OperationStatus (T 'FIFA 14 server started — press Play' 'Serveur FIFA 14 démarré — appuyez sur Jouer' 'Servidor FIFA 14 iniciado — pulsa Jugar') '#87DB72';Apply-Language
}
function Start-Fifa15Server(){
    $s=Get-Settings;$root=[string]$s.Fifa15ServerRoot;$scriptPath=Join-Path $root 'payload\START_LOCAL_FUT15.cmd'
    if(-not(Test-Path -LiteralPath $scriptPath)){throw (T 'FIFA 15 server files were not found.' 'Les fichiers serveur FIFA 15 sont introuvables.' 'No se encontraron los archivos del servidor FIFA 15.')}
    Stop-MngServer;Stop-FifaLocalServerPortOwners;Set-OperationStatus (T 'Starting FIFA 15 server...' 'Démarrage du serveur FIFA 15...' 'Iniciando servidor FIFA 15...')
    $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName='cmd.exe';$psi.Arguments=('/c "{0}"' -f $scriptPath);$psi.WorkingDirectory=(Split-Path -Parent $scriptPath);$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    $script:ServerProcess=[Diagnostics.Process]::Start($psi);$script:ActiveServerGame='15';Wait-Ui 1200;$LaunchGameButton.IsEnabled=$true;Set-OperationStatus (T 'FIFA 15 server started — press Play' 'Serveur FIFA 15 démarré — appuyez sur Jouer' 'Servidor FIFA 15 iniciado — pulsa Jugar') '#87DB72';Apply-Language
}
function Start-Fifa20Server(){
    $s=Get-Settings;$root=[string]$s.Fifa20ServerRoot;$scriptPath=Join-Path $root 'Launch.ps1'
    if(-not(Test-Path -LiteralPath $scriptPath)){throw (T 'FIFA 20 server files were not found.' 'Les fichiers serveur FIFA 20 sont introuvables.' 'No se encontraron los archivos del servidor FIFA 20.')}
    Stop-MngServer;Stop-FifaLocalServerPortOwners;Set-OperationStatus (T 'Starting FIFA 20 server...' 'Démarrage du serveur FIFA 20...' 'Iniciando servidor FIFA 20...')
    $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName='powershell.exe';$psi.Arguments=('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}" -NoGameLaunch' -f $scriptPath);$psi.WorkingDirectory=$root;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    [Diagnostics.Process]::Start($psi)|Out-Null;$script:ServerProcess=$null;$script:ActiveServerGame='20'
    $deadline=(Get-Date).AddSeconds(30);$requiredPorts=@(8080,42232,44321,47220)
    do{
        Wait-Ui 300
        $listening=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$requiredPorts -contains $_.LocalPort}|Select-Object -ExpandProperty LocalPort -Unique)
        $ready=@($requiredPorts|Where-Object{$listening -contains $_}).Count -eq $requiredPorts.Count
    }while(-not $ready -and (Get-Date) -lt $deadline)
    if(-not $ready){$script:ActiveServerGame='';throw (T 'FIFA 20 server did not become ready. Open the logs for details.' 'Le serveur FIFA 20 ne s est pas initialisé. Consultez les logs pour le détail.' 'El servidor FIFA 20 no se inició. Consulta los registros para más detalles.')}
    $LaunchGameButton.IsEnabled=$true;Set-OperationStatus (T 'FIFA 20 server started — open Frosty' 'Serveur FIFA 20 démarré — ouvrez Frosty' 'Servidor FIFA 20 iniciado — abre Frosty') '#87DB72';Apply-Language;Refresh-ServerLogs
}
function Start-SelectedServer(){
    if($script:SelectedGame -eq '21'){Show-Fifa21Preparation;return}
    try{
        $PlayButton.IsEnabled=$false;Set-OperationStatus (T 'Preparing server...' 'Préparation du serveur...' 'Preparando servidor...')
        $game=Get-SelectedGame
        $exe=Get-SelectedGameExe;if(-not $exe -or -not(Test-Path -LiteralPath $exe)){Choose-GameExe;$exe=Get-SelectedGameExe;if(-not $exe){return}}
        switch($game.Id){'14' {Start-Fifa14Server} '15' {Start-Fifa15Server} '20' {Start-Fifa20Server} default {Start-MngServer;$LaunchGameButton.IsEnabled=$true}}
    }catch{$script:ServerProcess=$null;$LaunchGameButton.IsEnabled=$false;Set-OperationStatus (T 'Server failed' 'Échec du serveur' 'Error del servidor') '#E76F6F';[Windows.MessageBox]::Show($_.Exception.Message,'MNG FUT')|Out-Null}
    finally{$PlayButton.IsEnabled=$true}
}
function Stop-SelectedServer(){
    if($script:SelectedGame -eq '21'){Show-Fifa21Preparation;return}
    try{
        $PlayButton.IsEnabled=$false;Set-OperationStatus (T 'Stopping server...' 'Arrêt du serveur...' 'Deteniendo servidor...')
        $game=Get-SelectedGame
        if($game.Id -eq '20'){
            $settings=Get-Settings;$root=[string]$settings.Fifa20ServerRoot;$stopScript=Join-Path $root 'Stop.ps1'
            if(Test-Path -LiteralPath $stopScript){
                $stopProcess=Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $stopScript) -WorkingDirectory $root -Verb RunAs -PassThru
                $deadline=(Get-Date).AddSeconds(25)
                while(-not $stopProcess.HasExited -and (Get-Date) -lt $deadline){Wait-Ui 100}
            }
        }
        Stop-MngServer
        Stop-FifaLocalServerPortOwners
        $script:ServerProcess=$null;$script:ActiveServerGame='';$LaunchGameButton.IsEnabled=$false
        Set-OperationStatus (T 'Server stopped' 'Serveur arrêté' 'Servidor detenido') '#AAB7B0'
        Apply-Language;Refresh-ServerLogs
    }catch{
        Set-OperationStatus (T 'Server stop failed' 'Échec de l arrêt du serveur' 'Error al detener el servidor') '#E76F6F'
        [Windows.MessageBox]::Show($_.Exception.Message,'MNG FUT')|Out-Null
    }finally{$PlayButton.IsEnabled=$true}
}
function Show-Fifa21Preparation(){
    Set-OperationStatus (T 'FIFA 21 server connection is not validated yet.' 'La connexion au serveur FIFA 21 reste à valider.' 'La conexión al servidor FIFA 21 aún no está validada.')
}
function Get-MngGameLaunchParameters([string]$ExePath,[string]$GameId,[bool]$EnableNativeModels=$false){
    $gameRoot=Split-Path -Parent $ExePath
    $parameters=@{FilePath=$ExePath;WorkingDirectory=$gameRoot}
    if($GameId -eq '20' -and $EnableNativeModels){
        $modDataPath=Join-Path $gameRoot 'ModData\Default'
        if(Test-Path -LiteralPath $modDataPath -PathType Container){
            if(-not(Test-Path -LiteralPath (Join-Path $modDataPath 'Patch\layout.toc') -PathType Leaf) -or -not(Test-Path -LiteralPath (Join-Path $modDataPath 'Data') -PathType Container)){
                throw 'Les données des modèles FIFA 20 sont incomplètes. Le jeu ne sera pas lancé sans elles.'
            }
            $parameters.ArgumentList='-dataPath "ModData\Default"'
        }
    }
    return $parameters
}
function Launch-SelectedGame(){
    try{
        $game=Get-SelectedGame
        if($game.Id -eq '17'){Start-MngFrosty;return}
        $exe=Get-SelectedGameExe
        if(-not $exe -or -not(Test-Path -LiteralPath $exe)){Choose-GameExe;$exe=Get-SelectedGameExe;if(-not $exe){return}}
        if($game.Id -eq '20' -and (Get-Process -Name FIFA20 -ErrorAction SilentlyContinue)){throw 'Ferme FIFA 20 avant de le relancer avec les modèles activés.'}
        if($game.Id -eq '20'){
            $settings=Get-Settings
            $serverRoot=[string]$settings.Fifa20ServerRoot
            if([string]::IsNullOrWhiteSpace($serverRoot)){$serverRoot=Join-Path $script:AppRoot 'fifa20-server'}
            $modelInstaller=Join-Path $serverRoot 'assets\native-models\Install-RobbenNativeModel.ps1'
            if($settings.Fifa20NativeModelsEnabled -eq $true -and (Test-Path -LiteralPath $modelInstaller -PathType Leaf)){& $modelInstaller -GameRoot (Split-Path -Parent $exe)}
        }
        $enableNativeModels=($game.Id -eq '20' -and $settings.Fifa20NativeModelsEnabled -eq $true)
        $launchParameters=Get-MngGameLaunchParameters -ExePath $exe -GameId $game.Id -EnableNativeModels $enableNativeModels
        if($game.Id -eq '20' -and [string]$settings.Fifa20SteamGameId -match '^\d{16,20}$' -and [string]$settings.Fifa20SteamTarget -eq $exe){
            Start-Process -FilePath ('steam://rungameid/'+$settings.Fifa20SteamGameId)|Out-Null
        }else{Start-Process @launchParameters|Out-Null}
        Set-OperationStatus ($game.Name+' '+(T 'launch requested' 'lancement demandé' 'inicio solicitado')) '#87DB72'
    }catch{[Windows.MessageBox]::Show($_.Exception.Message,'MNG FUT')|Out-Null}
}
function Stop-ProcessTree([int]$ProcessId){
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.ParentProcessId -eq $ProcessId}|ForEach-Object{Stop-ProcessTree $_.ProcessId}
    if($ProcessId -ne $PID){
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
}
function Stop-FifaLocalServerPortOwners(){
    $ports=@(443,3216,8000,8080,8081,8094,17502,42230,42231,42232,44321,47220)
    $owners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$ports -contains $_.LocalPort}|Select-Object -ExpandProperty OwningProcess -Unique)
    foreach($owner in $owners){
        $root=$owner;$current=Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
        for($level=0;$level -lt 4 -and $current;$level++){
            $parent=Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ParentProcessId)" -ErrorAction SilentlyContinue
            if(-not $parent -or $parent.Name -notin @('python.exe','py.exe','powershell.exe','cmd.exe','MNGBridge.exe')){break}
            $root=$parent.ProcessId;$current=$parent
        }
        Stop-ProcessTree $root
    }
    $deadline=(Get-Date).AddSeconds(15)
    do{
        Wait-Ui 250
        $remaining=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$ports -contains $_.LocalPort}|Select-Object -ExpandProperty LocalPort -Unique)
    }while($remaining -and (Get-Date) -lt $deadline)
    if($remaining){throw ((T 'A FIFA local-server port is still in use: ' 'Un port du serveur local FIFA est encore utilisé : ' 'Un puerto del servidor local de FIFA sigue en uso: ')+($remaining -join ', '))}
}
function Start-MngServer(){
    $s=Get-Settings;$exe=[string]$s.GameExe;$serverScript=Join-Path $script:AppRoot 'bridge\Start-Local-FIFA17-Test.ps1'
    if(-not $exe -or -not(Test-Path -LiteralPath $exe)){Choose-GameExe;$s=Get-Settings;$exe=[string]$s.GameExe;if(-not $exe){return}}
    if(-not(Test-Path -LiteralPath $serverScript)){[Windows.MessageBox]::Show((T 'Server bridge is missing.' 'Le Bridge serveur est introuvable.' 'Falta el Bridge del servidor.'),'MNG FUT')|Out-Null;return}
    $existingFifa=@(Get-Process -Name FIFA17,stp-fifa17 -ErrorAction SilentlyContinue)
    if($existingFifa){
        $LaunchStatus.Text=T '●  Closing the previous FIFA 17 instance...' '●  Fermeture de l ancienne instance FIFA 17...' '●  Cerrando la instancia anterior de FIFA 17...';$LaunchStatus.Foreground='#E3CF66';Wait-Ui 100
        foreach($process in $existingFifa){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
        $closeDeadline=(Get-Date).AddSeconds(12)
        do{Wait-Ui 250;$remainingFifa=@(Get-Process -Name FIFA17,stp-fifa17 -ErrorAction SilentlyContinue)}while($remainingFifa -and (Get-Date) -lt $closeDeadline)
        if($remainingFifa){[Windows.MessageBox]::Show((T 'FIFA 17 could not be closed automatically. Close FIFA17.exe in Task Manager and try again.' 'FIFA 17 n a pas pu être fermé automatiquement. Ferme FIFA17.exe dans le Gestionnaire des tâches puis réessaie.' 'FIFA 17 no pudo cerrarse automáticamente. Cierra FIFA17.exe en el Administrador de tareas e inténtalo de nuevo.'),'MNG FUT')|Out-Null;return}
    }
    Stop-MngServer;Stop-FifaLocalServerPortOwners;$LaunchStatus.Text=T '●  Starting local server...' '●  Démarrage du serveur local...' '●  Iniciando servidor local...';$LaunchStatus.Foreground='#E3CF66'
    $psi=New-Object Diagnostics.ProcessStartInfo
    $psi.FileName='powershell.exe'
    $psi.Arguments=('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}" -GameExe "{1}"' -f $serverScript,$exe)
    $psi.WorkingDirectory=(Split-Path -Parent $serverScript);$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    try{
        $script:ServerProcess=[Diagnostics.Process]::Start($psi);$script:ActiveServerGame='17';Wait-Ui 1200
        if($script:ServerProcess.HasExited){throw (T 'The server stopped during startup.' 'Le serveur a été arrêté pendant le démarrage.' 'El servidor se detuvo durante el inicio.')}
        $LaunchStatus.Text=T '●  Server started — launch FIFA separately' '●  Serveur démarré — lance FIFA séparément' '●  Servidor iniciado — abre FIFA por separado';$LaunchStatus.Foreground='#87DB72';Apply-Language
    }catch{
        $script:ServerProcess=$null;$LaunchStatus.Text=T '●  Server failed' '●  Échec du serveur' '●  Error del servidor';[Windows.MessageBox]::Show($_.Exception.Message,'MNG FUT')|Out-Null
    }
}
function Start-MngFrosty([switch]$InstallOnlyIfMissing){
    $frostyRoot=Join-Path $script:AppRoot 'frosty-package';$frostyExe=Join-Path $frostyRoot 'FrostyModManager.exe';$frostyScript=Join-Path $frostyRoot 'MNG-Launch-Frosty-Admin.ps1'
    $frostySupport=Join-Path $frostyRoot 'FrostyModSupport.dll';$expectedFrostySupportHash='b35820a26cdba13664df9054fbda512ae844dce365fcddf6c5e6fede157f5864'
    $frostyNeedsInstall=(-not(Test-Path -LiteralPath $frostyExe))-or(-not(Test-Path -LiteralPath $frostySupport))
    if(-not $frostyNeedsInstall){try{$frostyNeedsInstall=((Get-FileHash -LiteralPath $frostySupport -Algorithm SHA256).Hash.ToLowerInvariant()-notin @($expectedFrostySupportHash,'8a3e0331a665224d8325aa3056dc9fce927f642c251dc29c09e6e67b15d837b3'))}catch{$frostyNeedsInstall=$true}}
    if($frostyNeedsInstall){
        $installRoot=Join-Path $env:TEMP ('MNGFUT-Frosty-'+[guid]::NewGuid().ToString('N'));$archive=Join-Path $installRoot 'frosty.zip';$payload=Join-Path $installRoot 'payload'
        try{
            Set-OperationStatus (T 'Downloading Frosty Mod Manager...' 'Téléchargement de Frosty Mod Manager...' 'Descargando Frosty Mod Manager...')
            New-Item -ItemType Directory -Path $payload -Force|Out-Null
            Save-VerifiedDownload 'https://github.com/Minegamerfrance/MinegamerServeur17/releases/download/launcher-5.1.1-frosty-test/MNG-Frosty-Mod-Manager-FIFA17-v2.0.19.4.zip' $archive '5ef98f4f04b38170e99564f3ab427464c28acb2d16ed8658851e1597f227193f' 153792106
            Expand-MngZip $archive $payload
            $downloadedExe=Get-ChildItem -LiteralPath $payload -Filter 'FrostyModManager.exe' -File -Recurse|Select-Object -First 1
            if(-not $downloadedExe){throw 'FrostyModManager.exe is missing from the downloaded package.'}
            New-Item -ItemType Directory -Path $frostyRoot -Force|Out-Null
            Copy-Item -Path (Join-Path $downloadedExe.Directory.FullName '*') -Destination $frostyRoot -Recurse -Force
            if(-not(Test-Path -LiteralPath $frostyExe)){throw 'Frosty Mod Manager installation failed.'}
            Set-OperationStatus (T 'Frosty Mod Manager installed' 'Frosty Mod Manager installé' 'Frosty Mod Manager instalado') '#87DB72'
            Apply-Language
        }catch{
            Set-OperationStatus (T 'Frosty installation failed' 'Échec de l installation de Frosty' 'Error al instalar Frosty') '#E76F6F';[Windows.MessageBox]::Show($_.Exception.Message,'MNG FUT')|Out-Null;return
        }finally{Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue}
        $frostyScript=Join-Path $frostyRoot 'MNG-Launch-Frosty-Admin.ps1'
        if($InstallOnlyIfMissing){return}
    }
    try{
        if(Test-Path -LiteralPath $frostyScript){
            $frostyArguments='-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $frostyScript
            $frostyProcess=Start-Process -FilePath 'powershell.exe' -ArgumentList $frostyArguments -WorkingDirectory $frostyRoot -WindowStyle Hidden -PassThru
            Wait-Ui 900
            if($frostyProcess.HasExited -and $frostyProcess.ExitCode -ne 0){
                Start-Process -FilePath $frostyExe -WorkingDirectory $frostyRoot -Verb RunAs|Out-Null
            }
        }
        else{Start-Process -FilePath $frostyExe -WorkingDirectory $frostyRoot -Verb RunAs|Out-Null}
        $LaunchStatus.Text=T '●  Frosty opening...' '●  Ouverture de Frosty...' '●  Abriendo Frosty...'
    }catch{[Windows.MessageBox]::Show($_.Exception.Message,'MNG FUT')|Out-Null}
}
function Open-Friends(){
    if(-not $script:Profile){ Open-Account; return }
    $script:FriendsOpen=$true;$script:AccountOpen=$false;$AccountDrawer.Visibility='Collapsed';$FriendsDrawer.Visibility='Visible';Refresh-Friends
}
function Close-Friends(){$script:FriendsOpen=$false;$FriendsDrawer.Visibility='Collapsed'}
function Open-Account(){
    $script:AccountOpen=$true;$script:FriendsOpen=$false;$FriendsDrawer.Visibility='Collapsed';$AccountDrawer.Visibility='Visible';Update-AccountUi
}
function Close-Account(){$script:AccountOpen=$false;$AccountDrawer.Visibility='Collapsed'}
function Open-Legacy(){
    $legacy=Join-Path $script:AppRoot 'MNG FUT Maintenance.exe'
    if(-not(Test-Path -LiteralPath $legacy)){$legacy=Join-Path $script:AppRoot 'MNG FUT Launcher Legacy.exe'}
    if(Test-Path -LiteralPath $legacy){Start-Process -FilePath $legacy -WorkingDirectory $script:AppRoot | Out-Null;return}
    [Windows.MessageBox]::Show((T 'Maintenance tools not found.' 'Outils de maintenance introuvables.' 'No se encontraron las herramientas de mantenimiento.'),'MNG FUT')|Out-Null
}

function Refresh-Friends(){
    if($script:Refreshing -or -not $script:Profile){return};$script:Refreshing=$true
    try{
        $f=Invoke-Social 'GET' '/api/friends'
        $req=Invoke-Social 'GET' '/api/friends/requests'
        $FriendsListPanel.Children.Clear();$RequestsPanel.Children.Clear()
        $online=0
        foreach($friend in @($f.friends)){
            $state=[string]$friend.presence.state;if($state -ne 'offline'){$online++}
            $border=New-RowBorder;$grid=New-Object Windows.Controls.Grid;$grid.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition -Property @{Width='*'}));$grid.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition -Property @{Width='Auto'}))|Out-Null
            $stack=New-Object Windows.Controls.StackPanel
            $dot=if($state -eq 'playing_fifa17' -or $state -eq 'in_fut'){'● '}elseif($state -eq 'offline'){'○ '}else{'● '}
            $color=if($state -eq 'playing_fifa17' -or $state -eq 'in_fut'){'#E6D35C'}elseif($state -eq 'offline'){'#68746E'}else{'#77E06D'}
            $t=New-Text ($dot+[string]$friend.username) $color 13 'SemiBold';$stack.Children.Add($t)|Out-Null
            $status=if($state -eq 'playing_fifa17'){T 'Playing FIFA 17' 'Joue à FIFA 17' 'Jugando a FIFA 17'}elseif($state -eq 'in_fut'){T 'In Ultimate Team' 'Dans Ultimate Team' 'En Ultimate Team'}elseif($state -eq 'online'){T 'Online' 'En ligne' 'En línea'}else{T 'Offline' 'Hors ligne' 'Desconectado'}
            $stack.Children.Add((New-Text $status '#6F7C75' 10))|Out-Null;$grid.Children.Add($stack)|Out-Null
            $fid=[int64]$friend.id
            $remove=New-MiniButton (T 'Remove' 'Supprimer' 'Eliminar') ({param($s,$e) try{Invoke-Social 'DELETE' ('/api/friends/'+$fid)|Out-Null;Refresh-Friends}catch{}}.GetNewClosure())
            [Windows.Controls.Grid]::SetColumn($remove,1);$grid.Children.Add($remove)|Out-Null;$border.Child=$grid;$FriendsListPanel.Children.Add($border)|Out-Null
        }
        if($FriendsListPanel.Children.Count -eq 0){$FriendsListPanel.Children.Add((New-Text (T 'No friends yet. Search for a MNG username above.' 'Aucun ami pour le moment. Recherchez un pseudo MNG ci-dessus.' 'Aún no tienes amigos. Busca un nombre MNG arriba.') '#68766F' 11))|Out-Null}
        foreach($r in @($req.requests)){
            $border=New-RowBorder;$grid=New-Object Windows.Controls.Grid;$grid.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition -Property @{Width='*'}));$grid.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition -Property @{Width='Auto'}))|Out-Null
            $grid.Children.Add((New-Text ([string]$r.username) '#F0F4F1' 12 'SemiBold'))|Out-Null
            $sp=New-Object Windows.Controls.StackPanel;$sp.Orientation='Horizontal';$rid=[int64]$r.requestId
            $sp.Children.Add((New-MiniButton (T 'Accept' 'Accepter' 'Aceptar') ({param($s,$e) try{Invoke-Social 'POST' '/api/friends/accept' @{requestId=$rid}|Out-Null;Refresh-Friends}catch{}}.GetNewClosure()) $true))|Out-Null
            $sp.Children.Add((New-MiniButton (T 'Decline' 'Refuser' 'Rechazar') ({param($s,$e) try{Invoke-Social 'POST' '/api/friends/decline' @{requestId=$rid}|Out-Null;Refresh-Friends}catch{}}.GetNewClosure())))|Out-Null
            [Windows.Controls.Grid]::SetColumn($sp,1);$grid.Children.Add($sp)|Out-Null;$border.Child=$grid;$RequestsPanel.Children.Add($border)|Out-Null
        }
        if($RequestsPanel.Children.Count -eq 0){$RequestsPanel.Children.Add((New-Text (T 'No pending requests.' 'Aucune demande en attente.' 'No hay solicitudes pendientes.') '#5E6B64' 10))|Out-Null}
        $pending=@($req.requests).Count
        $hadNewRequest=($pending -gt $script:PendingFriendRequests)
        $script:PendingFriendRequests=$pending
        $requestBadge=if($pending -gt 0){'  •  🔔 '+$pending}else{''}
        $FriendsTopButton.Content=('👥  '+(T 'Friends' 'Amis' 'Amigos')+'  •  '+$online+$requestBadge)
        $FriendsTopButton.BorderBrush=if($pending -gt 0){'#DDFD45'}else{'#344A40'}
        if($hadNewRequest -and -not $script:FriendsOpen){
            $SocialStatusText.Text=T 'New friend request received.' 'Nouvelle demande d ami reçue.' 'Nueva solicitud de amistad recibida.';$SocialStatusText.Foreground='#DDFD45'
        }else{
            $SocialStatusText.Text=((T 'Social server online' 'Serveur social en ligne' 'Servidor social en línea')+'  •  '+@($f.friends).Count+' '+(T 'friends' 'amis' 'amigos')+'  •  '+$online+' '+(T 'online' 'en ligne' 'en línea'));$SocialStatusText.Foreground='#7EA874'
        }
    }catch{
        $SocialStatusText.Text=T 'Social server unavailable.' 'Serveur social indisponible.' 'Servidor social no disponible.';$SocialStatusText.Foreground='#D19C67';$FriendsTopButton.Content=('👥  '+(T 'Friends' 'Amis' 'Amigos')+'  •  —')
    }finally{$script:Refreshing=$false}
    if(([string]$FriendSearchBox.Text).Trim().Length -ge 2){Search-Friends}
}
function Search-Friends(){
    $q=[string]$FriendSearchBox.Text;$SearchResultsPanel.Children.Clear();if($q.Trim().Length -lt 2){return}
    try{
        $r=Invoke-Social 'GET' ('/api/users/search?q='+[uri]::EscapeDataString($q.Trim()))
        foreach($u in @($r.users)){
            $border=New-RowBorder;$grid=New-Object Windows.Controls.Grid;$grid.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition -Property @{Width='*'}));$grid.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition -Property @{Width='Auto'}))|Out-Null
            $grid.Children.Add((New-Text ([string]$u.username) '#F0F4F1' 12 'SemiBold'))|Out-Null
            $rel=[string]$u.relationship
            if($rel -eq 'none'){
                $uname=[string]$u.username;$b=New-MiniButton (T 'Add' 'Ajouter' 'Añadir') ({param($s,$e) try{Invoke-Social 'POST' '/api/friends/request' @{username=$uname}|Out-Null;Search-Friends;Refresh-Friends}catch{}}.GetNewClosure()) $true
            }elseif($rel -eq 'incoming'){
                $rid=[int64]$u.requestId;$b=New-MiniButton (T 'Accept' 'Accepter' 'Aceptar') ({param($s,$e) try{Invoke-Social 'POST' '/api/friends/accept' @{requestId=$rid}|Out-Null;Search-Friends;Refresh-Friends}catch{}}.GetNewClosure()) $true
            }elseif($rel -eq 'friend'){$b=New-MiniButton (T 'Friend' 'Ami' 'Amigo') ({})}else{$b=New-MiniButton (T 'Pending' 'En attente' 'Pendiente') ({})}
            [Windows.Controls.Grid]::SetColumn($b,1);$grid.Children.Add($b)|Out-Null;$border.Child=$grid;$SearchResultsPanel.Children.Add($border)|Out-Null
        }
        if($SearchResultsPanel.Children.Count -eq 0){$SearchResultsPanel.Children.Add((New-Text (T 'No MNG user found.' 'Aucun utilisateur MNG trouvé.' 'No se encontró ningún usuario MNG.') '#68766F' 10))|Out-Null}
    }catch{$SearchResultsPanel.Children.Add((New-Text (T 'Search unavailable.' 'Recherche indisponible.' 'Búsqueda no disponible.') '#D19C67' 10))|Out-Null}
}

$AccountButton.Add_Click({Open-Account});$FriendsTopButton.Add_Click({Open-Friends});$FriendsNavButton.Add_Click({Open-Friends});$FindFriendsButton.Add_Click({Open-Friends})
$NotificationsButton.Add_Click({if($NotificationsPopup.Visibility -eq 'Visible'){$NotificationsPopup.Visibility='Collapsed'}else{Open-Notifications}});$CloseNotificationsButton.Add_Click({$NotificationsPopup.Visibility='Collapsed'});$CloseNotificationImageButton.Add_Click({$NotificationImageOverlay.Visibility='Collapsed';$NotificationLargeImage.Source=$null})
$CloseFriendsButton.Add_Click({Close-Friends});$CloseAccountButton.Add_Click({Close-Account});$RefreshFriendsButton.Add_Click({Refresh-Friends});$FriendSearchButton.Add_Click({Search-Friends})
$FriendSearchBox.Add_KeyDown({param($s,$e) if($e.Key -eq 'Return'){Search-Friends}})
(C 'MinButton').Add_Click({$window.WindowState='Minimized'});(C 'MaxButton').Add_Click({if($window.WindowState -eq 'Maximized'){$window.WindowState='Normal'}else{$window.WindowState='Maximized'}});(C 'CloseButton').Add_Click({$window.Close()})
(C 'TitleBar').Add_MouseLeftButtonDown({if($_.ChangedButton -eq 'Left'){$window.DragMove()}})

$LoginSubmitButton.Add_Click({
    $LoginMessage.Text=T 'Connecting...' 'Connexion...' 'Conectando...';$window.Cursor='Wait'
    try{$r=Try-AccountEndpoint 'login' $LoginUserBox.Text $LoginPasswordBox.Password;if($r.ok){$LoginMessage.Text=T 'Connected.' 'Connecté.' 'Conectado.';Update-AccountUi;Close-Account;try{Send-Presence 'online' 'MNG FUT Launcher'|Out-Null}catch{}}else{$LoginMessage.Text=[string]$r.message}}
    finally{$window.Cursor=$null}
})
$RegisterButton.Add_Click({
    $LoginMessage.Text=T 'Creating account...' 'Création du compte...' 'Creando la cuenta...';$window.Cursor='Wait'
    try{$r=Try-AccountEndpoint 'register' $LoginUserBox.Text $LoginPasswordBox.Password;if($r.ok){$LoginMessage.Text=T 'Account created and connected.' 'Compte créé et connecté.' 'Cuenta creada y conectada.';Update-AccountUi;Close-Account;try{Send-Presence 'online' 'MNG FUT Launcher'|Out-Null}catch{}}else{$LoginMessage.Text=[string]$r.message}}
    finally{$window.Cursor=$null}
})
$LegacyLoginButton.Add_Click({Open-Legacy})
$LogoutButton.Add_Click({Logout-Mng;Update-AccountUi;Close-Account;$FriendsTopButton.Content=('👥  '+(T 'Friends' 'Amis' 'Amigos')+'  •  0')})

$ChangeFolderButton.Add_Click({
    Choose-GameExe
})
$PlayButton.Add_Click({
    if(Test-ManagedServerRunning){Stop-SelectedServer}else{Start-SelectedServer}
})
$LaunchGameButton.Add_Click({Launch-SelectedGame})
$InstallButton.Add_Click({Install-ServerInternal});$UpdateServerButton.Add_Click({Check-ServerUpdateInternal});$RepairButton.Add_Click({Repair-ServerInternal})
$SettingsInstallButton.Add_Click({Install-ServerInternal});$SettingsRepairButton.Add_Click({Repair-ServerInternal});$AppUpdateButton.Add_Click({Update-ApplicationInternal});$FrostyButton.Add_Click({Start-MngFrosty})
$MaintenanceButton.Add_Click({Open-Settings});$SettingsButton.Add_Click({Open-Settings});$SettingsNavButton.Add_Click({Open-Settings});$CloseSettingsButton.Add_Click({$SettingsDrawer.Visibility='Collapsed'})
$LanguageBox.Add_SelectionChanged({if($LanguageBox.SelectedItem){$script:Lang=[string]$LanguageBox.SelectedItem.Tag;$s=Get-Settings;Set-Property $s 'Language' $script:Lang;Write-JsonFile $script:SettingsPath $s;Apply-Language}})
$ShowLogsCheckBox.Add_Checked({$LogsPanel.Visibility='Visible';$HeroSlogan.Visibility='Visible';Refresh-ServerLogs})
$ShowLogsCheckBox.Add_Unchecked({$LogsPanel.Visibility='Collapsed';$HeroSlogan.Visibility='Visible'})
$Fifa14Tile.Add_Click({Select-Game '14'})
$Fifa15Tile.Add_Click({Select-Game '15'})
$Fifa17Tile.Add_Click({Select-Game '17'})
$Fifa20Tile.Add_Click({Select-Game '20'})
$Fifa21Tile.Add_Click({Select-Game '21'})

$presenceTimer=New-Object Windows.Threading.DispatcherTimer;$presenceTimer.Interval=[TimeSpan]::FromSeconds(20)
$presenceTimer.Add_Tick({
    if(-not $script:Profile){return}
    try{
        $playing=@(Get-Process -Name FIFA17 -ErrorAction SilentlyContinue).Count -gt 0
        if($playing){Send-Presence 'playing_fifa17' 'Playing FIFA 17'|Out-Null;$LaunchStatus.Text=T '●  FIFA 17 is running' '●  FIFA 17 est en cours' '●  FIFA 17 está en ejecución';$LaunchStatus.Foreground='#87DB72'}else{Send-Presence 'online' 'MNG FUT Launcher'|Out-Null}
    }catch{}
})
$friendsTimer=New-Object Windows.Threading.DispatcherTimer;$friendsTimer.Interval=[TimeSpan]::FromSeconds(12);$friendsTimer.Add_Tick({if($script:Profile){Refresh-Friends}})
$sessionTimer=New-Object Windows.Threading.DispatcherTimer;$sessionTimer.Interval=[TimeSpan]::FromSeconds(45);$sessionTimer.Add_Tick({if(-not $script:Profile -and (Test-Path $script:SessionPath)){if(Validate-Session){Update-AccountUi;try{Send-Presence 'online' 'MNG FUT Launcher'|Out-Null}catch{}}}})
$logsTimer=New-Object Windows.Threading.DispatcherTimer;$logsTimer.Interval=[TimeSpan]::FromMilliseconds(600);$logsTimer.Add_Tick({if($ShowLogsCheckBox.IsChecked){Refresh-ServerLogs}})
$notificationsTimer=New-Object Windows.Threading.DispatcherTimer;$notificationsTimer.Interval=[TimeSpan]::FromMinutes(3);$notificationsTimer.Add_Tick({Refresh-Notifications})
$window.Add_Closing({try{Send-Presence 'offline' 'Launcher closed'|Out-Null}catch{}})
$window.Add_ContentRendered({
    $s=Get-Settings;$saved=[string]$s.Language;if($saved -in @('en','fr','es')){$script:Lang=$saved};Apply-Language
    Select-Game '17'
    if(Validate-Session){try{Send-Presence 'online' 'MNG FUT Launcher'|Out-Null;Refresh-Friends}catch{}}
    Update-AccountUi
    Refresh-Notifications;$presenceTimer.Start();$friendsTimer.Start();$sessionTimer.Start();$logsTimer.Start();$notificationsTimer.Start()
})

[void]$window.ShowDialog()
