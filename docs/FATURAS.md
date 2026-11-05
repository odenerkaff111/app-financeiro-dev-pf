# Faturas mensais

## Instalacao no projeto existente

1. Execute o instalador do ZIP na pasta Git `app-financeiro-dev-pf`.
2. O instalador copia o SQL `supabase/migrations/044_card_statements_dashboard.sql` para a area de transferencia. Cole e execute o arquivo inteiro no SQL Editor do projeto correto no Supabase.
3. Somente depois do SQL concluir, execute `tools/publicar-faturas.ps1`. O script faz build, cria um commit apenas dos arquivos desta atualizacao e envia a branch atual ao GitHub. A configuracao de branch da Vercel continua valendo.

O SQL 044 pressupoe o controle financeiro da migracao 038 ja instalado. Nao execute novamente todas as migracoes antigas: algumas contem cargas historicas. O ajuste na assinatura da funcao recorrente em 038 apenas preserva o valor padrao anterior para futuras instalacoes dessa estrutura.

## Usar o painel

O painel inicial e a pagina Movimentacoes > Proximas obrigacoes compartilham o resumo **Suas faturas**. Escolha o mes do vencimento para ver total, valor pago e saldo a pagar por cartao. Expanda o vencimento para conferir descricao, estabelecimento, data, parcela e valor. Meses futuros usam somente parcelas ja cadastradas; nao incluem compras ainda desconhecidas. Assinaturas previstas ficam separadas ate a confirmacao da cobranca.

Quando o mesmo cartao tem varios vencimentos no mes (por exemplo, 4 e 9), eles aparecem separados. **Conferir e unificar vencimento** altera somente aquele mes apos sua conferencia. A acao preserva o total e registra os vinculos anteriores para auditoria. Nao unifique faturas diferentes apenas porque sao do mesmo titular. Faturas com pagamentos anteriores nao podem ser unificadas por este fluxo.

Depois de efetivamente fazer o pagamento no banco, use **Pagar fatura inteira**, escolha a conta real e a data do pagamento e confirme o valor com a fatura do banco. A ferramenta registra um unico debito e baixa todos os itens incluidos. A acao e um registro financeiro: nao envia PIX nem paga boletos no banco. Nesta versao, o valor de pagamento e o saldo integral da fatura; pagamento parcial, juros e estornos nao sao feitos por esse botao.

Se o painel avisar que a fatura mudou, feche a confirmacao, atualize, confira os itens e abra novamente o pagamento. Repeticoes da mesma requisicao retornam o recibo sem um novo debito. A confirmacao exige a mesma versao da composicao que foi mostrada.

## Dados e saldos

- A migracao liga apenas compras de terceiro ainda em aberto, sem baixa avulsa anterior. Compras pagas ou canceladas, seus valores e seus vencimentos permanecem no historico.
- Um cadastro de controle existente e reutilizado pelo titular. Cadastros ambiguos ou saldos conciliados que possam duplicar parcelas interrompem a migracao inteira para conferencia.
- A migracao nao debita bancos nem movimenta reservas ou limites. O saldo de controle do cartao passa a refletir o primeiro vencimento em aberto, como no modelo existente de faturas proprias.
- O limite de terceiros fica fora da disponibilidade para compras. A disponibilidade continua sendo saldo em contas mais limite proprio conhecido; investimentos ficam separados.
- Pagamentos pelo painel ou pela API antiga de faturas preservam o limite disponivel informado. Isso atende cartoes pre-pagos, cujo valor liberado pode diferir do valor pago. Confira o limite real em Contas > Conferir no banco quando necessario. Nenhum pagamento usa automaticamente a caixinha da casa.
- Parcelas com baixa avulsa antiga permanecem no extrato e nas obrigacoes aplicaveis. O painel avisa quando ha compras de terceiro sem vinculo; esses registros precisam ser conciliados antes de entrar numa fatura para pagamento integral.
- Permissoes existentes continuam valendo: administradores registram pagamentos; visualizadores apenas consultam. As consultas respeitam as politicas de acesso do grupo.

## Validacao

Execute `node tests/run-card-statements-tests.mjs`, `node tests/run-dashboard-tests.mjs`, `npm run typecheck` e `npm run build`. O SQL opcional `supabase/tests/044_card_statements_smoke.sql` cria um grupo temporario, confere os efeitos financeiros e termina com `ROLLBACK`. Execute-o inteiro com postgres somente depois do SQL 044.

Na entrega foram executados o build de producao, as suites JavaScript existentes e os testes de faturas. A migracao foi executada duas vezes em PostgreSQL embutido (PGlite), com dados de teste, e validada com os testes transacionais. A interface foi exercitada em Chromium, em resolucoes de computador e celular, incluindo nova tentativa apos falha de rede e consulta como visualizador. Os dados reais do Supabase nao foram acessados nem alterados para validar esta entrega.

O instalador tambem foi executado em PowerShell 7, em um repositorio temporario: conferencia, conflito, restauracao apos falha, instalacao, repeticao e preservacao de configuracao e branch. O publicador foi exercitado com commit local e envio simulado; o build real do projeto foi validado separadamente. Nao foi feito push ao GitHub nem deploy real nesta entrega.
