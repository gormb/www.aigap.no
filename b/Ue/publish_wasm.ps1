# Post-build publish for the Wasm stage.
# Run after BuildCookRun (LddMin.cmd does). Idempotent: safe to run any time.
#
# GitHub Pages cannot send Content-Encoding, and the raw module is over the 100 MB
# per-file limit, so the site ships the gzip sibling and the page decompresses it.
param(
    [string]$Stage = 'C:\doc\www.aigap.no\b\Ue\Saved\StagedBuilds\Wasm',
    [string]$Pack  = 'C:\doc\www.aigap.no\b\Ue\LddMin_Pack\Wasm'
)

$ErrorActionPreference = 'Stop'
function Say($m) { Write-Host "publish: $m" }

if (-not (Test-Path $Pack)) { throw "pack folder not found: $Pack" }

# 1. Copy the stage over the pack when the stage is newer (UAT -archive may have been interrupted).
if (Test-Path $Stage) {
    $stagePage = Join-Path $Stage 'index.html'
    $packPage  = Join-Path $Pack  'index.html'
    $stale = (-not (Test-Path $packPage)) -or ((Get-Item $stagePage).LastWriteTime -gt (Get-Item $packPage).LastWriteTime)
    if ($stale) {
        Say "copying stage -> pack"
        robocopy $Stage $Pack /MIR /NFL /NDL /NJH /NJS /NP /XF *.tmp | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
    } else { Say "pack is up to date" }
}

Get-ChildItem -Path $Pack -Recurse -Include *.tmp -File | Remove-Item -Force

# 2. Replace the raw module with its gzip sibling.
$binDir = Join-Path $Pack 'LddMin\Binaries\Wasm'
$raw = Get-ChildItem $binDir -Filter *.wasm -File | Sort-Object Length -Descending | Select-Object -First 1
if ($raw) {
    $gz = "$($raw.FullName).gz"
    Remove-Item $gz -Force -ErrorAction SilentlyContinue
    Say ("gzip {0} ({1:N1} MB)" -f $raw.Name, ($raw.Length / 1MB))
    $in = [IO.File]::OpenRead($raw.FullName)
    $out = [IO.File]::Create($gz)
    $z = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)
    try { $in.CopyTo($z, 1048576) } finally { $z.Dispose(); $out.Dispose(); $in.Dispose() }
    Remove-Item $raw.FullName -Force
    Say ("      -> {0} ({1:N1} MB)" -f (Split-Path $gz -Leaf), ((Get-Item $gz).Length / 1MB))
}
# The Brotli sibling cannot be served by GitHub Pages and only bloats the checkout.
Get-ChildItem $binDir -Filter *.wasm.br -File | Remove-Item -Force

# 3. index_notest.html: the same page with the start-up list hidden and the
#    compatibility gate neutralized (it still uses the same scripts and the same module).
$page = Join-Path $Pack 'index.html'
$t = [IO.File]::ReadAllText($page)
if ($t -notmatch '#steps\{display:none') {
    $t = $t.Replace('</head>', '<style>#steps{display:none!important}</style></head>')
}
if ($t -notmatch 'ueCompat\.check\s*=\s*function') {
    $gate = '<script>(function(){function c(){if(window.ueCompat){window.ueCompat.check=function(){return null};return true}return false}if(!c()){var n=0,t=setInterval(function(){if(c()||++n>200)clearInterval(t)},5)}})();</script>'
    $t = $t.Replace('<script src="wasm-loader.js"></script>', $gate + '<script src="wasm-loader.js"></script>')
}
[IO.File]::WriteAllText((Join-Path $Pack 'index_notest.html'), $t, (New-Object System.Text.UTF8Encoding($false)))

# 4. Summary of what a visitor actually downloads.
$wasmGz = Get-ChildItem $binDir -Filter *.wasm.gz -File | Select-Object -First 1
$threads = [regex]::Match([IO.File]::ReadAllText($page), '<meta name="ue-threads-desktop" content="([a-z]+)">').Groups[1].Value
Say ("threading (desktop): {0}" -f $(if ($threads) { $threads } else { 'unset' }))
Say ("module: {0}" -f $(if ($wasmGz) { "{0} ({1:N1} MB)" -f $wasmGz.Name, ($wasmGz.Length / 1MB) } else { 'MISSING' }))
Say 'done'