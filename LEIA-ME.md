# Ajustes finais antes de usar dados reais

Esta entrega simplifica a tela de Dívidas e preserva o restante do sistema.

## O que muda

- Dívidas passa a mostrar somente `Pessoais` e `Outras dívidas`.
- `Contas a pagar` e `A receber` deixam de aparecer dentro da tela de Dívidas, mas continuam existindo no banco e nos fluxos de movimentações.
- Nova dívida pede apenas a classificação:
  - Pessoal — amigos ou familiares
  - Outras dívidas — bancos ou terceiros
- Acompanhamento mostra saldo atualizado, já pago, juros/encargos, crescimento diário e progresso.
- Pagamento pode ser registrado diretamente pela tela da dívida.
- Assistente passa a gravar novas dívidas usando a mesma classificação simplificada.
- Convites de usuários passam a aceitar `NEXT_PUBLIC_APP_URL` para o link funcionar corretamente após deploy.

## Banco

Execute `supabase/migrations/019_debt_simplification_and_family_groups.sql` no SQL Editor.
Depois execute `supabase/tests/019_debt_simplification_smoke.sql`.

## Validação

Rode `npm run build` antes de considerar esta rodada concluída.
