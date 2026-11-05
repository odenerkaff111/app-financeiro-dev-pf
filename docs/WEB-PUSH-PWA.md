# PWA + Web Push no iPhone

## Arquitetura

A interface continua na Vercel. O navegador/PWA cria uma assinatura Web Push vinculada a uma chave VAPID e o servidor guarda o endpoint e as chaves de entrega em `pf_push_subscriptions`, sem conceder leitura direta dessa tabela ao cliente.

O Supabase Cron verifica a agenda a cada minuto no proprio banco e so chama `/api/reminders/push-dispatch` quando existe um horario de push realmente pendente. O endpoint usa a agenda ja existente em `pf_reminder_settings` e a confirmacao diaria de `pf_daily_checks`. Se a conferencia daquele horario ja foi concluida, nada e enviado. Cada assinatura/dia/horario possui chave unica no outbox para impedir duplicidade.

Nao existe cache offline de dados financeiros no Service Worker. Ele serve apenas para receber notificacoes, abrir `/registros` e controlar o badge do icone.

## iPhone

Web Push no iPhone exige iOS/iPadOS 16.4 ou superior e um web app adicionado a Tela de Inicio. A permissao so pode ser pedida depois de uma acao direta do usuario; por isso a tela de configuracoes possui o botao **Ativar notificacoes neste dispositivo**.

Se o atalho atual foi criado antes de existir o manifesto PWA, remova o atalho depois do deploy e adicione a ferramenta novamente por Safari > Compartilhar > Adicionar a Tela de Inicio.

## Ordem de instalacao

1. Instale o ZIP de atualizacao no codebase.
2. Execute `supabase/migrations/040_web_push_pwa.sql` no SQL Editor.
3. Execute `supabase/tests/040_web_push_pwa_smoke.sql`; ele termina com `ROLLBACK` e deve retornar `TESTE_OK_WEB_PUSH_ROLLBACK_SEM_GRAVAR`.
4. Rode `node tools/preparar-web-push.mjs` na raiz do projeto e informe a URL HTTPS de producao.
5. Copie as quatro variaveis de `.push-private/vercel-web-push.env.txt` para Vercel > Settings > Environment Variables > Production. Nunca use prefixo `NEXT_PUBLIC_` para a chave privada ou para o segredo de despacho.
6. Ative Supabase Cron (`pg_cron`) e `pg_net` no Dashboard caso ainda estejam desligados.
7. Execute `.push-private/041_configurar_agendamento_web_push.sql` no SQL Editor. Ele guarda URL e segredo no Supabase Vault e agenda uma verificacao por minuto; a chamada HTTPS so acontece quando ha um lembrete pendente.
8. Publique a versao atualizada na Vercel.
9. No iPhone, abra a versao da Tela de Inicio, entre em Configuracoes > Lembretes e WhatsApp e toque em **Ativar notificacoes neste dispositivo**.
10. Use **Enviar notificacao de teste** e confirme que ela chegou com a ferramenta fechada.

## Variaveis de servidor

- `APP_PUBLIC_URL`: URL HTTPS publicada da ferramenta.
- `VAPID_PUBLIC_KEY`: chave publica usada ao criar a assinatura no navegador.
- `VAPID_PRIVATE_KEY`: chave privada usada apenas no servidor para VAPID.
- `PUSH_DISPATCH_SECRET`: autentica a chamada Supabase Cron -> Vercel.

A chave VAPID nao deve ser rotacionada normalmente. Assinaturas existentes sao vinculadas a ela e precisariam ser recriadas se a chave mudasse.

## Operacao

O agendador usa uma janela de cinco minutos para cada horario. Se ficar desligado por horas, nao envia uma rajada de lembretes atrasados quando voltar. Push endpoints que retornarem 404/410 sao marcados como inativos. Resultado de rede desconhecido nao e reenviado automaticamente para reduzir risco de duplicidade.

O historico de envio fica em `pf_push_outbox`. A tela mostra os ultimos envios automaticos sem expor endpoints ou chaves de assinatura.
