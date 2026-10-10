[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
Get-Command git -ErrorAction Stop | Out-Null
$inside = & git rev-parse --is-inside-work-tree
if ($LASTEXITCODE -ne 0 -or $inside -ne 'true') { throw 'Esta pasta ainda nao e o repositorio Git do projeto.' }
$branch = ((& git branch --show-current) | Out-String).Trim()
if (!$branch) { throw 'HEAD destacado. Selecione sua branch antes de publicar.' }
$remote = & git remote get-url origin
if ($LASTEXITCODE -ne 0 -or !$remote) { throw 'O remoto origin precisa estar configurado para o seu repositorio.' }
$staged = @(& git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel verificar os arquivos preparados para commit.' }
if ($staged.Count -gt 0) { throw 'Ja ha arquivos preparados em staging. Revise-os e conclua/remova esse staging antes de usar este publicador.' }
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'finance-update-files.json') -Raw | ConvertFrom-Json
$paths = @($manifest.public_files)
if (!$paths.Count -or @($paths | Where-Object { $_ -match '(^|/)(\.private-finance|\.env|node_modules|\.git)(/|$)' -or $_ -match 'vercel-secrets|\.\.\/' }).Count -gt 0) { throw 'Lista de publicacao invalida.' }
& npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'TypeScript falhou. Publicacao interrompida.' }
& npm.cmd run test:control
if ($LASTEXITCODE -ne 0) { throw 'Testes falharam. Publicacao interrompida.' }
& node tests/run-dashboard-tests.mjs
if ($LASTEXITCODE -ne 0) { throw 'Testes do dashboard falharam. Publicacao interrompida.' }
& node tests/run-push-tests.mjs
if ($LASTEXITCODE -ne 0) { throw 'Testes de PWA/Web Push falharam. Publicacao interrompida.' }
& npm.cmd run test:security
if ($LASTEXITCODE -ne 0) { throw 'Testes de seguranca de API falharam. Publicacao interrompida.' }
& git add -- $paths
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel preparar os arquivos da atualizacao.' }
$staged = @(& git diff --cached --name-only)
if (!$staged.Count) {
    Write-Host 'Nenhuma nova alteracao desta atualizacao para commit.'
    & git push -u origin $branch
    if ($LASTEXITCODE -ne 0) { throw 'Push falhou. Confira autenticacao/conflitos do GitHub.' }
    exit 0
}
foreach ($name in $staged) { if ($paths -notcontains $name) { throw "Arquivo nao autorizado no staging: $name. Revise antes de publicar." } }
& git diff --cached --stat
& git commit -m 'feat: polir experiencia mobile da Kyra'
if ($LASTEXITCODE -ne 0) { throw 'Commit falhou. Confira a configuracao de nome/e-mail do Git.' }
& git push -u origin $branch
if ($LASTEXITCODE -ne 0) { throw 'Commit criado, mas push falhou. Resolva autenticacao/conflitos e repita git push.' }
Write-Host "Publicacao concluida na branch $branch. Arquivos privados e segredos nao foram incluidos." -ForegroundColor Green
