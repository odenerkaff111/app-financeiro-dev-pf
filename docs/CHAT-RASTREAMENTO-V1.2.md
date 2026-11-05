# Kyra — chat e rastreamento 1.2 (02/11/2026)

## Correção do bloqueio

O erro `prepare_failed / model_context` ocorria no limite interno de 8.000 tokens, antes de chamar a Groq. O contexto do Registrar foi compactado em listas com colunas nomeadas. Indicadores de dashboard não são enviados para planejar lançamentos. Contas, categorias, faturas, dívidas e demais referências essenciais permanecem; o histórico de transações é selecionado por relevância e sua omissão é informada. Todas as mensagens do rascunho em aberto são preservadas. Não há aumento silencioso de orçamento nem troca de provedor.

O limite continua protegendo pedidos excessivos. Agora a mensagem identifica explicitamente bloqueio interno e informa que a Groq não foi chamada. Respostas cortadas pelo provedor nunca viram lote parcial. O modelo prepara JSON canônico; o servidor valida e somente a confirmação do usuário permite a gravação financeira.

Nota histórica da versão 1.2, superada pela 1.3: criar uma nova dívida/empréstimo recebido ficava fora do protocolo. A versão 1.3 suporta recebimento com devolução única; veja `CHAT-EMPRESTIMOS-V1.3.md`. Por exemplo, receber dinheiro emprestado da mãe não pode ser lançado como renda comum: o agente deve explicar a limitação e pedir orientação, mantendo o lote sem execução. A melhoria de contexto não amplia as operações financeiras autorizadas.

## Como ver o que a IA fez

No chat, toque no pequeno ícone de atividade (“Detalhes da IA”), próximo a copiar a resposta. Ele também aparece abaixo da resposta em andamento, antes de a IA concluir. O painel consulta automaticamente as etapas a cada 1,5 segundo enquanto estiver aberto e o pedido estiver ativo (limite de 125 segundos). Fechar o painel ou concluir a análise encerra a atualização automática; “Atualizar” permite consultar novamente. Sem streaming de logs externo: a visualização nativa consulta o Supabase autenticado.

O painel mostra:

- modelo solicitado e modelo efetivamente servido, quando informado;
- número de chamadas à LLM, tokens reais de entrada, saída e total;
- custo informado pelo provedor, quando disponível, separado da estimativa por tabela;
- duração da análise e da confirmação, separadamente;
- ferramentas realmente acionadas pela LLM, com resultado e duração;
- rotinas do servidor, inclusive consulta de contexto, validação, prévia e confirmação;
- distinção entre prévia preparada e movimentações confirmadas;
- etapas técnicas recolhidas e exportação em JSON.

Chamadas de imagem/PDF, Registrar e cada rodada do Consultor são contabilizadas. Tokens de raciocínio/cache são subconjuntos e não são somados duas vezes. Consumo ausente aparece como parcial; custo ausente não vira zero. Preço de tabela não comprova cobrança nem gratuidade. A tabela local para Groq GPT-OSS 120B e 20B foi conferida em 02/11/2026. Se quiser declarar que sua conta Groq está no plano gratuito, use `KYRA_GROQ_BILLING_MODE=free`; a interface identifica que é uma configuração declarada, não uma verificação na conta.

Os logs novos são persistidos durante a execução, em lotes curtos serializados; o final do pedido aguarda os lotes pendentes. Falha de telemetria não transforma uma movimentação em erro nem dispara repetição financeira. Falhas de persistência também são registradas no terminal. Não é possível reconstruir retroativamente tokens e custos que uma versão anterior não registrou.

## Langfuse Cloud ou open source (opcional)

A visualização acima funciona sem conta Langfuse. Há também integração real, no servidor, com a API OpenTelemetry OTLP/HTTP JSON. Não usa a API antiga de ingestão, descontinuada no Langfuse v4. Exporta spans completos, com IDs estáveis, parentesco, uso e custo disponível, usando o header `x-langfuse-ingestion-version: 4`.

Para habilitar o envio ao Langfuse, crie um projeto nele, obtenha as chaves em Settings > API Keys e acrescente ao `.env.local` na raiz do projeto:

```dotenv
LANGFUSE_PUBLIC_KEY=pk-lf-SUBSTITUA_PELA_CHAVE_PUBLICA
LANGFUSE_SECRET_KEY=sk-lf-SUBSTITUA_PELA_CHAVE_SECRETA
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

Reinicie o localhost após configurar. Para a região dos EUA, use `https://us.cloud.langfuse.com`. Para uma instalação open source com endpoint OTLP (>=3.22), use a URL base da sua instalação. Prefira HTTPS; HTTP é permitido para instalação local. Informe a URL base, sem `/api/public/otel`, sem parâmetros ou credenciais na URL. Chaves ficam apenas no servidor; nunca use prefixo `NEXT_PUBLIC_`, nunca publique `.env.local` nem envie chaves pelo chat. Na Vercel, cadastre essas três variáveis no ambiente correspondente e faça um novo deploy.

O envio tem timeout curto e não bloqueia a análise caso o Langfuse esteja fora do ar. O estado de exportação aparece nas etapas e no terminal. Os logs nativos permanecem independentes. A integração externa é de melhor esforço, sem fila durável de reenvio: indisponibilidade prolongada pode deixar lacunas no Langfuse, sem perder os eventos já salvos no Supabase. Não foi testada uma conexão com conta Langfuse real do usuário; transporte e formato foram testados com respostas simuladas.

Somente metadados técnicos são enviados: não são exportados texto da conversa, comprovantes, dados bancários, valores dos lançamentos, argumentos/resultados de ferramentas ou identidades de usuários. O custo estimado fica em metadados separados do custo informado. O Langfuse pode calcular suas próprias estimativas a partir do modelo e uso recebidos.

Referências oficiais consultadas:
- https://langfuse.com/integrations/native/opentelemetry
- https://langfuse.com/integrations/native/opentelemetry/migration-to-v4
- https://langfuse.com/docs/observability/features/token-and-cost-tracking
- https://console.groq.com/docs/models

## Instalação e validação

Pare o localhost (Ctrl+C), extraia o ZIP inteiro e rode o instalador apontando para `app-financeiro-dev-pf-v9`. Git não é necessário. O instalador preserva `.env.local`, dashboard e menu existentes; cria backup, confere hashes, executa os testes locais e compila antes de iniciar.

Nenhuma migration nova foi adicionada nesta versão. A tabela `pf_ai_diagnostics`, já instalada na base conectada, é reutilizada. Os SQLs 01 e 02 seguem no pacote para instalações que ainda não tenham a estrutura. Não execute as migrations históricas no Supabase de produção. O instalador não envia SQL ao Supabase nem publica na Vercel.

Os testes usam banco PostgreSQL temporário local, sessões fictícias e provedores simulados. A validação de UI usa Chromium em 360, 390, 430 e 1280 pixels. Não substitui o teste final com a chave/cota real e celulares físicos. Nenhuma movimentação financeira do usuário é executada para testar.
