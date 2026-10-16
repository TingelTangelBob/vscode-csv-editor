$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stageRoot = [System.IO.Path]::GetFullPath((Join-Path $tempRoot ('csv-simple-editor-vsix-' + [guid]::NewGuid().ToString('N'))))
if (-not $stageRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The temporary package path is outside the system temporary directory.'
}

$extensionRoot = Join-Path $stageRoot 'extension'
$outputFile = Join-Path $projectRoot ($package.name + '-' + $package.version + '.vsix')
$zipFile = $stageRoot + '.zip'
$manifestFile = Join-Path $stageRoot 'extension.vsixmanifest'
$contentTypesFile = Join-Path $stageRoot '[Content_Types].xml'

try {
  New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $extensionRoot
  Copy-Item -LiteralPath (Join-Path $projectRoot 'extension.js') -Destination $extensionRoot
  Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $extensionRoot
  if (Test-Path -LiteralPath (Join-Path $projectRoot 'CHANGELOG.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'CHANGELOG.md') -Destination $extensionRoot
  }
  Copy-Item -LiteralPath (Join-Path $projectRoot 'media') -Destination $extensionRoot -Recurse

  $publisher = [System.Security.SecurityElement]::Escape([string]$package.publisher)
  $name = [System.Security.SecurityElement]::Escape([string]$package.name)
  $displayName = [System.Security.SecurityElement]::Escape([string]$package.displayName)
  $description = [System.Security.SecurityElement]::Escape([string]$package.description)
  $engine = [System.Security.SecurityElement]::Escape([string]$package.engines.vscode)
  $categories = [System.Security.SecurityElement]::Escape(($package.categories -join ','))
  $tags = [System.Security.SecurityElement]::Escape(($package.keywords -join ','))

  $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="$name" Version="$($package.version)" Publisher="$publisher" />
    <DisplayName>$displayName</DisplayName>
    <Description xml:space="preserve">$description</Description>
    <Tags>$tags</Tags>
    <Categories>$categories</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$engine" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
  </Assets>
</PackageManifest>
"@

  $contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="png" ContentType="image/png" />
</Types>
'@

  Set-Content -LiteralPath $manifestFile -Value $manifest -Encoding utf8
  Set-Content -LiteralPath $contentTypesFile -Value $contentTypes -Encoding utf8
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stageRoot,
    $zipFile,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
  Move-Item -LiteralPath $zipFile -Destination $outputFile -Force
  Write-Output "Created $outputFile"
}
finally {
  if (Test-Path -LiteralPath $stageRoot) {
    $resolvedStage = [System.IO.Path]::GetFullPath($stageRoot)
    if ($resolvedStage.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
  }
  if (Test-Path -LiteralPath $zipFile) {
    $resolvedZip = [System.IO.Path]::GetFullPath($zipFile)
    if ($resolvedZip.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedZip -Force
    }
  }
}
