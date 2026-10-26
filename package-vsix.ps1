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
  # Extension details allow HTTPS and data images, but cannot resolve local media paths.
  # Embed the screenshots so a locally installed VSIX also displays them offline.
  $readme = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'README.md')
  $readme = [regex]::Replace($readme, '!\[([^\]]*)\]\((media/[\w.-]+\.png)\)', {
    param($match)
    $imageFile = Join-Path $projectRoot $match.Groups[2].Value
    $imageData = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($imageFile))
    return '![' + $match.Groups[1].Value + '](data:image/png;base64,' + $imageData + ')'
  })
  [System.IO.File]::WriteAllText((Join-Path $extensionRoot 'readme.md'), $readme, [System.Text.UTF8Encoding]::new($false))
  if (Test-Path -LiteralPath (Join-Path $projectRoot 'CHANGELOG.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'CHANGELOG.md') -Destination (Join-Path $extensionRoot 'changelog.md')
  }
  # Only runtime assets belong in the installed extension. README screenshots
  # are already embedded above; source artwork and other captures stay in Git.
  $mediaRoot = Join-Path $extensionRoot 'media'
  New-Item -ItemType Directory -Path $mediaRoot -Force | Out-Null
  $runtimeAssets = @(
    'index.html', 'editor.css', 'editor.js', 'csv.js', 'export.js',
    'codicon.css', 'codicon.ttf', 'material-icons.woff',
    'MATERIAL-PRODUCT-ICONS-LICENSE.txt', 'extension-icon.png',
    'csv-table-light.svg', 'csv-table-dark.svg'
  )
  foreach ($asset in $runtimeAssets) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "media/$asset") -Destination $mediaRoot
  }
  Copy-Item -LiteralPath (Join-Path $projectRoot 'media/pdf') -Destination $mediaRoot -Recurse

  $publisher = [System.Security.SecurityElement]::Escape([string]$package.publisher)
  $name = [System.Security.SecurityElement]::Escape([string]$package.name)
  $version = [System.Security.SecurityElement]::Escape([string]$package.version)
  $displayName = [System.Security.SecurityElement]::Escape([string]$package.displayName)
  $description = [System.Security.SecurityElement]::Escape([string]$package.description)
  $engine = [System.Security.SecurityElement]::Escape([string]$package.engines.vscode)
  $categories = [System.Security.SecurityElement]::Escape(($package.categories -join ','))
  $tags = [System.Security.SecurityElement]::Escape(($package.keywords -join ','))
  $extensionKind = [System.Security.SecurityElement]::Escape([string]$(if ($package.extensionKind) { $package.extensionKind -join ',' } else { 'workspace' }))
  $iconRelativePath = ([string]$package.icon -replace '^[.][/\\]', '').Replace('\', '/')
  if (-not $iconRelativePath -or -not (Test-Path -LiteralPath (Join-Path $extensionRoot ($iconRelativePath.Replace('/', '\'))))) {
    throw "The icon specified in package.json was not found: $($package.icon)"
  }
  $iconAssetPath = [System.Security.SecurityElement]::Escape("extension/$iconRelativePath")
  $repositoryUrl = ''
  if ($package.repository -is [string]) {
    $repositoryUrl = [string]$package.repository
  } elseif ($package.repository.url) {
    $repositoryUrl = [string]$package.repository.url
  }
  $repositoryUrl = [System.Security.SecurityElement]::Escape($repositoryUrl)
  $repositoryProperty = if ($repositoryUrl) {
    "    <Property Id=`"Microsoft.VisualStudio.Services.Links.Source`" Value=`"$repositoryUrl`" />`n    <Property Id=`"Microsoft.VisualStudio.Services.Links.GitHub`" Value=`"$repositoryUrl`" />"
  } else {
    ''
  }
  $bugsProperty = ''
  if ($package.bugs.url) {
    $bugsUrl = [System.Security.SecurityElement]::Escape([string]$package.bugs.url)
    $bugsProperty = "`n    <Property Id=`"Microsoft.VisualStudio.Services.Links.Support`" Value=`"$bugsUrl`" />"
  }
  $hasCode = [bool]($package.main -or $package.browser)
  $changelogAsset = if (Test-Path -LiteralPath (Join-Path $extensionRoot 'changelog.md')) {
    '    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/changelog.md" Addressable="true" />'
  } else {
    ''
  }

  $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="$name" Version="$version" Publisher="$publisher" />
    <DisplayName>$displayName</DisplayName>
    <Description xml:space="preserve">$description</Description>
    <Tags>$tags</Tags>
    <Categories>$categories</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Icon>$iconAssetPath</Icon>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$engine" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="$extensionKind" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="$(if ($hasCode) { 'true' } else { 'false' })" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
$repositoryProperty$bugsProperty
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md" Addressable="true" />
$changelogAsset
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="$iconAssetPath" Addressable="true" />
  </Assets>
</PackageManifest>
"@

  $contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/plain" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="xml" ContentType="text/xml" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="ttf" ContentType="font/ttf" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="woff" ContentType="font/woff" />
  <Default Extension="gz" ContentType="application/gzip" />
</Types>
'@

  [System.IO.File]::WriteAllText($manifestFile, $manifest, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($contentTypesFile, $contentTypes, [System.Text.UTF8Encoding]::new($false))
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::Open(
    $zipFile,
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    $stageFiles = Get-ChildItem -LiteralPath $stageRoot -Recurse -File | Sort-Object FullName
    foreach ($stageFile in $stageFiles) {
      $relativePath = $stageFile.FullName.Substring($stageRoot.Length + 1)
      $entryPath = $relativePath.Replace('\', '/')
      $entry = $archive.CreateEntry($entryPath, [System.IO.Compression.CompressionLevel]::Optimal)
      $sourceStream = $stageFile.OpenRead()
      $targetStream = $entry.Open()
      try {
        $sourceStream.CopyTo($targetStream)
      }
      finally {
        $targetStream.Dispose()
        $sourceStream.Dispose()
      }
    }
  }
  finally {
    $archive.Dispose()
  }
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
