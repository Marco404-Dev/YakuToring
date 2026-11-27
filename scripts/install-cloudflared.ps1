$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$toolsDirectory = Join-Path $projectDirectory 'tools'
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
$binaryPath = Join-Path $toolsDirectory 'cloudflared.exe'
if (Test-Path -LiteralPath $binaryPath) { Write-Host 'Se conserva tools/cloudflared.exe existente.'; exit 0 }
Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $binaryPath
& $binaryPath --version
if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar el ejecutable de cloudflared.' }
Write-Host 'cloudflared instalado solo en este proyecto. Inicia con npm run remote.'
