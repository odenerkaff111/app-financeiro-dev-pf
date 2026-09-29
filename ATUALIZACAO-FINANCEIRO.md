# Atualizacao do controle financeiro - setembro de 2026

## Instalacao local e ordem de execucao

1. Feche as abas da ferramenta, inclusive a versao publicada, para evitar novos registros durante a conciliacao.
2. Abra o terminal PowerShell do VS Code na raiz do projeto. Execute o instalador do ZIP. Ele preserva `.env`, `.env.local` e `.git`, guarda backup fora do repositorio, instala dependencias e executa TypeScript, testes e build. Se alguma verificacao falhar, restaura os arquivos de codigo anteriores.
3. No SQL Editor do Supabase, usando o papel `postgres`, execute, separadamente e por inteiro:
   - `supabase/migrations/038_financial_control.sql`
   - `supabase/migrations/039_daily_control.sql`
   - `tests/041_testar_controle_sem_gravar.sql` (teste transacional; termina em ROLLBACK)
   - `.private-finance/040_conciliar_dados_2026_09_16.sql` (carga PRIVADA)
   - `.private-finance/042_conferir_resultado.sql` (somente leitura)
4. Pare se houver erro em qualquer SQL. O teste precisa concluir antes da carga privada. A carga compara IDs, quantidades e timestamps com a exportacao recebida: se voce mudou a base depois do CSV, ela recusa a substituicao. Nao remova essa protecao para forcar dados antigos.
5. Execute `npm run dev`. No primeiro acesso responda Nao e abra Movimentacoes / Conciliacao. Confira no aplicativo do banco o saldo da conta sinalizada e salve o valor REAL. O popup aceita essa conferencia como revisao financeira. Depois confirme que terminou os registros.
6. Confira os cartoes e emprestimos em Movimentacoes / Proximas obrigacoes. Publique usando `tools/publicar-atualizacao-financeiro.ps1`.

Copiar cada SQL para o clipboard, sempre a partir da raiz do projeto:

```powershell
Get-Content .\supabase\migrations\038_financial_control.sql -Raw -Encoding UTF8 | Set-Clipboard
Get-Content .\supabase\migrations\039_daily_control.sql -Raw -Encoding UTF8 | Set-Clipboard
Get-Content .\tests\041_testar_controle_sem_gravar.sql -Raw -Encoding UTF8 | Set-Clipboard
Get-Content .\.private-finance\040_conciliar_dados_2026_09_16.sql -Raw -Encoding UTF8 | Set-Clipboard
Get-Content .\.private-finance\042_conferir_resultado.sql -Raw -Encoding UTF8 | Set-Clipboard
```

Execute uma linha por vez, cole no SQL Editor e conclua sua execucao ANTES de copiar a proxima. O ultimo comando sobrescreve o clipboard anterior.

## O que muda no uso

**Contas e disponibilidade.** A conta identifica banco, titular e natureza PF/PJ. Recebimento empresarial permanece receita da empresa; transferencia entre contas nao cria nova receita. O dashboard pessoal exclui receitas PJ, credito e reservas do dinheiro disponivel para gastar. Saldos nao confirmados ficam sinalizados e excluidos ate a conferencia. A conciliacao audita a diferenca sem fabricar receita ou despesa e impede que movimentos anteriores ao saldo confirmado voltem a ser descontados.

**Historico.** Saldo correto hoje nao torna automaticamente completo o resultado de um mes que nao foi registrado. O extrato mostra movimentos empresariais com identificacao PJ. Datas nao informadas sao explicitamente marcadas como desconhecidas; datas tecnicas de cadastro nao sao apresentadas como prova da data da compra. As devolucoes ja ajustadas nao sao reimportadas.

**Cartoes.** Em Nova movimentacao, marque compra no cartao, escolha cartao proprio e 1 parcela para ativar tambem a recorrencia. Uma compra nova aumenta a obrigacao e reduz o credito disponivel. Uma compra marcada como ja incluida apenas detalha a fatura conciliada. As previsoes de assinaturas nao viram cobrancas so porque o mes chegou: confirme a cobranca em Proximas obrigacoes quando ela aparecer no banco. Pagar a fatura debita o banco uma unica vez. Este painel de pagamento registra quitacao integral; nao estima juros ou parcelamento de fatura.

**Parcelamentos.** Edite descricao, valor, vencimento, adicione parcelas pendentes ou cancele as incorretas. Parcelas ja liquidadas e seus pagamentos permanecem preservados. Em fatura conciliada, retirar um detalhe devolve esse valor ao saldo sem detalhamento; nao presume um estorno bancario. Para refletir um estorno real, confira a fatura no banco e concilie o total.

**Emprestimos concedidos.** O principal sai da conta e cria um valor a receber, sem virar despesa de consumo. Devolucoes parciais ou totais baixam o principal e creditam a conta, sem criar salario. Um emprestimo historico ja refletido no saldo pode ser cadastrado sem novo debito, com data e conta desconhecidas explicitamente vazias.

**Planejamento.** A categoria nao escolhe um planejamento automaticamente. Somente o vinculo escolhido e pagamentos efetivos consomem o planejamento. Textos do seletor foram corrigidos para UTF-8.

**Controle diario.** O servidor guarda respostas e atividade. A primeira entrada do dia e cada horario configurado pedem conferencia. Depois de responder Nao, apenas abrir/fechar um formulario nao libera o restante. E necessario salvar um registro ou uma conferencia de saldo. Excluir ou cancelar um registro nao serve como evidencia de atividade existente. Antes de responder Nao, a opcao Hoje nao houve movimentacoes continua disponivel. Trata-se de um controle de uso, nao de verificacao automatica do extrato bancario.

## WhatsApp

A integracao escolhida e Evolution API, com leitura de QR code. A aplicacao continua na Vercel. A sessao do WhatsApp e o agendador persistente ficam em um servidor externo. A infraestrutura esta em `infra/whatsapp` e o procedimento completo esta em `docs/WHATSAPP-CONTROLE.md`.

O bloqueio dentro da ferramenta funciona SEM WhatsApp, depois dos SQLs. Mensagens nao serao enviadas ate instalar/configurar o servidor externo, definir as variaveis na Vercel, conectar o numero e salvar a autorizacao. O instalador do ZIP nao contrata servidor nem cria contas externas.

## Seguranca e retorno

A carga financeira e as conferencias privadas ficam em `.private-finance/`, ignorada pelo Git. Nao use `git add -f` nessa pasta. O publicador inclui apenas os caminhos publicos do manifesto. Ele para se ja houver outros arquivos no staging.

O instalador registra a pasta do backup em `$HOME\.financeiro-backups`. Ela contem copias anteriores e `restore-manifest.json`. A carga SQL grava o antes/depois em `pf_private.control_import_backups`, sem acesso publico. Isso nao substitui um backup completo do Supabase. Uma reversao financeira exige verificar se houve movimentacao depois da carga: nao restaure um snapshot antigo por cima de novos pagamentos.

## Validacao

Foram executados neste pacote: verificacao TypeScript sem erros, 73 testes automatizados de regras auxiliares/validacoes, ESLint dos arquivos principais alterados sem erros (com avisos de codigo legado), validacao da sintaxe YAML e do script Bash e verificacao de sintaxe do worker Node.

Nao houve conexao com seu Supabase ou GitHub, execucao real dos SQLs no banco, deploy na Vercel ou pareamento/envio real por WhatsApp. Este ambiente nao dispunha de PostgreSQL nem do binario SWC adequado para executar o build completo; o instalador executa o build no seu computador antes de concluir. O arquivo de testes SQL exercita concessao/devolucao de emprestimo, conciliacao, idempotencia, fatura, pagamento, recorrencia, preservacao de parcelas pagas, bloqueio diario e autorizacao, com ROLLBACK. Os testes de infraestrutura/QR dependem do ambiente configurado.
