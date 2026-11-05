# Kyra v9.4 — Assistente financeiro com propostas em lote (MVP seguro)

## O que esta entrega faz

O chat envia uma descrição (até 4.500 caracteres) a um modelo `openai/gpt-oss-120b` **pela API Groq**, após autenticar usuário e consultar as contas/categorias/obrigações/faturas/valores a receber no Supabase. A IA recebe somente **aliases temporários** (A1, F1, D1...) e nomes/valores necessários, nunca UUIDs do banco. O modelo não recebe permissão de escrita nem pode enviar SQL.

O servidor valida a resposta estruturada: montantes em centavos, datas, permissões, IDs do contexto, cartões separados de bancos, e duplicações óbvias. A prévia com até 20 operações é salva com uma fotografia dos saldos/limites/faturas/dívidas/obrigações. O usuário revisa e confirma manualmente. **Somente o RPC Postgres** executa a operação em transação; erro reverte todo o lote; repetição da confirmação retorna o mesmo resultado. Planos expiram em 60 minutos.

Ações disponíveis:

- Receitas e despesas bancárias realizadas.
- Transferências internas (inclusive entre PJ e PF, sem tratá-las como receita).
- Aplicações e resgates entre contas existentes e contas `investment` existentes.
- Quitação integral de uma fatura **própria** já registrada, sem pagar compra por compra.
- Compra em cartão **próprio**, inclusive parcelada (até 24 vezes) e nova assinatura mensal; exige fatura e categoria.
- Pagamento de dívida existente, recebimento de empréstimo concedido existente.
- Baixa integral de conta a pagar não relacionada a cartão.
- Conciliação de saldo explícito com motivo, sem inventar diferença como despesa.
- Consulta determinística aos saldos PF, PJ, investimento e crédito sem chamar LLM.

### Não suportado automaticamente nesta fase

- Distribuir um único PIX entre múltiplos compromissos (ex.: fatura da Vanda + empréstimo + amortização), ou reclassificar dívidas existentes.
- Reconciliar faturas de terceiros a partir de foto/PDF, conferir pagamentos mistos ou criar cartões de terceiros.
- Criar nova conta/caixinha automaticamente, conciliar investimento com rentabilidade/CDI, buscar extratos em bancos ou receber notificações de apps bancários iOS.
- Excluir/estornar um registro, modificar previsão recorrente que já existe, ou imputar uma diferença de saldo a compras desconhecidas.
- Lançar 21 parcelas de cartão numa só chamada (a interface aceita no máximo 24, mas não há suporte a lotes acima de 20 operações distintas); considere as regras e vencimentos reais.

Esses casos retornam uma pergunta/aviso, **sem gravar qualquer operação**, em vez de criar dados incorretos. A próxima etapa deve implementar alocações entre múltiplas obrigações, com recibo, conciliação e reversão segura.

## Instalação, na ordem

1. Rode `supabase/migrations/043_ai_finance_batch_v1.sql` no **SQL Editor** do Supabase, uma vez. Essa migração cria tabelas isoladas e RPCs; não registra despesas e não altera saldos.
2. Rode `supabase/migrations/043_ai_finance_batch_v1_smoke.sql` e verifique se todas as colunas retornam `true`.
3. No console da Groq, crie sua chave e **ative Zero Data Retention (ZDR)** em Data Controls. Verifique condições e permissões contratuais para seus dados e região. Proteger retenção **não impede que os dados sejam processados externamente**. Nunca cole a chave no chat/commit.
4. No arquivo local `.env.local` (que **não** deve ir ao GitHub), adicione:

   ```dotenv
   GROQ_API_KEY=<sua-chave-privada>
   GROQ_BATCH_MODEL=openai/gpt-oss-120b
   KYRA_GROQ_ZDR_ACKNOWLEDGED=true
   ```

   Marque o último campo como `true` **somente depois** de ativar ZDR e aceitar o envio de dados financeiros mínimos à Groq. O aplicativo não consegue verificar essa preferência diretamente no console do provedor.
5. Rode `npm run typecheck`, `npm run test:ai-batch`, `npm run test:control`, `node tests/run-dashboard-tests.mjs`, `node tests/run-push-tests.mjs`, `npm run test:security`, `npm run build`, `npm run dev`.
6. Confira **Ajustes → IA**: deve mostrar `Groq — Configurado` para o modo de lançamentos. O seletor OpenRouter é separado e continua atendendo funcionalidades legadas; ele **não** seleciona o modelo desta nova função.
7. Teste um pedido de múltiplos lançamentos **reais ainda não cadastrados**, veja a prévia, e clique `Confirmar` apenas se todos os itens estiverem corretos. Para experimentar com dados fictícios, não clique Confirmar; use `Corrigir`.
8. Antes de produção, configure as mesmas três variáveis de ambiente no **Vercel → Project Settings → Environment Variables**, associadas ao ambiente correto. Faça deploy após validar build e smoke da migração.

### Importante sobre gratuidade

Groq pode oferecer franquias gratuitas, mas os limites são **dinâmicos** e variam por conta/modelo. Respostas 429 apenas informam que a quota foi atingida: **não há fallback automático** para provedores que podem usar/reter seus dados. Nenhuma API gratuita tem disponibilidade garantida. Uma chave com plano faturado pode gerar custos; confira o seu plano na Groq.

### Segurança e idempotência

- Autenticação via JWT real (`supabase.auth.getUser`) em `/api/assistant/batch/prepare`, `/confirm` e `/status`.
- Validação e autorização no servidor **e novamente** no Postgres (`auth.uid`, `pf_can_write`, household).
- Sem `service_role` no front-end; sem SQL gerado por IA; sem função arbitrária; saída aceita apenas em esquema fixo.
- No máximo 10 chamadas ao modelo por usuário em janelas de 10 minutos (via tabela SQL) e 20 por hora (uso), conforme configuração de limites.
- Preview expira em 1 hora, usa snapshots de saldos/faturas/dívidas para detectar edições externas e bloqueia atualização de plano obsoleto.
- Confirmação única transacional, retornando recibo idempotente se repetida; alterações em banco são revertidas se qualquer operação falhar.
- Sem montagem ou compartilhamento de `.env.local`, senhas, extratos brutos ou chave de API.

### Limitações da validação

Os testes unitários garantem estrutura e invariantes estáticos, mas **não substituem a execução da migração no Supabase**, a disponibilidade real da API Groq, testes com usuário autenticado, nem verificam que o modelo interpreta corretamente todos os pedidos em português. Faça a primeira homologação com dados sintéticos num projeto de teste, e teste casos de falha, saldo alterado, cobrança repetida, conta de outro grupo e rate limit.

### Exemplos que o modo avançado entende

- `Dia 10 comprei R$ 18,50 na padaria pelo Itaú e R$ 9,90 no Meu Prata pelo Santander.`
- `Hoje fiz um PIX de R$ 300 do Santander para o Nubank.`
- `Paguei integralmente a fatura Nubank de 10/11 com dinheiro do Santander.`
- `Apliquei R$ 250 do Nubank na caixinha que já está cadastrada.`
- `Paguei R$ 200 da dívida com Vanda pelo Santander; foi amortização parcial.`

Se existirem várias faturas, uma categoria desconhecida ou outra incerteza, o assistente faz perguntas antes de propor o registro.
