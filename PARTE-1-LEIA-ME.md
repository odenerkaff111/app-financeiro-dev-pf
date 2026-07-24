# Parte 1 — Segurança, papéis, login e limpeza visual

## Entrega

- RLS padronizado para tabelas financeiras.
- Visualizador sem permissão de escrita financeira.
- Administrador e proprietário com permissão de escrita.
- Auditoria de contas, categorias, movimentações, dívidas, movimentos de dívida, recorrências, configurações de IA e acessos.
- Views `pf_*` com `security_invoker`.
- Funções de pagamento e empréstimo protegidas por `pf_can_write`.
- Login no visual do Grupo Umsó.
- Sem cadastro público.
- Recuperação e definição de senha.
- Convite de usuários por e-mail.
- Configurações Gerais redesenhadas.
- Impostos removidos.
- Página do Assistente contendo somente o chat.
- Confirmação da IA e importação bloqueadas para visualizadores.

## Variável secreta necessária

No `.env.local`:

```env
SUPABASE_SECRET_KEY=COLE_A_SECRET_KEY_DO_SUPABASE
```

Também é aceito o nome legado:

```env
SUPABASE_SERVICE_ROLE_KEY=COLE_A_SERVICE_ROLE_KEY
```

Nunca use prefixo `NEXT_PUBLIC_` nessa chave.

## Configuração obrigatória no Supabase

1. Authentication → URL Configuration:
   - Site URL: `http://localhost:3000`
   - Redirect URL: `http://localhost:3000/auth/definir-senha`

2. Authentication → Providers → Email:
   - desative cadastro público / novos signups;
   - mantenha login por e-mail e senha habilitado.

3. Execute `supabase/migrations/010_security_roles_audit.sql` no SQL Editor.
