[CmdletBinding()]
param(
    [string]$Repositorio = (Join-Path $env:USERPROFILE 'app-financeiro-dev-pf-v9'),
    [string]$Pacote = '',
    [switch]$SomenteVerificar,
    [switch]$Iniciar
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($Pacote)) {
    if (![string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $Pacote = $PSScriptRoot
    } elseif (![string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
        $Pacote = [IO.Path]::GetDirectoryName($MyInvocation.MyCommand.Path)
    } else {
        throw 'Informe -Pacote com a pasta extraida kyra-chat-mobile-v1.'
    }
}
if (!(Test-Path -LiteralPath (Join-Path $Pacote 'patch.json') -PathType Leaf)) {
    throw "Pacote nao encontrado ou incompleto: $Pacote. Informe a pasta que contem patch.json e codigo."
}
function HashTexto([string]$Caminho) {
    $texto = [IO.File]::ReadAllText($Caminho,[Text.Encoding]::UTF8).Replace("`r`n","`n").TrimStart([char]0xFEFF)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($texto)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function HashArquivo([string]$Caminho,[string]$Modo) {
    if ($Modo -eq 'raw') { return (Get-FileHash -LiteralPath $Caminho -Algorithm SHA256).Hash.ToLowerInvariant() }
    return HashTexto $Caminho
}
function CaminhoValido([string]$Relativo) {
    return $Relativo -and $Relativo -notmatch '\.\.|^[\\/]|:|\\|(^|/)(\.env[^/]*|\.git|node_modules|\.next)(/|$)'
}
if (!(Test-Path -LiteralPath (Join-Path $Repositorio 'package.json') -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $Repositorio 'src/app') -PathType Container)) { throw "Pasta do projeto incorreta: $Repositorio" }
$repo = (Resolve-Path -LiteralPath $Repositorio).Path
$pacoteAtual = (Resolve-Path -LiteralPath $Pacote).Path
$fonte = Join-Path $pacoteAtual 'codigo'
if ($repo.TrimEnd([char[]]'\/') -eq $fonte.TrimEnd([char[]]'\/')) { throw 'Escolha sua pasta de trabalho, nao a pasta codigo do ZIP.' }
$manifesto = Get-Content -LiteralPath (Join-Path $pacoteAtual 'patch.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$entradas = @($manifesto.files)
if (!$entradas.Count -or $entradas.Count -gt 1000) { throw 'Manifesto de instalacao invalido.' }
$vistos = @{}
$estados = @{}
$aplicar = @()
$antes = @(
    foreach ($entrada in $entradas) {
        $rel = [string]$entrada.path
        if (!(CaminhoValido $rel) -or $vistos.ContainsKey($rel)) { throw "Caminho invalido ou repetido: $rel" }
        $vistos[$rel] = $true
        if ($entrada.mode -notin @('replace','missing') -or $entrada.hashMode -notin @('text','raw')) { throw "Manifesto sem regra valida para $rel" }
        $origem = Join-Path $fonte $rel
        if (!(Test-Path -LiteralPath $origem -PathType Leaf) -or (HashArquivo $origem $entrada.hashMode) -ne $entrada.newHash) { throw "Pacote incompleto ou alterado: $rel. Extraia o ZIP inteiro novamente." }
        $destino = Join-Path $repo $rel
        if (Test-Path -LiteralPath $destino -PathType Container) { throw "O destino deveria ser arquivo: $destino" }
        $situacao = 'AUSENTE'
        if (Test-Path -LiteralPath $destino -PathType Leaf) {
            if ($entrada.mode -eq 'missing') { $situacao = 'PRESERVADO' }
            else { $situacao = if ((HashArquivo $destino $entrada.hashMode) -eq $entrada.newHash) { 'ATUALIZADO' } else { 'DIFERENTE' } }
        }
        $estados[$rel] = $situacao
        [pscustomobject]@{Arquivo=$rel;Situacao=$situacao}
    }
)
$aplicar = @($entradas | Where-Object { $estados[[string]$_.path] -ne 'PRESERVADO' })
$dependencias = Get-Content -LiteralPath (Join-Path $fonte 'tests/family-migrations.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($nome in $dependencias) { if (!$vistos.ContainsKey('supabase/migrations/' + [string]$nome)) { throw "Pacote incompleto: falta a dependencia SQL $nome" } }
foreach ($teste in @('run-chat-tests.mjs','run-chat-model-tests.mjs','run-chat-sql-tests.mjs','chat-sql-cases.mjs','run-family-sql-tests.mjs','run-family-finance-tests.mjs','run-family-plan-tests.mjs','run-api-security-tests.mjs','run-ai-batch-tests.mjs','run-control-tests.mjs','run-dashboard-tests.mjs','run-card-statements-tests.mjs')) { if (!$vistos.ContainsKey('tests/' + $teste)) { throw "Pacote incompleto: falta tests/$teste" } }
Write-Host "PASTA: $repo"
Write-Host "ARQUIVOS DO PATCH: $($entradas.Count)"
Write-Host "DEPENDENCIAS EXISTENTES PRESERVADAS: $(@($antes | Where-Object Situacao -eq 'PRESERVADO').Count)"
Write-Host "DEPENDENCIAS AUSENTES A REPOR: $(@($entradas | Where-Object { $_.mode -eq 'missing' -and $estados[[string]$_.path] -eq 'AUSENTE' }).Count)"
if ($SomenteVerificar) { $antes | Format-Table -AutoSize; return }
Get-Command npm.cmd -ErrorAction Stop | Out-Null
Get-Command node.exe -ErrorAction Stop | Out-Null
$versaoNode = (& node.exe -p 'process.versions.node')
if ($LASTEXITCODE -ne 0 -or [version]$versaoNode -lt [version]'20.9.0') { throw 'Use Node.js 20.9 ou superior.' }
$backup = Join-Path (Split-Path $repo -Parent) ((Split-Path $repo -Leaf) + '-backup-chat-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $backup | Out-Null
$antes | Export-Csv -LiteralPath (Join-Path $backup 'relatorio-antes.csv') -NoTypeInformation -Encoding UTF8
$reversao = @(
    foreach ($entrada in $aplicar) {
        $rel = [string]$entrada.path
        $destino = Join-Path $repo $rel
        $existia = Test-Path -LiteralPath $destino -PathType Leaf
        $hash = $null
        if ($existia) {
            $salvo = Join-Path $backup $rel
            New-Item -ItemType Directory -Path (Split-Path $salvo -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $destino -Destination $salvo
            $hash = HashArquivo $destino $entrada.hashMode
            if ((HashArquivo $salvo $entrada.hashMode) -ne $hash) { throw "Falha no backup de $rel. Nenhum arquivo foi substituido." }
        }
        [pscustomobject]@{path=$rel;existed=$existia;hash=$hash;hashMode=$entrada.hashMode}
    }
)
ConvertTo-Json -InputObject $reversao -Depth 5 | Set-Content -LiteralPath (Join-Path $backup 'rollback.json') -Encoding UTF8
Write-Host "BACKUP COMPLETO: $backup" -ForegroundColor Green
foreach ($entrada in $aplicar) {
    $destino = Join-Path $repo ([string]$entrada.path)
    New-Item -ItemType Directory -Path (Split-Path $destino -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $fonte ([string]$entrada.path)) -Destination $destino -Force
}
foreach ($entrada in $entradas) {
    $destino = Join-Path $repo ([string]$entrada.path)
    if (!(Test-Path -LiteralPath $destino -PathType Leaf)) { throw "Dependencia ainda ausente: $($entrada.path). Backup: $backup" }
    if ($estados[[string]$entrada.path] -ne 'PRESERVADO' -and (HashArquivo $destino $entrada.hashMode) -ne $entrada.newHash) { throw "Falha ao conferir $($entrada.path). Backup: $backup" }
}
Write-Host "ARQUIVOS COPIADOS E CONFERIDOS: $($aplicar.Count) de $($aplicar.Count)" -ForegroundColor Green
Set-Location -LiteralPath $repo
foreach ($gerado in @('.next','tsconfig.tsbuildinfo')) { $caminho = Join-Path $repo $gerado; if (Test-Path -LiteralPath $caminho) { Remove-Item -LiteralPath $caminho -Recurse -Force } }
$dependenciasAtuais = $false
if ($estados['package.json'] -eq 'ATUALIZADO' -and $estados['package-lock.json'] -eq 'ATUALIZADO' -and (Test-Path -LiteralPath (Join-Path $repo 'node_modules') -PathType Container)) {
    & npm.cmd ls '--depth=0' *> $null
    $dependenciasAtuais = $LASTEXITCODE -eq 0
}
if ($dependenciasAtuais) { Write-Host 'DEPENDENCIAS JA INSTALADAS: verificacao npm ls OK.' -ForegroundColor Green }
else {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "Falha nas dependencias. Backup: $backup" }
}
foreach ($script in @('typecheck','test:family','test:chat','test:security','test:ai-batch','test:control')) {
    & npm.cmd run $script
    if ($LASTEXITCODE -ne 0) { throw "Falha em $script. Backup: $backup" }
}
foreach ($teste in @('tests/run-dashboard-tests.mjs','tests/run-card-statements-tests.mjs')) {
    & node.exe $teste
    if ($LASTEXITCODE -ne 0) { throw "Falha em $teste. Backup: $backup" }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Build falhou. Confira .env.local e a mensagem acima. Backup: $backup" }
Write-Host "CHAT KYRA INSTALADO E VALIDADO EM: $repo" -ForegroundColor Green
Write-Host 'O dashboard foi preservado. O instalador nao publica na Vercel nem executa SQL no Supabase.'
Write-Host 'Confira a instalacao do banco e dos modelos em Ajustes > IA. Esta versao reutiliza o banco ja instalado. Nao execute os SQLs novamente na base conectada.'
if ($Iniciar) { & npm.cmd run dev }
