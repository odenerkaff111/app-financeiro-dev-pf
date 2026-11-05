# Atualizacao incremental do dashboard - v4

## Escopo

Aplicar sobre o projeto que recebeu a atualizacao financeira anterior (v3).
Nao substitui o projeto inteiro: instala somente os arquivos do manifesto.
Nao instala, ativa nem reconfigura WhatsApp ou novos horarios de lembretes.

- Resumo consolidado inclui movimentos PF e PJ, sem duplicar transferencias.
- Saldo em contas, limite disponivel dos cartoes e investimentos sao separados.
- O total a receber inclui emprestimos em aberto. O valor com vencimento fora
  do periodo nao entra artificialmente na projecao daquele periodo.
- Resultado realizado e projecao das pendencias aparecem separados.
- Faturas entram uma vez, nao junto de seus itens ou do pagamento duplicado.
- Planejamento exige vinculo explicito; uma pendencia ja considerada nao
  reaparece como planejamento livre na mesma projecao.
- A aba Conciliacao deixa de existir. Atualizar saldo fica em Contas,
  reutilizando as funcoes auditadas ja existentes no banco.
- O endereco antigo /registros/conciliacao redireciona para /contas.
- Proximas obrigacoes continua exclusivamente na aba de Movimentacoes.

As unicas mudancas no componente do bloqueio diario sao de navegacao:
permitir /contas durante o registro e apontar o antigo botao de conferencia
para essa tela. Nao foram alteradas as regras, horarios ou integracoes.

## Antes de instalar

Feche as abas da ferramenta (local e publicada), pare npm run dev e abra o
PowerShell do VS Code na pasta que contem package.json. Mantenha um backup
do banco. O instalador nunca executa SQL e nao envia nada ao GitHub sozinho.
Nao rode novamente os SQLs 038, 039 ou 040 para instalar esta atualizacao.

O ZIP contem um manifesto com hashes e um instalador. A instalacao recusa
arquivos locais que diferem da base conhecida ou da propria v4, em vez de
sobrescrever edicoes desconhecidas. O backup do codigo fica fora do projeto,
em $HOME\.financeiro-backups. Arquivos de ambiente e .git nao sao substituidos.

## Instalacao

Depois de baixar atualizacao-dashboard-financeiro-v4.zip em Downloads,
execute na raiz do projeto:

```powershell
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath '.\package.json')) { throw 'Abra a pasta raiz do projeto.' }
$zip = Join-Path $HOME 'Downloads\atualizacao-dashboard-financeiro-v4.zip'
if (!(Test-Path -LiteralPath $zip)) { throw 'Baixe o ZIP em Downloads antes de continuar.' }
$destino = Join-Path $env:TEMP ('dashboard-v4-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $zip -DestinationPath $destino -Force
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $destino 'instalar-dashboard-v4.ps1') -ProjectPath (Get-Location).Path
if ($LASTEXITCODE -ne 0) { throw 'Instalacao interrompida. Confira a mensagem acima.' }
```

O instalador confere TypeScript, os testes anteriores, os novos testes e o
build no seu computador. Se uma verificacao falhar, restaura os arquivos de
codigo que acabou de substituir. Nao usa Force para ignorar edicoes locais.
Se faltar node_modules, executa npm ci com o lockfile existente; nao ha
bibliotecas novas nesta revisao. Node, npm e acesso aos pacotes devem estar
funcionando no computador.

## SQLs - uma consulta completa de cada vez

No SQL Editor do Supabase, papel postgres, execute nesta ordem:

1. .private-finance/043_TESTE_SEM_GRAVAR_v4.sql
   Executa a carga e as verificacoes numa transacao com ROLLBACK no fim.
2. .private-finance/043_atualizar_saldos_movimentacoes_v4.sql
   Aplica a carga incremental, com backup privado e chave contra duplicidade.
3. .private-finance/044_conferir_dashboard_v4.sql
   Apenas consulta os resultados. Nao grava nem corrige nada.

Pare se o teste ou a carga retornar erro. Nao apague as verificacoes para
forcar a aplicacao sobre uma base diferente. Nao execute apenas um trecho
interno do DO. Se houver sessao com transacao abortada, execute ROLLBACK;
sozinho antes de abrir outra consulta e repetir o arquivo completo.

A carga pressupoe que as novas movimentacoes relatadas ainda nao foram
registradas manualmente. Possiveis duplicatas ou dados posteriores provocam
interrupcao. Quando a chave da v4 ja estiver concluida, a repeticao nao altera
novamente os saldos. Nao e necessario alterar funcoes publicas do banco.

## Conferencia na ferramenta

Execute npm run dev. O saldo nao e a soma de limite de credito com dinheiro.
O recebimento empresarial continua na conta empresarial original e passa a
participar do fluxo consolidado, sem criar uma segunda receita.

Os saldos atuais informados sao fotografias independentes do resultado
historico. Diferencas que nao sejam explicadas pelas movimentacoes conhecidas
ficam na auditoria: nao viram despesas ou receitas inventadas. Um resgate
integral usa o valor registrado do cofrinho quando o valor exato do resgate
nao foi informado; isso e indicado nos metadados e nas notas do lancamento.

Uma alocacao de dinheiro ao cartao sem confirmacao de pagamento nao abate a
fatura automaticamente. O lancamento guarda essa pendencia de classificacao.
Nenhuma devolucao antiga, parcela, assinatura ou divida e reimportada.

## GitHub

Depois da conferencia, o publicador existente ja inclui os novos arquivos
publicos necessarios para nao quebrar imports no deploy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\publicar-atualizacao-financeiro.ps1
if ($LASTEXITCODE -ne 0) { throw 'Publicacao interrompida. Confira a mensagem acima.' }
```

Esse comando e opcional e deve ser executado somente quando for publicar.
Ele faz commit/push na branch atual. A pasta .private-finance permanece
ignorada e fora da lista de publicacao. Nao use git add -f nessa pasta.
Nao publique o ZIP inteiro: ele contem SQLs com dados financeiros privados.

## Validacao e limites

Nesta entrega: TypeScript sem erros; 33 testes novos de dashboard, 73 testes
existentes de controle e 15 verificacoes estaticas SQL aprovados.
A sintaxe/estrutura e as protecoes do novo SQL foram verificadas estaticamente.
Nao houve execucao de PostgreSQL ou conexao com o Supabase real neste ambiente.
O primeiro arquivo SQL fornece o teste transacional de integracao para o banco.

O build completo nao foi concluido neste ambiente: o codebase anexado traz
binarios nativos Windows e o ambiente Linux nao conseguiu baixar o compilador
SWC por falta de rede. O instalador tenta o build no computador do usuario.
O instalador PowerShell foi revisado como codigo, mas nao executado neste
ambiente Linux. Os testes nao substituem a conferencia visual apos instalar.
