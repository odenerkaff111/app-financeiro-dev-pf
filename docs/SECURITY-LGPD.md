# Segurança, auditoria e LGPD

## Princípios adotados

- Menor privilégio com RLS por grupo familiar.
- Papéis de administrador e visualizador.
- Auditoria de alterações financeiras no banco.
- Eventos de segurança separados da auditoria financeira.
- Nenhum IP ou User-Agent é armazenado em texto puro; apenas hash SHA-256 com salt.
- Metadados dos eventos usam uma lista permitida e não recebem valores, descrições ou nomes financeiros.
- Recomendações da IA não executam ações financeiras.
- Cálculos são determinísticos; a IA apenas prioriza e explica.
- Retenção configurável para auditoria, eventos de segurança e recomendações.
- Solicitações de acesso, exportação, correção, exclusão e restrição ficam registradas.

## Variável recomendada

Adicione uma string aleatória longa ao ambiente de produção:

```env
SECURITY_LOG_SALT=troque-por-uma-string-aleatoria-longa
```

Não envie esse valor ao GitHub.

## Retenção padrão

- Auditoria financeira: 365 dias.
- Eventos de segurança: 180 dias.
- Recomendações: 90 dias.

A limpeza é executada pela RPC `pf_purge_expired_compliance_data` e exige o papel proprietário.

## Limite importante

A implementação oferece controles técnicos alinhados a boas práticas de privacidade, mas não substitui análise jurídica, política de privacidade, definição formal de controlador/operador ou processo organizacional de resposta a titulares.
