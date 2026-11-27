param([string]$Python = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not $Python) {
  $anacondaPython = Join-Path $env:USERPROFILE 'anaconda3\python.exe'
  if (Test-Path -LiteralPath $anacondaPython) { $Python = $anacondaPython } else { $Python = 'python' }
}
if (-not (Test-Path -LiteralPath '.venv-ml\Scripts\python.exe')) {
  & $Python -m venv .venv-ml
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno Python. Indica -Python con la ruta a Python 3.11 o posterior.' }
}
& '.\.venv-ml\Scripts\python.exe' -m pip install -r ml/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias ML.' }
Write-Host 'Entorno ML preparado. npm start o npm run remote inicia un único proceso Python persistente.'
