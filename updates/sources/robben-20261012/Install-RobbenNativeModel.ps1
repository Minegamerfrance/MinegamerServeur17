[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$GameRoot)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$game=[IO.Path]::GetFullPath($GameRoot).TrimEnd('\')
$default=Join-Path $game 'ModData\Default'
if(Test-Path -LiteralPath $default -PathType Container){
    if(!(Test-Path -LiteralPath (Join-Path $default 'Patch\layout.toc')) -or !(Test-Path -LiteralPath (Join-Path $default 'Data'))){throw 'Le dossier de modèles déjà installé est incomplet.'}
    return
}
if(Get-Process FIFA20 -ErrorAction SilentlyContinue){throw 'Ferme FIFA 20 avant de préparer les modèles.'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'robben-native-files.json') -Raw|ConvertFrom-Json
$archive=Join-Path $PSScriptRoot 'robben-game-data.zip'
if((Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant() -ne $manifest.archiveSha256){throw 'Le paquet du modèle Robben est endommagé.'}
if((Get-FileHash -LiteralPath (Join-Path $game 'Patch\layout.toc')).Hash.ToLowerInvariant() -ne $manifest.baseLayoutSha256){throw 'Le modèle Robben ne correspond pas à cette mise à jour de FIFA 20.'}
$output=Join-Path $game 'ModData\MNG-Robben-1.8.87'
if(Test-Path -LiteralPath $output){throw 'Une préparation Robben existe déjà. Aucun fichier ne sera remplacé.'}
function Resolve-ModelPath([string]$Root,[string]$Relative){
    if([IO.Path]::IsPathRooted($Relative)){throw 'Chemin absolu interdit dans le paquet.'}
    $resolved=[IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if(!$resolved.StartsWith($Root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Chemin du paquet hors du dossier autorisé.'}
    return $resolved
}
foreach($link in $manifest.links){
    $source=Resolve-ModelPath $game $link.path
    $null=Resolve-ModelPath $output $link.path
    if(!(Test-Path -LiteralPath $source)){throw ('Fichier du jeu manquant : '+$link.path)}
    if($link.kind -eq 'file' -and (Get-Item -LiteralPath $source).Length -ne $link.size){throw ('Fichier du jeu incompatible : '+$link.path)}
}
$zip=[IO.Compression.ZipFile]::OpenRead($archive)
try{
    if($zip.Entries.Count -ne $manifest.files.Count){throw 'Le contenu du paquet ne correspond pas à son manifeste.'}
    $expected=@{}
    foreach($file in $manifest.files){
        $null=Resolve-ModelPath $output $file.path
        if($expected.ContainsKey($file.path)){throw 'Fichier répété dans le manifeste.'}
        $expected[$file.path]=$file
    }
    foreach($entry in $zip.Entries){if(!$expected.ContainsKey($entry.FullName) -or $entry.Length -ne $expected[$entry.FullName].size){throw 'Entrée de paquet invalide.'}}
    New-Item -ItemType Directory -Path $output|Out-Null
    foreach($entry in $zip.Entries){
        $destination=Resolve-ModelPath $output $entry.FullName
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force|Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$false)
        if((Get-FileHash -LiteralPath $destination).Hash.ToLowerInvariant() -ne $expected[$entry.FullName].sha256){throw 'Échec du contrôle d’intégrité du modèle.'}
    }
    foreach($link in $manifest.links){
        $destination=Resolve-ModelPath $output $link.path
        $source=Resolve-ModelPath $game $link.path
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force|Out-Null
        if($link.kind -eq 'directory'){New-Item -ItemType Junction -Path $destination -Target $source|Out-Null}
        elseif($link.kind -eq 'file'){New-Item -ItemType HardLink -Path $destination -Target $source|Out-Null}
        else{throw 'Type de liaison invalide.'}
    }
    New-Item -ItemType Junction -Path $default -Target $output|Out-Null
}
finally{$zip.Dispose()}
