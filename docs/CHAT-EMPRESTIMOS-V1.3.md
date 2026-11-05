# Kyra — empréstimos recebidos no chat (1.3)

## O problema e a correção

O registro de 02/11/2026 mostrou a Groq respondendo HTTP 200, com 3.684 tokens e zero operações. O motivo não era conectividade, cota ou limite de contexto: o protocolo do Registrar proibia criar uma nova dívida. A resposta sugeria contornar com uma transferência, o que esconderia a obrigação.

A operação `borrow_money` agora representa um empréstimo novo tomado pela família, com devolução única. O agente recebe credor, conta bancária, valor recebido, dia, horário opcional e vencimento. O total a devolver é o informado pelo usuário ou, quando não há encargos informados, o valor recebido; essa premissa é declarada na prévia. Um total fixo maior que o recebido é aceito como valor contratado, sem inventar taxa ou capitalizar juros automaticamente.

A prévia mostra o credor, a conta, a entrada, o total a devolver e a data de devolução. Depois da confirmação, o servidor cria, na mesma transação:

1. uma dívida com o total contratado;
2. uma entrada `debt_received`, que credita a conta apenas pelo dinheiro efetivamente recebido;
3. uma obrigação futura vinculada à dívida, pelo total a devolver.

O trigger existente cria um único principal no histórico da dívida. A implementação NÃO chama `pf_register_debt_received` para o empréstimo recém-criado, pois essa função adicionaria outro principal à dívida. O recebimento fica ligado ao principal já criado.

Esse dinheiro é entrada de caixa e aumenta o passivo. Não é renda ganha. O cálculo do Consultor mantém a distinção. O dashboard anterior continua com seu layout original e seus indicadores de entradas/saídas.

Ao registrar posteriormente o pagamento da dívida, o fluxo existente de `debt_payment` reduz a dívida e encerra a obrigação prevista. O compromisso não vira uma segunda despesa realizada.

## Proteções

- Validação no servidor e novamente no PostgreSQL: conta da família, valor positivo em centavos, credor, vencimento não anterior ao recebimento e horário válido.
- Prévia não cria dívida nem movimentação financeira; exige confirmação explícita.
- Mesma confirmação retorna o recibo anterior, sem repetir crédito.
- Mesmo empréstimo descrito novamente em outro lote é recusado por possível duplicidade. Se houver realmente dois PIX iguais do mesmo credor na mesma conta e dia, é necessário esclarecer/reconciliar esse caso em vez de ignorar a proteção.
- Uma falha posterior no lote desfaz entrada, dívida, principal e obrigação juntos.
- Dados alterados após a prévia exigem nova análise.
- O agente diferencia empréstimo tomado (`borrow_money`) de devolução de dinheiro que a família emprestou a alguém (`loan_repayment`).
- Respostas antigas do histórico dizendo que a operação é impossível não têm prioridade sobre o contrato atual.

O suporte desta versão é para devolução única. Dívida sem recebimento de dinheiro, contratos com várias parcelas ou juros variáveis continuam exigindo fluxo específico. O agente não pode substituí-los por renda ou transferência fictícia.

## Instalação

Pare o localhost com Ctrl+C, extraia o ZIP e execute `Instalar.ps1` com `-Repositorio` apontando para `app-financeiro-dev-pf-v9` e `-Pacote` apontando para a pasta extraída. Não precisa de Git. O instalador preserva `.env.local`, dashboard e menu, faz backup e verifica testes e build.

A migration `20261102175551_borrow_money_chat.sql` redefine somente as duas funções privadas de validação/confirmação do lote existente. Não atualiza histórico, saldos, dívidas ou movimentações ao ser instalada. A interface e as permissões dos RPCs v2 existentes são preservadas.

O SQL isolado está em `03-emprestimos-chat.sql`. Na base conectada nesta conversa, a instalação é feita por esta atualização; não repita os SQLs 01/02 nem as migrations históricas. Em outra base, aplique primeiro as estruturas prévias 01/02 se faltarem e depois o 03. O instalador local não executa SQL no Supabase nem publica na Vercel.

Depois de instalar, recarregue o chat e envie novamente o relato do empréstimo. Confira conta, credor, valor e vencimento antes de confirmar. A atualização do software não registra automaticamente o empréstimo descrito no print.

## Rastreamento

O botão Detalhes da IA, o histórico de tokens/custos/ferramentas e a exportação opcional para Langfuse da versão 1.2 são mantidos. Veja `CHAT-RASTREAMENTO-V1.2.md` para configuração. Credores, valores e conteúdo do empréstimo não são enviados aos logs técnicos externos.

## Verificação

Testes em PostgreSQL temporário local cobrem saldo, dívida, principal único, previsão de devolução, quitação, valores fixos com encargos, rollback, repetição entre lotes, repetição dentro de lote, permissões e reaplicação da migration. O read model é testado com o mesmo formato JSON de datas que o Supabase retorna. Testes do modelo usam provedor simulado; não garantem que toda frase será interpretada corretamente. A prévia continua sendo necessária.
