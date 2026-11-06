# Kyra · visual completo v3.0

O sistema usa superfícies brancas, fundo cinza suave, texto azul escuro e assinatura dourada do Grupo Umsó. Violeta e verde permanecem nos gráficos e indicadores do dashboard. A logo original não foi editada.

## Escopo

A atualização padroniza tipografia, cartões, campos, botões, abas, tabelas e janelas por meio do tema global. As telas ativas de contas, movimentações, obrigações, recorrências, parcelamentos, planejamentos, dívidas, valores a receber, configurações e autenticação preservam seus campos e operações. Redirecionamentos de rotas legadas são preservados.

O menu principal é preservado, inclusive o arquivo `AppDock.tsx`. No celular, permanece fixo no rodapé, com as mesmas seis opções. Ele também fica acessível no chat, com espaço reservado para que não cubra o compositor.

## Chat

- Histórico em painel lateral e busca, com apresentação compacta e abertura inicial em telas grandes.
- Barra de seleção direta entre Registrar e Consultor. Cada agente mantém seu histórico e seus rascunhos.
- Boas-vindas e sugestões por contexto, sem envio automático ao selecionar uma sugestão.
- Mensagens, prévias, saldos antes/depois, confirmação, anexos, erros e progresso usando o mesmo padrão visual branco e dourado.
- Campo de mensagem responsivo, com espaço reservado para o menu inferior em tela pequena.

As rotinas de envio, anexos, idempotência, recuperação, confirmação, cancelamento, encaminhamento entre agentes, cópia e planos salvos foram preservadas. Não há mudanças em endpoints, modelos de IA, prompts, limites ou operações do servidor.

## Correção do dashboard

Lançamentos históricos pagos sem conta bancária vinculada eram omitidos no modelo de fluxo utilizado pelo gráfico anual. O modelo do dashboard agora reconhece esses registros por sua natureza, estado e data de pagamento. A ausência de conta ou a marca `skip_balance_update` não apaga um pagamento do histórico. Isso não modifica os saldos conciliados.

Itens de cartão continuam representados pelo pagamento único da fatura no fluxo; transferências internas e alocações ao limite ainda sem classificação de pagamento não entram como faturas pagas. Empréstimos recebidos entram no caixa sem virar renda de serviço. Cancelados e previsões não são apresentados como realizados.

O gráfico mantém somente as barras e sua legenda. O detalhamento ao apontar para uma barra separa realizado e previsto. Ajustes históricos já marcados como estimados são identificados; a atualização não cria novos ajustes nem tenta completar a diferença entre saldos e despesas.

## Instalação

O ZIP contém os arquivos do dashboard v2 necessários para funcionar com a base v9/v1.4, além do tema e do chat atualizados. Não é necessário reinstalar o pacote de dashboard anterior. O instalador aceita versões conhecidas e a própria versão nova, confere integridade, cria backup e restaura fontes se os testes ou build falharem. Alterações desconhecidas interrompem a cópia.

Não altera `.env`, `.git`, dependências, `next.config.ts`, autenticação, permissões ou SQL. Não há nova migração. Os dados financeiros usados na conferência não fazem parte dos fontes instalados ou do commit Git.

`Atualizar-Git.ps1` é uma etapa separada e explícita: prepara somente os arquivos do manifesto, cria um commit e faz push para o repositório informado na conversa. Não usa push forçado. Se a pasta veio de um ZIP e ainda não possui Git, inicializa o controle a partir da branch principal remota, preservando os arquivos da pasta. Mudanças locais fora da atualização permanecem fora do commit.

## Validação

Os testes financeiros incluem o histórico sem conta, os centavos, o fuso do Brasil, a separação realizado/previsto, os itens de fatura e a preservação do saldo atual. As rotinas existentes do chat são verificadas com provedores simulados. TypeScript e build de produção são conferidos. A prévia de interface utiliza exclusivamente dados sintéticos; não grava movimentações na base do usuário.
