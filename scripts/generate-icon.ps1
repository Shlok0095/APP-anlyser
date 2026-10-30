$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'Futuristic Interlocking AA Monogram.png'
if (-not (Test-Path $source)) {
  throw "Logo not found: $source"
}

$build = Join-Path $root 'build'
$assetDir = Join-Path $root 'src\renderer\src\assets'
New-Item -ItemType Directory -Force -Path $build, $assetDir | Out-Null

$src = [System.Drawing.Image]::FromFile($source)

function Resize-Square([System.Drawing.Image]$image, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::FromArgb(255, 8, 8, 10))
  $g.DrawImage($image, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

$iconPng = Resize-Square $src 512
Save-Png $iconPng (Join-Path $build 'icon.png')
$appIcon = Resize-Square $src 256
Save-Png $appIcon (Join-Path $assetDir 'app-icon.png')

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = New-Object System.Collections.Generic.List[byte[]]
foreach ($size in $sizes) {
  $bmp = Resize-Square $src $size
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs.Add($ms.ToArray())
  $bmp.Dispose()
  $ms.Dispose()
}

$icoPath = Join-Path $build 'icon.ico'
$fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$pngs.Count)
$offset = 6 + (16 * $pngs.Count)
$offsets = @()
foreach ($data in $pngs) {
  $offsets += $offset
  $offset += $data.Length
}
for ($i = 0; $i -lt $pngs.Count; $i++) {
  $size = $sizes[$i]
  $dim = if ($size -ge 256) { [byte]0 } else { [byte]$size }
  $bw.Write($dim)
  $bw.Write($dim)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]32)
  $bw.Write([uint32]$pngs[$i].Length)
  $bw.Write([uint32]$offsets[$i])
}
foreach ($data in $pngs) {
  $bw.Write($data)
}
$bw.Flush()
$fs.Close()

$iconPng.Dispose()
$appIcon.Dispose()
$src.Dispose()

Write-Output "wrote build/icon.png, build/icon.ico, src/renderer/src/assets/app-icon.png"
