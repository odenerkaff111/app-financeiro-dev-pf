import { assessPurchase, currency, dateLabel, validDay, type FamilyData, type FamilyOverview } from './family-finance';

export type ChatAgent = 'registrar' | 'consultor';
export type ChatConversation = {id:string;title:string;agent:ChatAgent;archived_at:string|null;last_message_at:string};
export type ChatAttachment = {id:string;name:string;mime:string;size:number;path:string;sha256:string;extracted_text?:string|null};
export type ChatCard = {
  kind:'balances'|'invoices'|'cashflow'|'categories'|'goal'|'scenarios';
  title:string;asOf:string;period:string;source:string;notes:string[];
  rows?:{label:string;value:number;detail?:string;secondary?:number|null}[];
  points?:{label:string;value:number}[];
  goal?:{target:number;saved:number;remaining:number;monthly:number;months:number;deadline:string;progress:number};
};
export type ChatParts={delivery?:'sending'|'sent'|'unknown';cards?:ChatCard[];attachments?:ChatAttachment[];balances?:{name:string;before:number;after:number}[];requestId?:string;stopped?:boolean;model?:string;handoff?:string};
export type ChatMessage={id:string;role:'user'|'assistant';content:string;created_at:string;parts:ChatParts;action_type:string|null;action_status:string;action_payload:Record<string,unknown>;error_message:string|null};
export const AGENTS={
 registrar:{label:'Registrar',description:'Organize movimentações e confirme antes de salvar.',placeholder:'Conte suas movimentações...',suggestions:['Quero registrar as movimentações dos últimos dias','Paguei uma fatura e quero dar baixa','Quero conferir e atualizar meus saldos']},
 consultor:{label:'Consultor',description:'Entenda suas finanças e planeje os próximos passos.',placeholder:'Converse com o Consultor...',suggestions:['Como estão minhas finanças neste mês?','Quanto preciso pagar de faturas?','Quero planejar uma viagem em família']},
} as const;
export const BUCKET='kyra-chat-private';
export const MAX_FILE_BYTES=8*1024*1024;
export const MAX_ATTACHMENTS=5;
export const normalizeText=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function fileKind(name:string,type:string):'image'|'pdf'|'statement'{
 if(/\.(jpe?g|png|webp)$/i.test(name)&&['image/jpeg','image/png','image/webp'].includes(type))return 'image';
 if(/\.pdf$/i.test(name)&&type==='application/pdf')return 'pdf';
 if(/\.(ofx|csv)$/i.test(name))return 'statement';
 throw new Error('Envie uma foto JPG/PNG/WebP, PDF, OFX ou CSV. Para HEIC, selecione uma versão JPEG da foto.');
}
export function financialCard(view:FamilyOverview,kind:ChatCard['kind'],asOf=new Date().toISOString()):ChatCard{
 const base={kind,title:'',asOf,period:view.month,source:'Registros da família',notes:[...view.issues]};
 switch(kind){
 case 'balances':return {...base,title:'Dinheiro nas contas',rows:view.accounts.filter(a=>a.active&&a.scope==='personal'&&['checking','savings','cash','wallet'].includes(a.type)).map(a=>({label:a.name,value:a.balance})),notes:[...base.notes,'Limite de cartão e investimentos ficam separados do dinheiro em conta.']};
 case 'invoices':return {...base,title:'Faturas do período',rows:view.bills.map(b=>({label:b.name,value:b.remaining,secondary:b.total,detail:`Vence ${dateLabel(b.due)} · pago ${currency(b.paid)}`})),notes:[...base.notes,'Faturas e empréstimos são consultados separadamente. Nenhum pagamento foi registrado por esta consulta.']};
 case 'categories':return {...base,title:'Gastos por categoria',rows:view.categories.map(c=>({label:c.name,value:c.amount,secondary:c.incomeShare,detail:`${c.share.toFixed(1)}% dos gastos${c.incomeShare===null?'':` · ${c.incomeShare.toFixed(1)}% da renda`}`})),notes:[...base.notes,`Renda considerada: ${currency(view.income)}. Percentual dos gastos e percentual da renda têm bases diferentes.`]};
 case 'cashflow':return {...base,title:'Projeção do caixa',rows:[{label:'Saldo ao fim do período',value:view.forecast.end},{label:`Menor saldo · ${dateLabel(view.forecast.minimumOn)}`,value:view.forecast.minimum},{label:'Sem receitas incertas',value:view.conservativeForecast.end}],points:view.forecast.available?view.forecast.points.map(p=>({label:p.day,value:p.balance})):[],notes:[...base.notes,'Projeção baseada nos compromissos e recebimentos cadastrados; não é saldo bancário garantido.']};
 default:throw new Error('Visualização financeira inválida.');
 }
}
export function simulateGoal(data:FamilyData,today:string,input:{target:number;saved?:number;deadline:string;title?:string}):ChatCard{
 if(!Number.isFinite(input.target)||input.target<=0||input.target>1000000||!validDay(input.deadline)||input.deadline<today)throw new Error('Informe uma meta positiva e uma data futura válida.');
 if(input.saved!==undefined&&(!Number.isFinite(input.saved)||input.saved<0||input.saved>1000000))throw new Error('Valor reservado inválido.');
 const target=Math.round(input.target*100),saved=Math.round((input.saved??0)*100),remaining=Math.max(0,target-saved);
 const first=new Date(today+'T12:00:00Z'),last=new Date(input.deadline+'T12:00:00Z');
 const months=Math.max(1,(last.getUTCFullYear()-first.getUTCFullYear())*12+last.getUTCMonth()-first.getUTCMonth()+1);
 if(months>24)throw new Error('Simule metas até 24 meses à frente.');
 return {kind:'goal',title:input.title?.slice(0,100)||'Seu plano',asOf:new Date().toISOString(),period:input.deadline.slice(0,7),source:'Simulação com premissas da conversa',notes:[`Hipótese: ${months} aportes, incluindo este mês e o mês da meta.`,input.saved===undefined?'Reserva não informada: a simulação parte de zero reservado.':'Reserva informada na conversa; não é uma nova aplicação.',`Necessidade média de ${currency(Math.ceil(remaining/months))} por aporte. Compare com o fluxo de caixa; o cálculo não garante capacidade de poupança.`,'Nenhum saldo, recebimento ou compromisso foi criado.'],goal:{target,saved,remaining,monthly:Math.ceil(remaining/months),months,deadline:input.deadline,progress:Math.min(100,saved/target*100)}};
}
export function purchaseScenario(view:FamilyOverview,amount:number,date:string,method:'debit'|'credit'):ChatCard{
 if(!Number.isFinite(amount)||amount<=0||amount>1000000||!validDay(date))throw new Error('Informe valor e data válidos para a compra.');
 const cents=Math.round(amount*100),assessment=assessPurchase(view,cents,date,method);
 return {kind:'scenarios',title:'Impacto da compra',asOf:new Date().toISOString(),period:view.month,source:'Simulação de compra',rows:[{label:'Valor da compra',value:cents},{label:'Saldo projetado sem a compra',value:view.forecast.end},{label:'Saldo projetado com a compra',value:method==='debit'?view.forecast.end-cents:view.forecast.end}],notes:[assessment.reply,...view.issues,method==='credit'?'A compra no crédito exige vencimento e condições para projetar a fatura. Não foi tratada como saída imediata da conta.':'A projeção depende de todas as entradas e despesas estarem cadastradas.']};
}
export function parseToolArgs(raw:string):Record<string,unknown>{
 const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Parâmetros de consulta inválidos.');return v;
}
export function compactFinancialContext(view:FamilyOverview){
 return {hoje:view.today,periodo:view.month,caixa:currency(view.cash),creditoSeparado:currency(view.credit),aReceber:currency(view.receivable),compromissos:currency(view.required),renda:currency(view.income),gastos:currency(view.consumption),investido:currency(view.invested),dividas:currency(view.debtRemaining),alertas:view.issues,contas:view.accounts.filter(a=>a.active).map(a=>({nome:a.name,tipo:a.type,escopo:a.scope,saldo:currency(a.balance),limite:a.credit===null?null:currency(a.credit)})),faturas:view.bills.map(b=>({cartao:b.name,vencimento:b.due,total:currency(b.total),pago:currency(b.paid),aPagar:currency(b.remaining)})),projecao:{final:currency(view.forecast.end),minimo:currency(view.forecast.minimum),data:view.forecast.minimumOn,semReceitasIncertas:currency(view.conservativeForecast.end)},vencimentos:view.items.slice(0,45).map(x=>({descricao:x.name,valor:currency(x.amount),data:x.due,tipo:x.kind,previsto:x.expected}))};
}
