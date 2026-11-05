[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repo
Get-Command git -ErrorAction Stop | Out-Null
Get-Command npm.cmd -ErrorAction Stop | Out-Null
$inside = & git rev-parse --is-inside-work-tree
if ($LASTEXITCODE -ne 0 -or $inside -ne 'true') { throw 'Esta pasta nao e o repositorio Git. Instale na pasta app-financeiro-dev-pf.' }
$branch = ((& git branch --show-current) | Out-String).Trim()
if (!$branch) { throw 'Selecione uma branch antes de publicar.' }
$remote = ((& git remote get-url origin) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notmatch '^https://github\.com/odenerkaff111/app-financeiro-dev-pf(?:\.git)?/?$|^git@github\.com:odenerkaff111/app-financeiro-dev-pf(?:\.git)?$') { throw 'O remoto origin nao corresponde ao projeto app-financeiro-dev-pf.' }
$staged = @(& git diff --cached --name-only)
if ($LASTEXITCODE -ne 0 -or $staged.Count -gt 0) { throw 'Ha arquivos em staging. Conclua ou retire esse staging antes de publicar esta atualizacao.' }
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'faturas-update-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$paths = @($manifest.files)
if (!$paths.Count -or @($paths | Where-Object { $_ -match '(^|/)(\.env[^/]*|\.git|node_modules|\.next|\.private-finance)(/|$)|\.\.|^[\\/]|:' }).Count -gt 0) { throw 'Manifesto de publicacao invalido.' }
foreach ($path in $paths) { if (!(Test-Path -LiteralPath (Join-Path $repo $path) -PathType Leaf)) { throw "Arquivo ausente: $path" } }
& npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'TypeScript falhou.' }
& node tests/run-card-statements-tests.mjs
if ($LASTEXITCODE -ne 0) { throw 'Testes de faturas falharam.' }
& node tests/run-dashboard-tests.mjs
if ($LASTEXITCODE -ne 0) { throw 'Testes do dashboard falharam.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou. Nenhum commit foi criado.' }
& git add -- $paths
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar arquivos.' }
$changes = @(& git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw 'Falha ao conferir o staging.' }
foreach ($path in $changes) { if ($paths -notcontains $path) { throw "Arquivo fora da atualizacao: $path" } }
if ($changes.Count -gt 0) {
    & git diff --cached --stat
    & git commit -m 'feat: resumir faturas e registrar pagamento integral'
    if ($LASTEXITCODE -ne 0) { throw 'Commit falhou. Confira nome e e-mail do Git.' }
}
& git push origin $branch
if ($LASTEXITCODE -ne 0) { throw 'Push falhou. O commit local foi preservado; confira a mensagem do Git antes de repetir.' }
Write-Host "Atualizacao enviada para origin/$branch. A Vercel executara o deploy se essa branch estiver conectada ao projeto." -ForegroundColor Green
