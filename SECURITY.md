# Security

## Relato responsável

Não publique vulnerabilidades, dados financeiros, credenciais ou informações pessoais em issues públicas. Use um canal privado do proprietário do repositório.

## Dados proibidos no repositório

- arquivos `.env`;
- chaves do Supabase ou OpenRouter;
- salts de logs;
- extratos reais;
- dumps de produção;
- nomes e valores de credores reais em seeds;
- screenshots com dados pessoais reais.

## Verificação local

```bash
node tools/check-public-repo.mjs
npm run build
```

A verificação automática reduz risco, mas não substitui revisão humana e limpeza do histórico Git.
