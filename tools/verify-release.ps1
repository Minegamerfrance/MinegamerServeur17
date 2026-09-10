$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repositoryRoot 'updates\manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

foreach ($entry in $manifest.files) {
    $sourcePath = Join-Path (Split-Path -Parent $manifestPath) ($entry.source -replace '/', '\')
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Fichier absent : $($entry.source)"
    }

    $actualSize = (Get-Item -LiteralPath $sourcePath).Length
    $actualHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSize -ne [long]$entry.size) {
        throw "Taille incorrecte : $($entry.target) (manifeste=$($entry.size), fichier=$actualSize)"
    }
    if ($actualHash -ne [string]$entry.sha256) {
        throw "Empreinte incorrecte : $($entry.target)"
    }
}

Write-Output "Publication valide : $($manifest.files.Count) fichiers, version $($manifest.version)."
