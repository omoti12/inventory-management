# Serve src/ over HTTPS with a self-signed certificate (PowerShell version).
# Use this instead of start.sh when you want to test barcode camera scanning
# from a smartphone (plain http:// over an IP address is blocked by browsers).
param(
    [int]$Port = 8443
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $python) {
    Write-Error "Python 3 not found. Please install Python 3 and try again."
    exit 1
}

& $python.Source (Join-Path $ProjectRoot "scripts\https_server.py") $Port
