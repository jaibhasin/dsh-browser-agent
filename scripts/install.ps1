# Run from an extracted repository or checkout. No administrator privileges needed.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 24 LTS from https://nodejs.org, then retry.'
}
$localInstaller = Join-Path $PSScriptRoot 'install.mjs'
if (Test-Path $localInstaller) {
    & node $localInstaller @args
    exit $LASTEXITCODE
}
$installTemp = Join-Path ([IO.Path]::GetTempPath()) ('dsh-browser-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $installTemp | Out-Null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $archive = Join-Path $installTemp 'source.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/jaibhasin/dsh-browser-agent/archive/refs/heads/main.zip' -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $installTemp
    & node (Join-Path $installTemp 'dsh-browser-agent-main/scripts/install.mjs') @args
    $installExit = $LASTEXITCODE
} finally {
    Remove-Item -LiteralPath $installTemp -Recurse -Force
}
exit $installExit
