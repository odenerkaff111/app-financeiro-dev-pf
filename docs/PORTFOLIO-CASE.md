# Case técnico — Plataforma financeira pessoal com IA

## Problema

Centralizar contas, movimentações, dívidas, compromissos, recebíveis e investimentos sem exigir que o usuário mantenha vários cadastros desconectados.

## Decisões de produto

- Uma entrada manual centralizada em Movimentações.
- Assistente conversacional como segunda porta de entrada.
- Demais telas voltadas à leitura e acompanhamento.
- Confirmação obrigatória antes de qualquer ação proposta pela IA.
- Motor financeiro no PostgreSQL como fonte única dos cálculos.

## Arquitetura

- Next.js e TypeScript na aplicação.
- Supabase Auth, PostgreSQL, RLS e RPCs transacionais.
- OpenRouter para linguagem natural.
- Cálculos determinísticos para saldos, juros, custo de vida, obrigações e alertas.
- Auditoria de mudanças e eventos de segurança com metadados minimizados.

## Capacidades demonstradas

- Product discovery e priorização de MVP.
- Modelagem financeira e de dados.
- Pagamentos e recebimentos parciais.
- Juros simples e compostos.
- RBAC, RLS e funções `security definer`.
- Integração de LLM com saída controlada e confirmação humana.
- Observabilidade, retenção e controles de privacidade.
- Design de experiência orientada à tomada de decisão.

## Segurança do repositório público

O repositório não deve conter:

- chaves do Supabase;
- chave do OpenRouter;
- `SECURITY_LOG_SALT`;
- extratos bancários reais;
- nomes de credores reais em seeds públicos;
- dumps do banco de produção;
- screenshots com dados pessoais reais.

Use dados fictícios em demonstrações e mantenha `.env.local` fora do Git.
