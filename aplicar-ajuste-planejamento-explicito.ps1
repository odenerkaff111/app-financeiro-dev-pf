$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$modalPath = Join-Path $root 'src\components\finance\UnifiedFinancialEntryModal.tsx'
$panelPath = Join-Path $root 'src\components\dashboard\BudgetPlanningPanel.tsx'
$summaryPath = Join-Path $root 'src\components\dashboard\BudgetPlanningSummary.tsx'

foreach ($path in @($modalPath, $panelPath, $summaryPath)) {
    if (-not (Test-Path $path)) {
        throw "Arquivo nao encontrado: $path"
    }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)

function Replace-Required {
    param(
        [string]$Path,
        [string]$Pattern,
        [string]$Replacement,
        [string]$Label
    )

    $text = [System.IO.File]::ReadAllText($Path)
    $regex = New-Object System.Text.RegularExpressions.Regex(
        $Pattern,
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    if (-not $regex.IsMatch($text)) {
        throw "Nao consegui aplicar o ajuste '$Label' em $Path. O arquivo pode estar em uma versao diferente."
    }

    $updated = $regex.Replace($text, $Replacement, 1)
    [System.IO.File]::WriteAllText($Path, $updated, $utf8)
    Write-Host "OK - $Label"
}

# 1) O modal nao deve selecionar planejamento automaticamente.
Replace-Required `
    -Path $modalPath `
    -Pattern '  useEffect\(\(\) => \{\r?\n    if \(form\.kind !== "expense"\) return;\r?\n\r?\n    if \(availablePlannings\.length === 1 && !form\.budgetId\) \{.*?\r?\n  \}, \[availablePlannings, form\.budgetId, form\.kind\]\);' `
    -Replacement @'
  useEffect(() => {
    if (form.kind !== "expense") return;

    if (
      form.budgetId &&
      !availablePlannings.some((plan) => plan.id === form.budgetId)
    ) {
      update("budgetId", "");
    }
  }, [availablePlannings, form.budgetId, form.kind]);
'@ `
    -Label 'remove selecao automatica de planejamento no cadastro'

# 2) Troca o seletor por uma escolha explicita: nao usar ou escolher um plano.
Replace-Required `
    -Path $modalPath `
    -Pattern '\{availablePlannings\.length > 0 && form\.kind === "expense" && \(\r?\n\s*<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">.*?\r?\n\s*</div>\r?\n\s*\)\}' `
    -Replacement @'
{availablePlannings.length > 0 && form.kind === "expense" && (
                              <div className="rounded-xl border border-[#C8A15A]/25 bg-[#F7F5EF] p-3">
                                <SelectField
                                  label="Esta movimentação faz parte de um planejamento?"
                                  value={form.budgetId || "__none__"}
                                  onChange={(value) =>
                                    update(
                                      "budgetId",
                                      value === "__none__" ? "" : value,
                                    )
                                  }
                                  options={[
                                    {
                                      value: "__none__",
                                      label: "Não · deixar fora do planejamento",
                                    },
                                    ...availablePlannings.map((plan) => ({
                                      value: plan.id,
                                      label: "Sim · " + plan.name + " · " + formatCurrency(plan.amount),
                                    })),
                                  ]}
                                  emptyLabel="Não · deixar fora do planejamento"
                                />
                                <p className="mt-2 text-[11px] leading-4 text-[#3A3A3C]/60">
                                  Ter a mesma categoria não é suficiente para consumir a reserva. O gasto só entra no planejamento que você escolher aqui.
                                </p>
                              </div>
                            )}
'@ `
    -Label 'adiciona escolha explicita de planejamento'

# 3) Ao trocar categoria, remove qualquer planejamento anterior para evitar vinculo acidental.
Replace-Required `
    -Path $modalPath `
    -Pattern 'update\("categoryId", value\);\r?\n\s*const category = categories\.find' `
    -Replacement @'
update("categoryId", value);
                                update("budgetId", "");
                                const category = categories.find
'@ `
    -Label 'limpa planejamento ao trocar categoria'

# 4) O painel de planejamento deve contar SOMENTE transacoes explicitamente vinculadas.
Replace-Required `
    -Path $panelPath `
    -Pattern '    const budgetsByCategory = new Map<string, Budget\[\]>\(\);\r?\n    const committedByBudget = new Map<string, number>\(\);\r?\n\r?\n    budgets\.forEach\(\(budget\) => \{.*?\r?\n    \}\);\r?\n\r?\n    transactions\.forEach\(\(transaction\) => \{\r?\n      if \(!transaction\.category_id \|\| transaction\.status !== "paid"\) return;\r?\n      if \(monthKey\(transaction\.occurred_on\) !== month\) return;\r?\n\r?\n      let budgetId = transaction\.budget_id;\r?\n\r?\n      if \(!budgetId\) \{.*?\r?\n      \}\r?\n\r?\n      if \(!budgetId\) return;' `
    -Replacement @'
    const committedByBudget = new Map<string, number>();

    transactions.forEach((transaction) => {
      if (!transaction.category_id || transaction.status !== "paid") return;
      if (monthKey(transaction.occurred_on) !== month) return;

      const budgetId = transaction.budget_id;
      if (!budgetId) return;
'@ `
    -Label 'remove fallback automatico do painel de planejamentos'

# 5) O resumo do dashboard segue a mesma regra explicita.
Replace-Required `
    -Path $summaryPath `
    -Pattern '    const budgetsByCategory = new Map<string, Budget\[\]>\(\);\r?\n    budgets\.forEach\(\(budget\) => \{.*?\r?\n    \}\);\r?\n\r?\n    const usedByBudget = new Map<string, number>\(\);\r?\n    transactions\.forEach\(\(transaction\) => \{\r?\n      if \(!transaction\.category_id\) return;\r?\n\r?\n      let budgetId = transaction\.budget_id;\r?\n      if \(!budgetId\) \{.*?\r?\n      \}\r?\n\r?\n      if \(!budgetId\) return;' `
    -Replacement @'
    const usedByBudget = new Map<string, number>();
    transactions.forEach((transaction) => {
      if (!transaction.category_id) return;

      const budgetId = transaction.budget_id;
      if (!budgetId) return;
'@ `
    -Label 'remove fallback automatico do resumo do dashboard'

# 6) Atualiza os textos da tela de planejamento para refletir a nova regra.
Replace-Required `
    -Path $panelPath `
    -Pattern 'Reserve um valor para uma categoria\. Somente gastos efetivamente pagos nessa categoria e nesse mês consomem o planejamento\.' `
    -Replacement 'Reserve um valor para um objetivo. Somente gastos pagos e explicitamente vinculados a esse planejamento consomem a reserva.' `
    -Label 'atualiza explicacao principal do planejamento'

Replace-Required `
    -Path $panelPath `
    -Pattern 'As movimentações dessa categoria, no mesmo mês, consumirão este planejamento automaticamente\.' `
    -Replacement 'Ao registrar uma despesa dessa categoria, você decide se ela deve ou não consumir este planejamento.' `
    -Label 'atualiza explicacao de nova categoria'

Replace-Required `
    -Path $panelPath `
    -Pattern 'O planejamento pertence a <strong>\{formatMonth\(month\)\}</strong> e possui nome \+ categoria\. Ao registrar uma despesa paga, o Kyra permite vinculá-la ao planejamento correto\. Quando existe apenas um planejamento daquela categoria no mês, o vínculo é automático\. Uma conta apenas A pagar ainda não reduz a reserva\.' `
    -Replacement 'O planejamento pertence a <strong>{formatMonth(month)}</strong> e possui nome + categoria. Ao registrar uma despesa, você escolhe explicitamente se ela pertence a algum planejamento. Compartilhar a mesma categoria não cria vínculo automático. Apenas gastos pagos e vinculados reduzem a reserva.' `
    -Label 'atualiza regra exibida no rodape do planejamento'

Write-Host ''
Write-Host 'Ajuste aplicado com sucesso.' -ForegroundColor Green
Write-Host 'Agora execute: npx tsc --noEmit'
