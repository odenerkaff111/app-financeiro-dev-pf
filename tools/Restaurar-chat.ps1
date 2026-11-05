[CmdletBinding()]
param(
    [string]$Repositorio = (Join-Path $env:USERPROFILE 'app-financeiro-dev-pf-v9'),
    [Parameter(Mandatory=$true)][string]$Backup,
    [switch]$Iniciar
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function HashTexto([string]$Caminho) {
    $texto = [IO.File]::ReadAllText($Caminho,[Text.Encoding]::UTF8).Replace("`r`n","`n").TrimStart([char]0xFEFF)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($texto)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function HashDoBackup([string]$Caminho,$Entrada) {
    if ($Entrada.PSObject.Properties['hashMode'] -and $Entrada.hashMode -eq 'raw') { return (Get-FileHash -LiteralPath $Caminho -Algorithm SHA256).Hash.ToLowerInvariant() }
    return HashTexto $Caminho
}
$repo = (Resolve-Path -LiteralPath $Repositorio).Path
$salvo = (Resolve-Path -LiteralPath $Backup).Path
if (!(Test-Path -LiteralPath (Join-Path $repo 'package.json') -PathType Leaf)) { throw 'Pasta do projeto incorreta.' }
$entradas = @(Get-Content -LiteralPath (Join-Path $salvo 'rollback.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
if (!$entradas.Count -or $entradas.Count -gt 1000) { throw 'Backup invalido.' }
foreach ($entrada in $entradas) {
    $rel = [string]$entrada.path
    if (!$rel -or $rel -match '\.\.|^[\\/]|:|\\|(^|/)(\.env[^/]*|\.git|node_modules|\.next)(/|$)') { throw "Caminho invalido no backup: $rel" }
    if ($entrada.existed -and (!(Test-Path -LiteralPath (Join-Path $salvo $rel) -PathType Leaf) -or (HashDoBackup (Join-Path $salvo $rel) $entrada) -ne $entrada.hash)) { throw "Backup incompleto ou alterado: $rel" }
}
Get-Command robocopy.exe -ErrorAction Stop | Out-Null
$seguranca = $repo + '-antes-de-restaurar-chat-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
& robocopy.exe $repo $seguranca /E /XJ /XD node_modules .next .git /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw 'Falha na copia de seguranca. Restauracao cancelada.' }
foreach ($entrada in $entradas) {
    $destino = Join-Path $repo ([string]$entrada.path)
    if ($entrada.existed) {
        New-Item -ItemType Directory -Path (Split-Path $destino -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $salvo ([string]$entrada.path)) -Destination $destino -Force
    } elseif (Test-Path -LiteralPath $destino -PathType Leaf) { Remove-Item -LiteralPath $destino -Force }
}
foreach ($entrada in $entradas) {
    $destino = Join-Path $repo ([string]$entrada.path)
    if ($entrada.existed) { if ((HashDoBackup $destino $entrada) -ne $entrada.hash) { throw "Falha ao restaurar $destino" } }
    elseif (Test-Path -LiteralPath $destino) { throw "Arquivo novo ainda presente: $destino" }
}
Set-Location -LiteralPath $repo
foreach ($gerado in @('.next','tsconfig.tsbuildinfo')) { $caminho = Join-Path $repo $gerado; if (Test-Path -LiteralPath $caminho) { Remove-Item -LiteralPath $caminho -Recurse -Force } }
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Arquivos restaurados; falha ao reinstalar dependencias.' }
Write-Host "VERSAO ANTERIOR RESTAURADA. Copia do estado substituido: $seguranca" -ForegroundColor Green
Write-Host 'Os dados financeiros e as tabelas do Supabase foram preservados.'
if ($Iniciar) { & npm.cmd run dev }
