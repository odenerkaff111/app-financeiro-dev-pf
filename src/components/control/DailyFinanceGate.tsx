'use client';
import { useCallback,useEffect,useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useHousehold } from '@/contexts/HouseholdContext';
import { errorText,rpc } from '@/lib/control/client';
import { clearApplicationBadge } from '@/lib/push-client';
import { Alert,button,secondary } from './FinanceControl';

type DailyState={
 blocked:boolean;
 day:string;
 slot:string|null;
 needs_entry:boolean;
 has_activity:boolean;
};

export function DailyFinanceGate({children}:{children:ReactNode}){
 const{household,isViewer}=useHousehold();
 const router=useRouter();
 const[state,setState]=useState<DailyState|null>(null);
 const[error,setError]=useState('');
 const[busy,setBusy]=useState(false);
 const[dismissed,setDismissed]=useState(false);
 const[pendingHidden,setPendingHidden]=useState(false);

 const load=useCallback(async()=>{
  if(isViewer)return;
  try{
   const next=await rpc<DailyState>('pf_daily_state_v1',{p_household:household.id});
   setState(next);
   if(!next.blocked)void clearApplicationBadge();
   setError('');
  }catch(e){setError(errorText(e));}
 },[household.id,isViewer]);

 useEffect(()=>{
  void load();
  const interval=setInterval(()=>void load(),30000);
  const refresh=()=>void load();
  window.addEventListener('focus',refresh);
  window.addEventListener('pf:financial-data-changed',refresh);
  return()=>{
   clearInterval(interval);
   window.removeEventListener('focus',refresh);
   window.removeEventListener('pf:financial-data-changed',refresh);
  };
 },[load]);

 useEffect(()=>{
  setDismissed(false);
  setPendingHidden(false);
 },[state?.day,state?.slot]);

 async function answer(value:string){
  if(busy)return;
  setBusy(true);
  setError('');
  try{
   const next=await rpc<DailyState>('pf_daily_answer_v1',{p_household:household.id,p_answer:value});
   setState(next);
   if(!next.blocked)void clearApplicationBadge();
   if(value==='no'){
    setDismissed(true);
    router.push('/registros');
   }
  }catch(e){setError(errorText(e));}
  finally{setBusy(false);}
 }

 if(isViewer)return <>{children}</>;

 const needsPrompt=Boolean(state?.blocked&&!state?.needs_entry&&!dismissed);
 const showPending=Boolean(state?.needs_entry&&!pendingHidden);

 return <>
  {children}

  {showPending&&<div className="fixed inset-x-3 bottom-[5.6rem] z-[90] rounded-2xl border border-amber-200 bg-amber-50/95 p-3 shadow-xl backdrop-blur md:inset-x-auto md:right-4 md:top-4 md:bottom-auto md:max-w-xl">
   <div className="space-y-3 text-sm">
    <div className="flex items-start justify-between gap-3">
     <div>
      <p className="font-semibold text-slate-900">Atualizacao financeira pendente</p>
      <p className="mt-1 text-slate-600">Use este aviso como lembrete. Ele nao bloqueia nenhuma tela do app.{state?.has_activity?' Uma movimentacao ou conciliacao ja foi detectada.':''}</p>
     </div>
     <button type="button" className="rounded-lg px-2 py-1 text-slate-500" aria-label="Ocultar lembrete" onClick={()=>setPendingHidden(true)}>×</button>
    </div>
    <Alert error={error}/>
    <div className="flex flex-wrap gap-2">
     <button className={secondary} disabled={busy} onClick={()=>router.push('/registros')}>Ir para movimentacoes</button>
     <button className={button} disabled={busy} onClick={()=>void answer('registered')}>Marcar como conferido</button>
    </div>
   </div>
  </div>}

  {needsPrompt&&<div className="fixed inset-0 z-[450] flex items-center justify-center overflow-y-auto bg-[#0D1B2A]/78 p-4" role="dialog" aria-modal="true" aria-labelledby="daily-title">
   <div className="w-full max-w-lg space-y-4 rounded-3xl bg-[#F7F5EF] p-6 shadow-2xl">
    <div className="flex items-start justify-between gap-4">
     <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-[#9A773A]">Lembrete financeiro</p>
      <h1 id="daily-title" className="mt-2 text-2xl font-semibold">Voce ja conferiu as movimentacoes?</h1>
     </div>
     <button type="button" className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600" disabled={busy} onClick={()=>setDismissed(true)}>Agora nao</button>
    </div>
    <p className="text-sm leading-6 text-slate-600">Este lembrete ajuda a manter a Kyra atualizada, mas nao impede o uso do aplicativo. Se voce confirmar sem registrar nada, a ferramenta aceita sua decisao.</p>
    <Alert error={error}/>
    {!state?<>
     <p className="text-sm">{error?'Nao foi possivel consultar o controle diario.':'Conferindo no servidor...'}</p>
     <button className={secondary} onClick={()=>void load()}>Tentar novamente</button>
    </>:<>
     <div className="grid gap-3 sm:grid-cols-2">
      <button className={button} disabled={busy} onClick={()=>void answer('registered')}>Sim, esta tudo atualizado</button>
      <button className={secondary} disabled={busy} onClick={()=>void answer('no')}>Vou atualizar agora</button>
     </div>
     <button className="w-full rounded-xl border p-3 text-sm" disabled={busy} onClick={()=>void answer('no_movements')}>Hoje nao houve movimentacoes</button>
     <p className="text-xs leading-5 text-slate-500">Movimentacoes inseridas por SQL e conciliacoes de saldo tambem contam como atividade. Nenhuma resposta cria uma trava de navegacao.</p>
    </>}
   </div>
  </div>}
 </>;
}
