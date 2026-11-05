# WhatsApp por QR code e agendamento persistente

## Arquitetura entregue

Vercel hospeda a interface e os endpoints autenticados. Supabase guarda configuracoes, revisoes do dia e deduplicacao de envios. Evolution API 2.3.7 mantem a sessao do WhatsApp em um servidor Linux com Docker. Um worker Node consulta o endpoint protegido da aplicacao a cada minuto; somente os horarios configurados pelo usuario podem gerar mensagem.

A imagem oficial da Evolution foi fixada por versao e digest no Compose. Nao e usado um contenedor temporario da Vercel para manter o WhatsApp conectado. O Cron do plano Hobby permite apenas uma execucao diaria por cron e nao garante o minuto exato; por isso nao foi usado para a agenda configuravel.

Referencias tecnicas consultadas em 16/09/2026:
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/dto/sendMessage.dto.ts
- https://github.com/evolution-foundation/evolution-api/blob/main/Docker/swarm/evolution_api_v2.yaml
- https://hub.docker.com/layers/evoapicloud/evolution-api/v2.3.7/images/sha256-0e5d84f45b390e1d659500c9a98bfa2a53be28a341fbc0864966b77485f2a0c5

## Antes de instalar

Use um servidor Linux publico com Docker Engine e o plugin Docker Compose instalados. Sao necessarios um dominio/subdominio com DNS apontado para esse servidor e portas 80/443 livres para TLS. Nao ha obrigacao de mudar o plano da Vercel para usar este pacote. O servidor externo pode ter custo proprio; nada e contratado automaticamente.

A conexao usa WhatsApp/Baileys, nao a API oficial da Meta. Ela pode cair ou exigir novo QR code e nao tem garantia de disponibilidade do WhatsApp. Use apenas seu numero autorizado. A sessao conectada da acesso ao WhatsApp desse aparelho: mantenha o servidor, os volumes e as chaves privados. Nao publique o banco da Evolution na internet.

## Copiar e iniciar

No PowerShell do computador, na raiz do projeto, informe o acesso SSH real quando solicitado:

```powershell
$destino = Read-Host 'Digite o usuario e endereco SSH do seu servidor'
scp -r .\infra\whatsapp "${destino}:~/financeiro-whatsapp"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar a infraestrutura.' }
ssh $destino 'cd ~/financeiro-whatsapp && bash setup.sh'
```

O `setup.sh` pergunta o dominio da Evolution, e-mail do certificado e URL HTTPS publica da ferramenta. Gera automaticamente senhas fortes e os arquivos privados `.env` e `vercel-secrets.txt`, com permissao restrita. Nao substitui senhas de uma instalacao existente. Inicia PostgreSQL, Redis, Evolution, Caddy e o worker.

Caso Docker ou Compose nao estejam instalados, o script para sem tentar instalar pacotes do sistema. Instale-os pelo procedimento oficial da distribuicao/servidor e execute novamente.

## Configurar Vercel

Abra `vercel-secrets.txt` no servidor e copie as quatro variaveis para Settings / Environment Variables do projeto Vercel, no ambiente Production:

- `APP_PUBLIC_URL`: URL publica HTTPS da ferramenta, gerada a partir da sua resposta ao instalador.
- `EVOLUTION_API_URL`: endereco HTTPS da Evolution.
- `EVOLUTION_API_KEY`: chave privada gerada pelo instalador.
- `REMINDER_DISPATCH_SECRET`: segredo privado do agendador, igual ao configurado no worker.

A aplicacao tambem precisa das variaveis Supabase ja utilizadas no projeto: `NEXT_PUBLIC_SUPABASE_URL`, chave publica configurada pelo aplicativo e `SUPABASE_SECRET_KEY` (ou o nome legado `SUPABASE_SERVICE_ROLE_KEY`) SOMENTE no servidor. Nao adicione prefixo `NEXT_PUBLIC_` a chaves privadas.

Faca um novo deploy depois de salvar o ambiente. Nao compartilhe `vercel-secrets.txt` no chat ou no GitHub. Em desenvolvimento local, as variaveis privadas devem ficar no `.env.local`, que o instalador preserva.

## Conectar e testar

Na ferramenta: Configuracoes / Lembretes e WhatsApp. Escolha os horarios, informe seu telefone com pais e DDD, habilite WhatsApp e salve sua autorizacao. Clique Gerar / atualizar QR code. No telefone: WhatsApp / Aparelhos conectados / Conectar aparelho. Depois que aparecer conectado, clique Enviar lembrete de teste.

Configure um proximo horario dentro de 08:00-22:00. Para testar envio automatico, deixe a conferencia desse horario pendente. O worker aceita uma janela de cinco minutos; se o servidor estiver offline, nao envia uma enxurrada de horarios atrasados na volta. Uma confirmacao concluida depois do horario dispensa o lembrete daquele horario.

O painel mostra historico de envios. `sent` significa aceito pela API com identificador de mensagem; nao significa que o destinatario leu. `unknown` nao e reenviado automaticamente, pois a mensagem pode ter sido aceita antes de uma falha de resposta. Falhas de conexao precisam ser verificadas antes de novo teste.

## Operacao

No servidor, dentro de `~/financeiro-whatsapp`:

```bash
docker compose --env-file .env -f compose.yaml ps
docker compose --env-file .env -f compose.yaml logs --tail=100 worker evolution caddy
```

Para parar sem apagar os dados:

```bash
docker compose --env-file .env -f compose.yaml stop
```

Para retomar:

```bash
docker compose --env-file .env -f compose.yaml up -d
```

Nao use `down -v` para reiniciar: isso apaga volumes e pode perder a sessao. Mantenha backup privado dos volumes e `.env`. Nunca atualize automaticamente a versao da Evolution sem testar o contrato de QR e envio.

Nao ha credenciais de servidor embutidas no ZIP. O fluxo foi implementado, mas nao foi pareado ou enviado no seu ambiente durante a preparacao deste pacote.
