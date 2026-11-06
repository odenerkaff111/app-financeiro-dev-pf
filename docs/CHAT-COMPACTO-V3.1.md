# Chat compacto v3.1

O assistente usa uma única barra de ferramentas, mensagens em uma coluna e
histórico fechado inicialmente. O histórico continua acessível pelo botão de
menu; Registrar e Consultor continuam disponíveis no seletor de agente.

Comprovantes confirmados ou descartados aparecem recolhidos. Clique no resumo
para abrir todos os detalhes. As prévias que ainda aguardam confirmação continuam
abertas, com valores, conta, datas e ações de confirmar, corrigir ou descartar.
O processamento das mensagens, anexos e confirmações foi preservado.

O menu principal continua fixo no rodapé no mobile. O campo de mensagem reserva
espaço acima dele. No desktop, a navegação permanece no topo, como no dashboard.

Esta revisão altera somente ChatWorkspace.tsx e chat.module.css em relação à v3.
Não altera os cálculos do dashboard, dados financeiros, APIs, autenticação,
dependências ou configuração de segurança. Não executa SQL.

O pacote é cumulativo: inclui os arquivos do visual completo v3.0 para quem ainda
não instalou ou enviou aquela atualização ao Git. Consulte VISUAL-COMPLETO-V3.0.md
para as mudanças daquela versão.

## Validação

- TypeScript, build de produção e 21 testes do chat aprovados.
- Fluxos visuais conferidos com dados sintéticos: prévia pendente completa,
  confirmação, comprovante recolhido e expandido, histórico e nova conversa.
- Larguras 360, 390, 430 e 1280 px; altura reduzida de 480 px. Campo de mensagem
  acima do menu mobile, sem rolagem horizontal.
- As funções de envio, anexos, confirmação e histórico foram comparadas à v3.
- O instalador e o fluxo Git foram simulados em Linux. A sintaxe PowerShell foi
  analisada; a execução nativa no Windows fica a cargo do instalador no PC.
