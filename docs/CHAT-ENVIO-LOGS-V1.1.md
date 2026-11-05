# Chat Kyra: envio imediato e diagnostico

A mensagem sai do compositor antes de qualquer chamada de rede. O chat mostra a mensagem local, o estado de envio e o indicador da Kyra. Em falha de rede, a mensagem e mantida e a repeticao usa o mesmo identificador para recuperar o pedido sem duplicacao. O proximo rascunho digitado durante a resposta e preservado.

O Registrar continua na Groq e nao executa SQL livre. O contexto do modelo mantem contas e referencias financeiras, recupera ate 24 transacoes relevantes e informa a quantidade de historico omitido. As mensagens do pedido em aberto nunca sao truncadas. O servidor valida apenas as referencias enviadas e continua exigindo revisao e confirmacao.

O limite inicial estimado e 8000 tokens por requisicao, incluindo resposta e margem. KYRA_GROQ_REQUEST_TOKEN_BUDGET permite ajustar esse teto a franquia real da organizacao; a estimativa em bytes nao substitui o medidor do provedor. Pedidos que nao cabem sao recusados explicitamente, preservando o rascunho.

Falhas distinguem chave, permissao, modelo inexistente, contexto/tokens, cota, formato e resposta truncada. Os logs registram identificador do pedido, etapa, tempo acumulado, provedor/modelo, HTTP e codigo de erro. Nao gravam prompts, chaves nem comprovantes. O terminal recebe eventos JSON e a nova tabela pf_ai_diagnostics permite consultar e exportar os proprios eventos com RLS. Falha em salvar log nao interrompe uma operacao financeira.

Em Ajustes > IA, Diagnostico da IA permite testar conexao e o contrato JSON com dados ficticios, sem gerar movimentacoes. O chat oferece Ver diagnostico em respostas de erro. A migracao 20261102125137_chat_diagnostics_v1.sql cria somente a tabela tecnica e suas permissoes.

A falha original escondia a resposta da Groq. O HTTP/codigo daquela tentativa nao foi persistido e nao pode ser reconstituido. Esta versao corrige o contexto excessivo e permite identificar a causa de novas falhas. Chamada ao provedor real depende das chaves do localhost do usuario; as verificacoes automatizadas usam respostas simuladas, banco temporario e browser Chromium.
