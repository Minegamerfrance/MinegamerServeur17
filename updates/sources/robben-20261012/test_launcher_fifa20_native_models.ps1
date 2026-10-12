$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot 'MNG-FUT-extracted.ps1'
$tokens=$null;$parseErrors=$null
$syntax=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors.Message -join "`n")}
$functions=$syntax.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)
foreach($name in 'Get-MngGameLaunchParameters','Launch-SelectedGame'){
    $definition=$functions|Where-Object Name -eq $name|Select-Object -First 1
    if(-not $definition){throw "Missing launcher function: $name"}
    . ([scriptblock]::Create($definition.Extent.Text))
}
$fixture=Join-Path $PSScriptRoot ('.test-temp\robben-launch-'+[guid]::NewGuid().ToString('N'))
$gameRoot=Join-Path $fixture 'FIFA 20 with spaces'
New-Item -ItemType Directory -Path $gameRoot -Force|Out-Null
$exe=Join-Path $gameRoot 'FIFA20.exe'
New-Item -ItemType File -Path $exe|Out-Null
$base=Get-MngGameLaunchParameters -ExePath $exe -GameId '20'
if($base.ContainsKey('ArgumentList')){throw 'Base game incorrectly receives a model path'}
$modData=Join-Path $gameRoot 'ModData\Default'
New-Item -ItemType Directory -Path (Join-Path $modData 'Patch') -Force|Out-Null
$failed=$false
try{Get-MngGameLaunchParameters -ExePath $exe -GameId '20'|Out-Null}catch{$failed=$true}
if(-not $failed){throw 'Incomplete model data silently launch the base game'}
New-Item -ItemType File -Path (Join-Path $modData 'Patch\layout.toc')|Out-Null
New-Item -ItemType Directory -Path (Join-Path $modData 'Data')|Out-Null
$parameters=Get-MngGameLaunchParameters -ExePath $exe -GameId '20'
if($parameters.ArgumentList -ne '-dataPath "ModData\Default"'){throw 'Missing or incorrectly quoted native data path'}
if($parameters.WorkingDirectory -ne $gameRoot){throw 'Wrong game working directory'}
if((Get-MngGameLaunchParameters -ExePath $exe -GameId '14').ContainsKey('ArgumentList')){throw 'Another FIFA title receives FIFA20 models'}
$script:SelectedGame='20';$script:CapturedLaunch=$null;$script:FrostyCalls=0
function Get-SelectedGame{return @{Id=$script:SelectedGame;Name='FIFA '+$script:SelectedGame}}
function Get-SelectedGameExe{return $exe}
function Get-Settings{return @{Fifa20ServerRoot=$fixture}}
function Get-Process{return $null}
function Start-MngFrosty{$script:FrostyCalls++}
function Set-OperationStatus{}
function T($english,$french,$spanish){return $french}
function Start-Process($FilePath,$WorkingDirectory,$ArgumentList){$script:CapturedLaunch=@{FilePath=$FilePath;WorkingDirectory=$WorkingDirectory;ArgumentList=$ArgumentList}}
Launch-SelectedGame
if($script:FrostyCalls -ne 0 -or $script:CapturedLaunch.ArgumentList -ne $parameters.ArgumentList){throw 'FIFA20 launch does not use the native model pack directly'}
function Get-Settings{return @{Fifa20ServerRoot=$fixture;Fifa20SteamGameId='17928221184722206720';Fifa20SteamTarget=$exe}}
Launch-SelectedGame
if($script:CapturedLaunch.FilePath -ne 'steam://rungameid/17928221184722206720'){throw 'Configured Steam shortcut was not used'}
function Get-Settings{return @{Fifa20ServerRoot=$fixture;Fifa20SteamGameId='17928221184722206720';Fifa20SteamTarget='C:\another-game.exe'}}
Launch-SelectedGame
if($script:CapturedLaunch.FilePath -ne $exe -or $script:CapturedLaunch.ArgumentList -ne $parameters.ArgumentList){throw 'Steam shortcut for another executable was reused'}
$script:SelectedGame='17';Launch-SelectedGame
if($script:FrostyCalls -ne 1){throw 'FIFA17 Frosty routing changed'}
Write-Output 'PASS: direct and Steam FIFA20 model launch, quoting, incomplete-pack guard and FIFA17 routing.'
