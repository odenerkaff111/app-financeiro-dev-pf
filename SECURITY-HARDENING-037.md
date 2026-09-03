# Kyra - hardening 037

## O que esta atualizacao faz automaticamente

- Mantem RLS habilitado em todas as tabelas `pf_*`.
- Remove acesso do papel `anon` ao schema financeiro `public`.
- Remove privilegios anonimos de tabelas e sequencias financeiras.
- Faz novos objetos nascerem fechados por padrao; RPCs publicas devem conceder acesso explicitamente a `authenticated`.
- Adiciona headers HTTP de seguranca no Next.js/Vercel.
- Bloqueia edicao isolada de uma parcela e cria a aba Parcelamentos para ajustar o grupo inteiro.
- Corrige grupos com duas parcelas no mesmo mes, usando a parcela 1 como origem do cronograma.

## Configuracao obrigatoria no Supabase Dashboard

A configuracao abaixo nao e SQL e precisa ser feita no projeto hospedado:

1. Authentication -> General Configuration
   - Allow new users to sign up: OFF
   - Allow anonymous sign-ins: OFF
2. Authentication -> Providers -> Email
   - mantenha login por e-mail/senha
   - Confirm email: ON
3. Authentication -> URL Configuration
   - Site URL: somente a URL oficial da Vercel
   - Redirect URLs: use URLs exatas da aplicacao; evite curingas em producao
4. Authentication -> Attack Protection / Rate Limits
   - mantenha protecoes e limites habilitados
5. Revise usuarios em Authentication -> Users e remova contas desconhecidas.

Com signup desligado, novos usuarios devem ser criados somente por convite administrativo. O Kyra ja usa `auth.admin.inviteUserByEmail()` no servidor para esse fluxo.

## GitHub e Vercel

- Torne o repositorio `odenerkaff111/app-financeiro-dev-pf` PRIVATE.
- Nunca coloque SUPABASE_SECRET_KEY, SERVICE_ROLE, OPENROUTER_API_KEY ou SECURITY_LOG_SALT em variaveis `NEXT_PUBLIC_*`.
- Revise as variaveis de ambiente da Vercel e remova chaves antigas.
- Se qualquer segredo ja tiver sido commitado no passado, rotacione-o mesmo depois de apagar o arquivo.
