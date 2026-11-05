# Kyra — fluxo do chat e rastreamento da conversa (1.4)

Atualização de 02/11/2026. Dashboard e menu existentes preservados.

## O que mudou na conversa

A preparação informa etapas reais: envio, recebimento, leitura de anexo quando houver, consulta de contas, interpretação, validação e montagem da revisão. Não há temporizador simulando processamento concluído. O anexo tem etapas próprias de conferência, envio e salvamento.

A confirmação abre um loading em tela inteira, com etapas transmitidas pelo servidor: conferir confirmação, registrar movimentações e atualizar o financeiro. O overlay fecha após a confirmação efetiva. Enquanto o registro está sendo feito, Escape não fecha a tela; há trava contra duplo toque. Em erro ou queda de rede, a tela encerra o loading e permite verificar usando o mesmo lote idempotente.

A prévia foi redesenhada com campos separados, credor, valor recebido, total a devolver, recebimento com horário e vencimento. O texto livre da IA não é repetido acima da caixa. O recibo exibido é baseado nos campos validados pelo servidor, sem nomes internos como borrow_money ou A8, nem afirmação prematura de que foi registrado. Copiar a resposta também usa o resumo canônico e distingue prévia de registro confirmado.

O relato que dizia “hoje” e “2/11/2016” não deve ser convertido silenciosamente em 2026. Datas impossíveis, anteriores ao período permitido ou conflitantes com “hoje” pedem esclarecimento, preservando o rascunho e sem chamar o modelo. A atualização não corrige nem relança o empréstimo já confirmado pelo usuário.

## Dois agentes e as responsabilidades

Interface Next.js/React → API autenticada → contexto financeiro no Supabase → LLM → validação no servidor → prévia → confirmação humana → RPC transacional no PostgreSQL.

Registrar interpreta e propõe JSON canônico. Não escreve SQL arbitrário e não decide os UUIDs das contas. O servidor resolve as referências e revalida antes de preparar o lote. A confirmação confere usuário, conversa, lote e versões; uma única RPC aplica tudo atomicamente e guarda recibo idempotente.

Consultor usa o mesmo retrato financeiro e ferramentas de consulta/simulação. Não tem ferramenta de gravação financeira. Fotos/PDF continuam dependendo do modelo de visão configurado. O fallback textual não envia imagens para um modelo incompatível.

## Provedor alternativo

Principal: Groq, openai/gpt-oss-120b (ou o modelo Groq explicitamente configurado).

Alternativa padrão: OpenRouter → nvidia/nemotron-3.5-super-vl:free. O catálogo público consultado confirma uma rota Nvidia com JSON Schema/structured_outputs e ferramentas. O modelo foi escolhido como alternativa de análise; não há garantia de interpretação perfeita nem teste financeiro real de qualidade com a chave do usuário.

Para habilitar, configure OPENROUTER_API_KEY com sua chave real no .env.local do projeto e reinicie. Se ela já estiver presente, o fallback fica disponível automaticamente. Ajustes > IA mostra o estado e permite testar o fallback com dados fictícios. Nunca envie a chave no chat nem use prefixo NEXT_PUBLIC_.

Variáveis opcionais do servidor:

- KYRA_AI_FALLBACK=off desliga o fallback.
- KYRA_FALLBACK_MODEL escolhe outro ID explícito. Sem aceite de modelo pago, só aceita IDs terminados em :free.
- KYRA_FALLBACK_ALLOW_PAID=true é aceite explícito do operador para modelos pagos; o pacote não define essa opção nem altera o orçamento existente.
- KYRA_FALLBACK_REQUIRE_ZDR=true exige ZDR na rota alternativa e pode reduzir a disponibilidade.

A rota gratuita tem teto de preço zero para entrada e saída e exclui Groq para evitar retornar ao mesmo provedor. Solicita data_collection=deny. Isso não comprova ZDR: a exigência adicional é opcional na rota alternativa; a configuração Groq e a rota de visão mantêm seus controles anteriores. Se não houver endpoint compatível com as restrições e a cota da conta, a análise falha de forma explícita.

Há no máximo uma tentativa alternativa após erro de rede, timeout, 408, 429, indisponibilidade 5xx ou modelo 404. Não há fallback em cancelamento do usuário, falha de validação financeira, erro 400/401/403 de configuração, após mostrar resposta parcial ou durante confirmação no Supabase. As duas tentativas ficam na trace e no consumo acumulado. Nenhuma tentativa alternativa grava movimentações sem revisão e confirmação.

## Traces individuais e conversa inteira

Ícone de atividade no cabeçalho → Conversa completa. Ícone ao lado de cada resposta → Mensagem. As abas permitem navegar entre as duas visões; clicar numa mensagem da lista abre sua trace.

A visão completa carrega páginas cronológicas, soma as chamadas e permite exportar JSON. Há limite inicial de 200 mensagens por carregamento; “Carregar restante” amplia o limite. Quando existem páginas ou eventos ausentes, o resumo e a exportação são marcados como parciais; nunca são apresentados como história completa. Não há reconstrução dos tokens que uma versão antiga não registrou. O download da conversa exclui os rótulos com texto livre e preserva dados técnicos e IDs de correlação.

A versão compacta mostra duração, tokens de entrada com custo abaixo, tokens de saída com custo abaixo, tokens totais, custo da mensagem ou conversa e modelos. Ferramentas acionadas pela LLM só aparecem se houver chamadas. As rotinas do servidor permanecem nas etapas técnicas recolhidas, junto da confirmação e das demais fases.

A tela é privada por usuário e família. Consulta exige autenticação e propriedade da conversa; os logs existentes continuam com RLS. Abrir o painel consulta as etapas automaticamente enquanto o pedido está em andamento. Datas e horários exibidos usam America/Sao_Paulo.

## Custos e atualização das tarifas

Custos informados pelo provedor têm prioridade. Quando a API informa só o total cobrado, a ferramenta mostra esse total e não inventa o rateio por entrada/saída. Custo zero informado ou declarado no servidor permanece zero.

Para Groq, sem custo informado pela API, usa estimativa por tokens de entrada e saída, incluindo desconto de cache quando a tarifa correspondente está disponível. Consulta a cotação pública da rota Groq no OpenRouter, com cache de 15 minutos. Essa cotação é uma estimativa de rota, não comprovação da fatura da API direta. Se a consulta estiver indisponível, usa a tabela oficial arquivada e identificada de 02/11/2026 para os modelos conhecidos. Nome, fonte, data e tarifas ficam no evento de cada chamada.

Chamadas de outro modelo sem preço conhecido permanecem com custo indisponível. A rota gratuita alternativa também consulta seu endpoint público; a resposta de uso/custo continua sendo a fonte preferida. O pacote não pode descobrir automaticamente se sua conta Groq é gratuita. KYRA_GROQ_BILLING_MODE=free identifica gratuidade declarada por você, sem fingir consulta à cobrança do provedor.

O total inclui todas as tentativas e rodadas do modelo por mensagem. Cache e raciocínio não são somados duas vezes aos tokens. Chamadas sem consumo informado deixam o total parcial. Valores em USD são guardados sem arredondar prematuramente; a tela formata até 9 casas decimais e o JSON mantém a precisão do registro. Tarifas históricas ficam vinculadas às chamadas, sem reprecificar o passado como se fosse uma cobrança atual.

Portanto, o custo é auditável e atualizado conforme as fontes disponíveis, mas não há promessa de cobrança exata quando a API não a informa. A interface identifica “Estimado”, “Parcial” ou custo informado/configurado.

## Langfuse

O rastreamento visível continua sendo nativo da Kyra, persistido no Supabase. No print enviado, Langfuse externo não estava configurado. O pacote mantém o exportador OTLP/HTTP compatível com Langfuse Cloud/open source; não cria conta nem inclui credenciais.

Para ativar envio externo, configure LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY e LANGFUSE_BASE_URL com os valores do seu projeto Langfuse e reinicie. A URL base padrão é https://cloud.langfuse.com; para instalação própria, use a URL base dela. As chaves ficam apenas no servidor.

Cada mensagem é uma trace; as mensagens da mesma conversa compartilham uma sessão técnica no Langfuse. A confirmação fica correlacionada à análise. Só são exportados metadados técnicos, sem texto financeiro, anexos, credores, valores de lançamentos ou argumentos/resultados de ferramentas. O envio é de melhor esforço, com timeout; falha externa não interrompe o financeiro. Não houve teste de uma conta Langfuse real do usuário.

## Instalação e verificação

Pare o localhost (Ctrl+C), extraia o ZIP inteiro e execute Instalar.ps1 apontando para app-financeiro-dev-pf-v9 e para a pasta extraída do pacote. Não exige Git; preserva .env.local, dashboard e menu, cria backup e executa testes e build antes de iniciar.

Esta versão não exige SQL novo. Reutiliza o banco já instalado. Os SQLs 01/02/03 são mantidos para recuperação de instalações antigas e não devem ser repetidos na base conectada nesta conversa. O instalador não publica na Vercel.

Testes usam PostgreSQL temporário local, sessões fictícias, provedores simulados e Chromium em 360/390/430/1280 pixels. Não substituem a verificação com sua cota/chave e celulares físicos. Não executam lançamentos financeiros reais.

Fontes oficiais consultadas: https://openrouter.ai/api/v1/models/nvidia/nemotron-3.5-super-vl:free/endpoints ; https://openrouter.ai/docs/guides/routing/provider-selection ; https://console.groq.com/docs/model/openai/gpt-oss-120b ; https://console.groq.com/docs/model/openai/gpt-oss-20b ; https://langfuse.com/integrations/native/opentelemetry
