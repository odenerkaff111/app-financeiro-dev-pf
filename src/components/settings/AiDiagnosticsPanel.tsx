'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {summarizeTrace,summarizeConversation,type TraceEvent} from '@/lib/ai-observability';
import s from './ai-trace.module.css';
type Summary=ReturnType<typeof summarizeTrace>|ReturnType<typeof summarizeConversation>;
type RequestRow={id:string;status:string;createdAt:string;label:string;summary:ReturnType<typeof summarizeTrace>};
const usd=(v:number|null)=>v===null?'Não informado':v>0&&v<.000000001?'US$ '+v.toExponential(2).replace('.',','):new Intl.NumberFormat('pt-BR',{style:'currency',currency:'USD',minimumFractionDigits:v===0?2:6,maximumFractionDigits:9}).format(v);
const time=(v:number|null)=>v===null?'Em andamento':v<1000?v+' ms':(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:2})+' s';
export function AiDiagnosticsPanel({householdId,requestId,conversationId,initialConversation=false}:{householdId:string;requestId?:string;conversationId?:string;initialConversation?:boolean}){
 const [mode,setMode]=useState<'message'|'conversation'>(initialConversation?'conversation':'message'),[selected,setSelected]=useState(requestId||''),[events,setEvents]=useState<TraceEvent[]>([]),[requests,setRequests]=useState<RequestRow[]>([]),[summary,setSummary]=useState<Summary|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[watching,setWatching]=useState(false),[updated,setUpdated]=useState(''),[partial,setPartial]=useState(false);
 const alive=useRef(true),inFlight=useRef(false),scope=useRef(''),pageLimit=useRef(10);scope.current=mode+':'+(mode==='conversation'?conversationId:selected);
 const fetchTrace=useCallback(async(target:string,asConversation:boolean)=>{
  const session=await supabase.auth.getSession();if(!session.data.session)throw new Error('Entre novamente para consultar seus diagnósticos.');
  const headers={Authorization:`Bearer ${session.data.session.access_token}`};const rows:RequestRow[]=[],allEvents:TraceEvent[]=[];let cursor:string|null=null,processing=false,hasMore=false,truncated=false;
  for(let page=0;page<(asConversation?pageLimit.current:1);page++){
   const q=new URLSearchParams({householdId});if(asConversation){q.set('scope','conversation');q.set('conversationId',conversationId!);if(cursor)q.set('cursor',cursor);}else if(target)q.set('requestId',target);
   const response=await fetch('/api/assistant/workspace/diagnostics?'+q,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)}),result=await response.json();
   if(!response.ok||result.storageReady===false)throw new Error(result.error||result.message||'Não consegui consultar o rastreamento.');
   if(asConversation&&result.scope!=='conversation')throw new Error('Reinicie a ferramenta para carregar o rastreamento completo da conversa.');
   allEvents.push(...(result.events??[]));rows.push(...(result.requests??[]));processing=processing||Boolean(result.processing);truncated=truncated||Boolean(result.partial);hasMore=Boolean(result.hasMore);cursor=result.nextCursor||null;
   if(!asConversation)return {events:allEvents,requests:[],summary:result.summary??summarizeTrace(allEvents),selected:result.selectedRequestId||target,processing:processing||!allEvents.length,partial:false};
   if(!hasMore||!cursor)break;
  }
  const unique=[...new Map(allEvents.map(e=>[e.id,e])).values()].sort((a,b)=>a.created_at.localeCompare(b.created_at));
  return {events:unique,requests:[...new Map(rows.map(r=>[r.id,r])).values()],summary:summarizeConversation(unique,rows.map(r=>r.id)),selected:conversationId!,processing,partial:hasMore||truncated};
 },[householdId,conversationId]);
 const refresh=useCallback(async(quiet=false,testTarget?:'primary'|'fallback')=>{
  if(inFlight.current)return true;inFlight.current=true;const startedScope=scope.current;if(!quiet)setBusy(true);
  try{
   let target=selected;
   if(testTarget){const session=await supabase.auth.getSession();if(!session.data.session)throw new Error('Entre novamente.');const response=await fetch('/api/assistant/workspace/diagnostics',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.data.session.access_token}`},signal:AbortSignal.timeout(60000),body:JSON.stringify({householdId,target:testTarget})}),test=await response.json();target=test.requestId||target;if(alive.current&&scope.current===startedScope)setMessage(test.message||test.error||'Teste concluído.');}
   const data=await fetchTrace(target,mode==='conversation');if(!alive.current||scope.current!==startedScope)return false;
   setEvents(data.events);setRequests(data.requests);setSummary(data.summary);setPartial(data.partial);if(mode==='message'&&data.selected!==selected)setSelected(data.selected);setUpdated(new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'}));return data.processing;
  }catch(e){if(alive.current&&scope.current===startedScope)setMessage(e instanceof Error?e.message:'Não consegui consultar os detalhes.');return false;}
  finally{inFlight.current=false;if(alive.current)setBusy(false);}
 },[fetchTrace,selected,mode,householdId]);
 useEffect(()=>{
  alive.current=true;let cancelled=false,timer:ReturnType<typeof setTimeout>;const started=Date.now();
  async function tick(){const active=await refresh(true);if(cancelled)return;if(active&&Date.now()-started<125000){setWatching(true);timer=setTimeout(()=>void tick(),1500);}else setWatching(false);}
  if(selected||mode==='conversation'){setEvents([]);setRequests([]);setSummary(null);setMessage('');setWatching(true);void tick();}
  return()=>{cancelled=true;alive.current=false;clearTimeout(timer);};
 },[refresh,selected,mode]);
 async function download(){
  setBusy(true);try{
   let data={events,requests,summary,partial};
   if(mode==='conversation'&&partial){pageLimit.current+=20;const full=await fetchTrace(selected,true);data=full;setEvents(full.events);setRequests(full.requests);setSummary(full.summary);setPartial(full.partial);}
   const body={scope:mode,id:mode==='conversation'?conversationId:selected,complete:!data.partial&&!data.summary?.partial,exportedAt:new Date().toISOString(),summary:data.summary,requests:data.requests.map(({label,...r})=>r),events:data.events};
   const url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='kyra-trace-'+mode+'-'+(mode==='conversation'?conversationId:selected)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setMessage(e instanceof Error?e.message:'Não consegui exportar.');}finally{setBusy(false);}
 }
 const costs=summary?.costs,tools=summary?.tools.filter(t=>t.source==='model')??[],modelCalls=summary?.calls??[];
 const status=watching?'Ao vivo':summary?.status==='error'?'Falhou':summary?.status==='success'?'Concluído':'Incompleto';
 return <section className={s.panel} aria-label="Rastreamento da IA">
  {conversationId&&<div className={s.tabs}><button aria-pressed={mode==='message'} onClick={()=>setMode('message')} disabled={!selected}>Mensagem</button><button aria-pressed={mode==='conversation'} onClick={()=>setMode('conversation')}>Conversa completa</button></div>}
  <div className={s.top}><h3>Rastreamento da IA</h3>{summary&&<span className={`${s.badge} ${summary.status==='error'?s.failed:''}`}>{status}</span>}</div>
  {(selected||mode==='conversation')&&<p className={s.request}>{mode==='conversation'?'Conversa':'ID'}: <code>{mode==='conversation'?conversationId:selected}</code></p>}
  <p className={s.note} role="status">{watching?'Atualizando em tempo real...':updated?'Última consulta às '+updated+'.':''}</p>
  {summary&&<>
   <div className={s.metrics}>
    <div className={s.duration}><small>{mode==='conversation'?'Tempo total de análise':'Duração da análise'}</small><strong>{time(summary.durationMs)}</strong></div>
    <div><small>Tokens de entrada</small><strong>{summary.inputTokens.toLocaleString('pt-BR')}{!summary.tokensComplete?' *':''}</strong><span className={s.minorCost}>{costs?.estimated?'≈ ':''}{costs?.inputUsd===null?'Custo não discriminado':usd(costs?.inputUsd??null)}</span></div>
    <div><small>Tokens de saída</small><strong>{summary.outputTokens.toLocaleString('pt-BR')}{!summary.tokensComplete?' *':''}</strong><span className={s.minorCost}>{costs?.estimated?'≈ ':''}{costs?.outputUsd===null?'Custo não discriminado':usd(costs?.outputUsd??null)}</span></div>
    <div><small>Tokens totais</small><strong>{summary.totalTokens.toLocaleString('pt-BR')}{!summary.tokensComplete?' *':''}</strong></div>
    <div><small>{mode==='conversation'?'Custo da conversa':'Custo por mensagem'}</small><strong className={s.cost}>{usd(costs?.totalUsd??null)}</strong><span className={s.minorCost}>{costs?.partial?'Parcial':costs?.estimated?'Estimado':'Informado / configurado'}</span></div>
   </div>
   {!summary.tokensComplete&&<p className={s.note}>* Consumo parcial: nem todas as chamadas informaram tokens.</p>}
   {costs?.estimated&&<p className={s.note}>Estimativa em USD pelas tarifas registradas para cada chamada. A cobrança real pode variar conforme seu plano.</p>}
   {partial&&<p className={s.note}>Há mais mensagens. Carregue o restante para consultar o total completo.</p>}{summary.partial&&<p className={s.note}>Algumas etapas não estão disponíveis no histórico; o resumo pode estar parcial.</p>}
   {mode==='conversation'&&<div className={s.section}><h4>Mensagem por mensagem · {requests.length}</h4>{requests.map((r,i)=><button key={r.id} aria-label={'Abrir trace da mensagem '+(i+1)} className={s.traceMessage} onClick={()=>{setSelected(r.id);setMode('message');}}><span><small>{i+1} · {new Date(r.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · {r.status==='processing'?'em andamento':r.summary.status==='error'?'falhou':'concluído'}</small><b>{r.label}</b></span><span>{r.summary.totalTokens.toLocaleString('pt-BR')} tokens<small>{usd(r.summary.costs.totalUsd)}</small></span></button>)}</div>}
   <div className={s.section}><h4>Modelos</h4>{modelCalls.length?modelCalls.map(c=><div className={s.row} key={String(c.id)}><span><b>{String(c.model||'Não informado')}</b><small>{String(c.provider||'')} · {c.status==='success'?'concluiu':c.status==='error'?'falhou':'em andamento'}</small></span><span>{time(typeof c.duration_ms==='number'?c.duration_ms:null)}</span></div>):<p>Nenhum modelo chamado.</p>}</div>
   {tools.length>0&&<div className={s.section}><h4>Ferramentas acionadas pela LLM</h4>{tools.map(t=><div className={s.row} key={String(t.id)}><span>{String(t.name)}<small>{t.status==='success'?'sucesso':t.status==='error'?'erro':'em andamento'}</small></span><span>{time(t.durationMs)}</span></div>)}</div>}
  </>}
  <div className={s.buttons}><button disabled={busy} onClick={()=>void refresh()}>{busy?'Consultando...':'Atualizar'}</button><button disabled={!events.length||busy} onClick={()=>void download()}>Baixar JSON</button>{partial&&<button disabled={busy} onClick={()=>{pageLimit.current+=10;void refresh();}}>Carregar restante</button>}{!requestId&&!conversationId&&<><button disabled={busy} onClick={()=>void refresh(false,'primary')}>Testar conexão da IA</button><button disabled={busy} onClick={()=>void refresh(false,'fallback')}>Testar fallback</button></>}</div>
  {message&&<p className={s.note} role="status">{message}</p>}
  {events.length>0&&<details className={s.details}><summary>Etapas e dados técnicos</summary>{events.map(e=><details key={e.id}><summary>{mode==='conversation'?e.request_id.slice(0,8)+' · ':''}{e.stage} · {e.level}</summary><pre>{JSON.stringify({at:e.created_at,...e.metadata},null,2)}</pre></details>)}</details>}
 </section>;
}
