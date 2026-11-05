#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
for command in docker openssl; do
  command -v "$command" >/dev/null || { echo "Instale $command antes de continuar." >&2; exit 1; }
done
docker compose version >/dev/null
if [[ -f .env ]]; then
  echo "Configuracao existente preservada."
else
  read -r -p "Dominio publico da Evolution, sem https:// (DNS ja deve apontar para este servidor): " domain
  read -r -p "E-mail para o certificado TLS: " email
  read -r -p "URL HTTPS de producao da ferramenta na Vercel: " app
  [[ "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || { echo "Dominio invalido."; exit 1; }
  [[ "$email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || { echo "E-mail invalido."; exit 1; }
  [[ "$app" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$ ]] || { echo "Informe somente a origem HTTPS, sem caminho ou parametros."; exit 1; }
  api_key=$(openssl rand -hex 32)
  dispatch_key=$(openssl rand -hex 32)
  db_password=$(openssl rand -hex 24)
  redis_password=$(openssl rand -hex 24)
  printf 'EVOLUTION_DOMAIN=%s\nTLS_EMAIL=%s\nAPP_PUBLIC_URL=%s\nEVOLUTION_API_KEY=%s\nREMINDER_DISPATCH_SECRET=%s\nPOSTGRES_PASSWORD=%s\nREDIS_PASSWORD=%s\n' "$domain" "$email" "${app%/}" "$api_key" "$dispatch_key" "$db_password" "$redis_password" > .env
  printf 'APP_PUBLIC_URL=%s\nEVOLUTION_API_URL=https://%s\nEVOLUTION_API_KEY=%s\nREMINDER_DISPATCH_SECRET=%s\n' "${app%/}" "$domain" "$api_key" "$dispatch_key" > vercel-secrets.txt
  chmod 600 .env vercel-secrets.txt
fi
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml up -d
printf '\nInfraestrutura iniciada. Copie as quatro variaveis de vercel-secrets.txt para a Vercel (ambiente Production) e faca novo deploy.\n'
printf 'Nao compartilhe .env, vercel-secrets.txt, QR codes ou volumes. O arquivo contem suas chaves privadas.\n'
printf 'Depois abra Configuracoes / Lembretes e WhatsApp, salve numero/autorizacao, conecte o QR e envie o teste.\n'
