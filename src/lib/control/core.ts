// Pure functions used by the client, server validation and offline regression tests.
export const isUuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const isPhone=(s:string)=>/^[1-9][0-9]{9,14}$/.test(s);
export function normalizeSlots(values:string[]):string[]{
 if(!values.length||values.length>30)throw new Error('Escolha entre 1 e 30 horarios.');
 if(values.some(s=>!(/^(0[89]|1[0-9]|2[01]):[0-5][0-9]$/.test(s)||s==='22:00')))throw new Error('Horario fora do intervalo 08:00-22:00.');
 return [...new Set(values)].sort();
}
export function splitCents(total:number,count:number):number[]{
 if(!Number.isSafeInteger(total)||total<=0||!Number.isInteger(count)||count<1||count>120||count>total)throw new Error('Valor ou parcelas invalidos.');
 return Array.from({length:count},(_,i)=>Math.floor(total/count)+(i<total%count?1:0));
}
export function safeQr(value:unknown):string|undefined{
 if(typeof value!=='string'||value.length>600000)return undefined;
 return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)?value:undefined;
}
export function statementAfterItemization(unallocatedCents:number,detailCents:number){
 if(!Number.isSafeInteger(unallocatedCents)||!Number.isSafeInteger(detailCents)||detailCents<=0||detailCents>unallocatedCents)throw new Error('Saldo sem detalhamento insuficiente.');
 return unallocatedCents-detailCents;
}
