# Testes da Etapa 2

## Recomendações

1. Abra o Dashboard.
2. Aguarde o painel Recomendações da Kyra.
3. Clique em Atualizar análise.
4. Confirme que as recomendações usam números existentes e não executam ações.

## Evento de sessão

No SQL Editor, como proprietário:

```sql
select event_type, severity, success, created_at
from public.pf_security_events
order by created_at desc
limit 20;
```

Deve existir `session_started` depois de uma nova sessão do navegador.

## Liquidação pelo Dashboard

Registre uma liquidação em Próximas obrigações e procure por:

```sql
select event_type, resource_type, success, created_at
from public.pf_security_events
where event_type = 'obligation_settlement_confirmed'
order by created_at desc;
```

## Retenção

Não execute a limpeza em produção sem backup. A RPC é:

```sql
select public.pf_purge_expired_compliance_data('<HOUSEHOLD_ID>'::uuid);
```
