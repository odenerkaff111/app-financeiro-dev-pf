# Correção da Parte 2A

## Motivo

O teste da migration 011 falhava no SQL Editor com:

`Você não possui acesso a esta dívida.`

O SQL Editor não possui `auth.uid()` de um usuário do aplicativo. A função
`pf_calculate_debt_position` era `SECURITY INVOKER`, mas fazia uma segunda
checagem explícita por `pf_is_member`, impedindo a validação administrativa.

## Segurança preservada

A checagem explícita foi removida da função, mas a proteção permanece porque:

- a função continua `SECURITY INVOKER`;
- `pf_debts` continua protegida por RLS;
- `pf_debt_positions` continua `security_invoker = true`;
- apenas usuários autenticados recebem permissão de execução;
- usuários sem acesso não conseguem ler a dívida subjacente.

## Ordem

1. Execute `012_fix_debt_position_access.sql`.
2. Execute `012_financial_engine_smoke.sql`.
3. Rode `npm run build`.
