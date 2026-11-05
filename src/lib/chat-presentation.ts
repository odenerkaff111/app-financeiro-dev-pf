import {validDay,currency} from './family-finance';
import type {FamilyPreview} from './family-operations';
export type ChatProgress={step:string;phase?:'prepare'|'confirm'|'upload'};
export const PROCESS_LABELS:Record<string,string>={sending:'Enviando mensagem',received:'Mensagem recebida',reading_files:'Lendo seus anexos',checking_finances:'Conferindo suas contas',understanding:'Entendendo as movimentações',analyzing:'Analisando sua pergunta',calculating:'Calculando os cenários',fallback:'Tentando outra rota de IA',validating_plan:'Conferindo valores e datas',building_preview:'Organizando sua revisão',review_ready:'Revisão pronta',clarification:'Conferindo uma informação',checking_confirmation:'Conferindo sua confirmação',saving_finances:'Registrando movimentações',updating_chat:'Atualizando seu financeiro',confirmed:'Tudo registrado',preparing_file:'Conferindo o arquivo',uploading_file:'Enviando o anexo',saving_file:'Salvando o comprovante'};
export function appendProgress(steps:string[],step:string){if(!PROCESS_LABELS[step]||steps.at(-1)===step)return steps;return [...steps,step].slice(-12);}
export function dateClarification(message:string,today:string){
 const found=[...message.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)];
 for(const match of found){
  const day=`${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`,label=match[0];
  if(!validDay(day))return `A data ${label} não existe no calendário. Qual é a data correta? Ainda não preparei nenhum lançamento.`;
  if(day<'2020-01-01')return `Você escreveu ${label}. Esse registro é realmente dessa data ou houve um erro no ano? Confirme a data do recebimento antes de eu preparar a revisão.`;
  const before=message.slice(Math.max(0,(match.index??0)-28),match.index).toLowerCase();
  if(/hoje(?:\s+(?:dia|em))?\s*$/.test(before)&&day!==today)return `Você escreveu “hoje” e também ${label}, mas a data de hoje é ${today.split('-').reverse().join('/')}. Qual data devo usar?`;
 }
 return null;
}
export function previewSummary(items:FamilyPreview[],confirmed=false){
 return `${confirmed?'Registro confirmado':'Prévia para conferência'}: ${items.map(item=>`${item.description}: ${currency(Math.round(item.amount*100))} em ${item.account_name}${item.kind==='borrow_money'?`, credor ${item.creditor}, total a devolver ${currency(Math.round((item.repayment_amount??item.amount)*100))}, vencimento ${item.due_on}`:''}`).join('; ')}. ${confirmed?'Confirmado e salvo.':'Aguardando sua confirmação.'}`;
}
