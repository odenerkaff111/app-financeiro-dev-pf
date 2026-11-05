# Kyra - chat mobile com Registrar e Consultor

Implementação de 01/11/2026 a partir da base recuperada anterior ao pacote Família.
O código do dashboard `src/app/page.tsx` e do menu `src/components/AppDock.tsx` foi preservado byte a byte.

## O que foi implementado

- Tela própria de chat, logo existente, seletor de agentes, histórico privado por usuário e família, busca, título editável e arquivamento.
- Rascunhos por conversa/agente no aparelho, limpeza ao sair da sessão, paginação das mensagens mais recentes, preservação da instância do chat após uma atualização financeira e recuperação de pedidos repetidos.
- Compositor expansível, Enter como parágrafo no celular, envio por botão, rolagem de mensagens independente e ajuste por `visualViewport` para a área disponível do teclado.
- Registrar: preparação canônica de até 60 operações, esclarecimentos persistentes, correção por conversa, prévia com impacto por conta, confirmação transacional idempotente e recibo preservado.
- Consultor: conversa livre com contexto financeiro carregado no servidor, resposta em streaming e ferramentas de consulta, simulação de meta e comparação de compra. O agente não tem ferramentas de escrita financeira; encaminhamento para Registrar cria outra conversa e exige revisão.
- Seis componentes de resposta: contas, faturas, categorias/pizza, fluxo de caixa, progresso de meta e cenários. Os valores dos gráficos são calculados no servidor. Planos podem ser salvos e removidos sem alterar saldos.
- Câmera nativa via seletor de arquivo, galeria, JPG/PNG/WebP, PDF e OFX/CSV. Upload direto para bucket privado (até 8 MB e 5 anexos por pedido), nomes e hash conferidos no servidor. Fotos são redimensionadas e reexportadas como JPEG antes do upload.
- Fotos/PDF são interpretados pelo modelo de visão explicitamente configurado. OFX/CSV é lido como texto, sem truncamento silencioso. Anexo e relato passam juntos pela mesma prévia; nenhuma foto registra dados automaticamente.
- Novos controles em Ajustes > IA mostram a presença das configurações dos agentes e da leitura de anexos.

## Banco e instalação

O arquivo `01-atualizar-banco-chat.sql` contém, numa transação, somente a estrutura financeira v2 necessária ao protocolo do Registrar e a estrutura de conversas/anexos/planos do novo chat. Não contém despesas, receitas, redefinição de saldo nem exclusão do histórico existente.

A base conectada foi conferida em leitura: possuía faturas (044) e lotes v1 (043), mas não os rascunhos v2. O pacote inclui todas as migrations exigidas pelos testes locais; o instalador NÃO executa migrations históricas nem testes contra o Supabase real.

As políticas de conversa passam a ser privadas por criador e membro da família. As conversas antigas continuam armazenadas com seu criador e agente padrão Registrar. Arquivar uma conversa não apaga lançamentos.

No Windows: extraia o ZIP completo e execute `Instalar.ps1 -Repositorio "$env:USERPROFILE\app-financeiro-dev-pf-v9" -Iniciar`. A pasta pode ser uma instalação local sem Git. O script confere hashes e dependências, salva todos os arquivos anteriores que vai substituir, preserva `.env.local`, instala as dependências e roda os testes e o build. A pasta do backup é exibida.

Reversão dos arquivos: `Restaurar.ps1 -Repositorio "$env:USERPROFILE\app-financeiro-dev-pf-v9" -Backup` aceita a pasta de backup exibida pelo instalador. A reversão não remove as tabelas adicionais nem registros financeiros do Supabase.

## Modelos e variáveis do servidor

O Registrar usa as configurações já existentes: `GROQ_API_KEY`, `GROQ_BATCH_MODEL` e `KYRA_GROQ_ZDR_ACKNOWLEDGED=true`, após habilitar a retenção adequada no provedor. Não envie chaves ao chat nem ao Git.

O Consultor escolhe `KYRA_CHAT_PROVIDER` (groq ou openrouter). Sem essa variável, usa Groq se a chave e o aceite ZDR já estiverem presentes; caso contrário usa a configuração OpenRouter existente. Isso é escolha inicial de configuração, nunca fallback automático após falha. `KYRA_COACH_MODEL` é opcional; na sua ausência herda o modelo do provedor.

Para leitura de imagens e PDF, configure `KYRA_VISION_PROVIDER=openrouter`, `OPENROUTER_API_KEY` e `KYRA_VISION_MODEL` com um identificador de modelo que suporte as entradas desejadas. `KYRA_PDF_ENGINE` é opcional e usa `native` por padrão. Outros mecanismos de PDF, inclusive OCR pago, só são usados quando configurados explicitamente. O envio ao OpenRouter pede ausência de coleta e ZDR; se não houver provedor compatível o aplicativo mostra erro, sem trocar silenciosamente para outra rota.

Configurar uma chave não garante cota, disponibilidade ou precisão. As chamadas do provedor têm tempo e quantidade limitados, registram uso e respeitam o orçamento mensal configurado. Não existe promessa de API gratuita ilimitada.

## Validação e limites

- Cálculo financeiro, planos canônicos e integrações PostgreSQL foram testados em banco temporário local com dados fictícios.
- Foram testados streaming com fragmentos e comentários SSE, falha intermediária, resposta incompleta, cota, ausência de visão e exigência de ZDR usando provedor simulado.
- UI testada em Chromium real, com viewports 360/390/430/1280 e sessão/respostas fictícias; nenhuma gravação financeira real foi usada nos testes.
- Homologação com as chaves do usuário e aparelhos físicos iPhone/Android permanece necessária. O teste de viewport reduzido não reproduz sozinho todos os teclados e versões do Safari.
- HEIC não é convertido quando o navegador não consegue abri-lo: selecionar/exportar JPEG. O app informa os formatos aceitos em vez de prometer leitura.
- A leitura de comprovantes pode errar: origem da conta, parcelas, data ou item ilegível exigem esclarecimento. Lotes que excedem os limites pedem divisão; não são gravados parcialmente.
- Algumas operações complexas permanecem fora do protocolo financeiro existente, como criar uma nova conta/dívida e repartir um único pagamento entre várias dívidas. O agente deve explicar a limitação, sem fabricar despesas substitutas.
- Score/Serasa, pesquisa de preços em tempo real e execução de Pix/pagamentos bancários não foram adicionados. Registrar significa atualizar o controle financeiro depois que o fato ocorreu ou cadastrar previsão explícita.

## Arquitetura

`src/components/assistant/ChatWorkspace.tsx` contém o fluxo de interface; `ChatVisuals.tsx` renderiza somente componentes conhecidos e texto escapado. `chat.module.css` tem estilos restritos à área do chat. O shell global só muda seu comportamento na rota `/assistente`.

As rotas `/api/assistant/workspace` verificam sessão com `getUser`, membro da família e criador da conversa. `chat-consultor.ts` permite apenas três ferramentas de leitura/simulação. `chat-model.ts` controla modelos e streaming; `family-finance.ts` fornece cálculos em centavos e `family-operations.ts` valida o protocolo do Registrar. Não há executor de SQL gerado por IA nem chave de serviço no navegador.

`pf_chat_claim_turn` salva a mensagem e o pedido atomicamente, com uma única resposta ativa por conversa. `pf_chat_finish_turn` preserva o resultado e impede duplicar uma resposta. A confirmação financeira usa o protocolo de lotes, revalida o contexto e retorna o mesmo recibo quando repetida.

O usuário pode parar a transmissão da resposta. Isso não desfaz uma confirmação financeira enviada anteriormente. Uma queda de conexão exige consultar o estado ou repetir a mesma confirmação idempotente, nunca criar outro pagamento.


## Atualização 1.2

Correção do limite interno de contexto e detalhes da IA ao vivo e históricos, com exportação opcional para Langfuse Cloud/open source. Veja `CHAT-RASTREAMENTO-V1.2.md` para instalação, variáveis, privacidade, custos e limites.


## Atualização 1.3

O Registrar agora aceita empréstimo novo recebido com devolução única. A limitação anterior de criação de dívida foi removida para esse caso. Veja `CHAT-EMPRESTIMOS-V1.3.md`.


## Atualização 1.4

Fluxo por etapas reais, confirmação em tela inteira, prévia canônica, fallback de outro provedor e rastreamento completo da conversa. Veja `CHAT-FLUXO-V1.4.md`.
