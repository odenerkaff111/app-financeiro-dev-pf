'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Banknote, ChevronDown, ChevronLeft, ChevronRight, CreditCard, Eye, EyeOff, HandCoins, Home, Info, Loader2, RefreshCw, SlidersHorizontal, Sparkles, TrendingUp, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useHousehold } from '@/contexts/HouseholdContext';
import { supabase, getSessionOnce } from '@/lib/supabase';
import { rows, errorText, today, dateLabel } from '@/lib/control/client';
import { currency, str, type Row } from '@/lib/family-finance';
import { monthLabel, shiftMonth, statementItems, type CardBillItem } from '@/lib/card-statements';
import { buildModernDashboard, annualDashboard, type DashboardData } from '@/lib/dashboard/modern-model';
import { type InvoiceCard } from '@/lib/dashboard/card-invoices';
import { CardBillsPanel } from '@/components/finance/CardBillsPanel';
import styles from './modern-dashboard.module.css';

type Loaded = { data: DashboardData; name: string; loadedAt: string };
type Money = (cents: number | null) => string;

function AnnualTooltip({point,money}:{point:ReturnType<typeof annualDashboard>[number];money:Money}) {
  return <div className={styles.tooltip}><strong>{point.month}</strong><dl>
    <dt>Entrou</dt><dd>{money(point.received)}</dd><dt>Previsto a entrar</dt><dd>{money(point.expectedIn)}</dd>
    <dt>Saiu</dt><dd>{money(point.paid)}</dd><dt>Pendente a pagar</dt><dd>{money(point.expectedOut)}</dd>
  </dl>{point.estimatedOut>0 && <small>As saídas incluem {money(point.estimatedOut)} de ajuste histórico estimado já cadastrado.</small>}</div>;
}

function BankMark({ name, cash = false, third = false }: { name: string; cash?: boolean; third?: boolean }) {
  const n = name.toLowerCase();
  const brand = cash ? 'cash' : third ? 'third' : n.includes('nubank') ? 'nu' : /itau|itaú/.test(n) ? 'itau' : n.includes('santander') ? 'santander' : /\bc6\b/.test(n) ? 'c6' : '';
  return <span aria-hidden="true" className={`${styles.bankMark} ${brand ? styles[brand] : ''}`}>{cash ? <Banknote size={16}/> : third ? <CreditCard size={14}/> : brand === 'nu' ? 'nu' : brand === 'itau' ? 'itaú' : brand === 'santander' ? 'S' : brand === 'c6' ? 'C6' : name.slice(0,1).toUpperCase()}</span>;
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current, previous = document.body.style.overflow;
    dialog?.showModal(); document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={ref} aria-label={title} className={styles.dialog} onCancel={e => { if (e.target === e.currentTarget) { e.preventDefault(); close(); } }}>
    <div className={styles.dialogHeader}><h2>{title}</h2><button type="button" className={styles.iconButton} onClick={close} aria-label="Fechar detalhes"><X size={17}/></button></div>{children}
  </dialog>;
}

function InvoiceDetails({ card, transactions, money }: { card: InvoiceCard; transactions: Row[]; money: Money }) {
  return <div className={styles.billDetails}>{card.bills.length === 0 ? <p className={styles.empty}>Nenhuma fatura confirmada neste mês.</p> : card.bills.map(b => <div key={b.id}>
    <h3>Vencimento {dateLabel(b.due_date)} · {money(Math.round(Number(b.remaining_amount)*100))} a pagar</h3>
    <ul>{statementItems(transactions as unknown as CardBillItem[],b.id).map(t => <li key={t.id}><div>{t.description}<small>{t.merchant ? `${t.merchant} · ` : ''}{t.installment_total && t.installment_total>1 ? `Parcela ${t.installment_number}/${t.installment_total}` : 'Parcela única'} · {dateLabel(t.occurred_on)}</small></div><strong>{money(Math.round(Number(t.amount)*100))}</strong></li>)}
      {Number(b.unallocated_amount)>0 && <li>Valor sem detalhamento<strong>{money(Math.round(Number(b.unallocated_amount)*100))}</strong></li>}
    </ul>
  </div>)}</div>;
}

export function ModernDashboard() {
  const { household } = useHousehold();
  return <DashboardContent key={household.id}/>;
}

function DashboardContent() {
  const { household } = useHousehold();
  const [snapshot,setSnapshot] = useState<Loaded|null>(null);
  const [month,setMonth] = useState(() => today().slice(0,7));
  const [year,setYear] = useState(() => Number(today().slice(0,4)));
  const [hidden,setHidden] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [showAllDebts,setShowAllDebts] = useState(false);
  const [showPaid,setShowPaid] = useState(false);
  const [dialog,setDialog] = useState<'manage'|string|null>(null);
  const sequence = useRef(0);
  const close = useCallback(() => setDialog(null),[]);
  const invalidate = useCallback(() => { sequence.current++; },[]);

  const load = useCallback(async () => {
    const request = ++sequence.current; setLoading(true);
    try {
      const session = await getSessionOnce();
      const user = session.data.session?.user;
      const profile = user ? supabase.from('pf_profiles').select('name').eq('id',user.id).maybeSingle() : Promise.resolve({data:null});
      const tables = ['pf_accounts','pf_transactions','pf_card_statement_dashboard','pf_categories','pf_debt_progress','pf_personal_loan_positions','pf_budgets','pf_recurring_templates','pf_investment_positions','pf_cost_of_living_monthly'] as const;
      const [values,pref,person] = await Promise.all([
        Promise.all(tables.map(table => rows<Row>(table,household.id,'*',table==='pf_cost_of_living_monthly' ? 'reference_month' : 'id'))),
        supabase.from('pf_family_preferences').select('minimum_reserve').eq('household_id',household.id).maybeSingle(),profile,
      ]);
      if(pref.error && !['42P01','PGRST205'].includes(pref.error.code))throw pref.error;
      if(request!==sequence.current)return;
      const data: DashboardData = {accounts:values[0],transactions:values[1],statements:values[2],categories:values[3],debts:values[4],loans:values[5],budgets:values[6],recurring:values[7],investmentPositions:values[8],essentialMonths:values[9],preferences:pref.data ? [pref.data] : []};
      const rawName = str(person.data?.name) || str(user?.user_metadata?.name) || str(user?.user_metadata?.full_name) || str(user?.user_metadata?.display_name);
      setSnapshot({data,name:rawName.trim().split(/\s+/)[0] || '',loadedAt:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'})});
      setError('');
    } catch(e) { if(request===sequence.current) { setError(errorText(e)); setSnapshot(null); } }
    finally { if(request===sequence.current)setLoading(false); }
  },[household.id]);

  useEffect(() => {
    const task=window.setTimeout(() => { try {setHidden(localStorage.getItem(`pf:dashboard-values-hidden:${household.id}`)==='true');}catch{} void load(); },0);
    const refresh=()=>{void load();};
    const storage=(e:StorageEvent)=>{if(e.key==='pf:financial-data-version')refresh();};
    window.addEventListener('pf:financial-data-changed',refresh);window.addEventListener('focus',refresh);window.addEventListener('storage',storage);
    return()=>{clearTimeout(task);invalidate();window.removeEventListener('pf:financial-data-changed',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('storage',storage);};
  },[load,invalidate,household.id]);

  const model=useMemo(()=>{if(!snapshot)return null;try{return {value:buildModernDashboard(snapshot.data,month,today()),error:''};}catch(e){return {value:null,error:errorText(e)};}},[snapshot,month]);
  const dashboard=model?.value;
  const annualState=useMemo(()=>{try{return {rows:snapshot ? annualDashboard(snapshot.data,year,today()) : [],error:''};}catch(e){return {rows:[],error:errorText(e)};}},[snapshot,year]);
  const annual=annualState.rows;
  const m:Money=value=>hidden ? '••••' : value==null ? '—' : currency(value);
  const pct=(value:number|null)=>hidden ? '•••' : value==null ? '—' : new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value)+'%';
  function togglePrivacy(){setHidden(value=>{const next=!value;try{localStorage.setItem(`pf:dashboard-values-hidden:${household.id}`,String(next));}catch{}return next;});setDialog(null);}
  function chooseMonth(value:string){if(/^20\d\d-(0[1-9]|1[0-2])$/.test(value) && value<=shiftMonth(today().slice(0,7),12))setMonth(value);}
  const date=new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date());
  const selectedCard=dashboard?.bills.cards.find(c=>c.id===dialog);
  const debtRows=dashboard?.debts.rows.filter(d=>showPaid || !d.paidOff) ?? [];
  const visibleDebts=showAllDebts ? debtRows : debtRows.slice(0,5);
  const yearOptions=snapshot ? [...new Set([Number(today().slice(0,4)),Number(today().slice(0,4))+1,...snapshot.data.transactions.map(t=>Number(str(t.occurred_on).slice(0,4))).filter(y=>y>=2000 && y<=Number(today().slice(0,4))+1)])].sort((a,b)=>b-a) : [year];
  const outRatio=dashboard && dashboard.view.cashIn+dashboard.pendingIn>0 ? (dashboard.view.cashOut+dashboard.pendingOut)/(dashboard.view.cashIn+dashboard.pendingIn)*100 : 0;

  return <div className={styles.root}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Sua vida financeira</p><h1>{snapshot?.name ? `Bem-vindo, ${snapshot.name}` : 'Bem-vindo à Kyra'}</h1><p className={styles.subtitle}>{date}</p></div>
      <div className={styles.controls}><div className={styles.period}><button type="button" className={styles.iconButton} aria-label="Mês anterior do dashboard" onClick={()=>chooseMonth(shiftMonth(month,-1))}><ChevronLeft size={16}/></button><label><span className={styles.screenReader}>Período do dashboard</span><input type="month" value={month} min="2000-01" max={shiftMonth(today().slice(0,7),12)} className={styles.monthInput} onChange={e=>chooseMonth(e.target.value)}/></label><button type="button" className={styles.iconButton} aria-label="Próximo mês do dashboard" disabled={month>=shiftMonth(today().slice(0,7),12)} onClick={()=>chooseMonth(shiftMonth(month,1))}><ChevronRight size={16}/></button></div>
      <button type="button" className={styles.iconButton} onClick={togglePrivacy} aria-label={hidden ? 'Mostrar valores do dashboard' : 'Ocultar valores do dashboard'}>{hidden ? <Eye size={17}/> : <EyeOff size={17}/>}</button><button type="button" className={styles.iconButton} aria-label="Atualizar dashboard" disabled={loading} onClick={()=>void load()}>{loading ? <Loader2 size={17} className="animate-spin"/> : <RefreshCw size={16}/>}</button></div>
    </header>
    {(error || model?.error || annualState.error) && <div role="alert" className={styles.error}><strong>Não foi possível atualizar sua visão financeira.</strong><p>{error || model?.error || annualState.error}</p><button type="button" className={styles.textButton} onClick={()=>void load()}>Tentar novamente</button></div>}
    {loading && !snapshot && <div role="status" className={styles.loading}><Loader2 size={23}/>Carregando suas finanças…</div>}
    {dashboard && snapshot && <>
      <div className={styles.topGrid}>
        <section className={styles.panel} aria-label="Saldos por conta"><div className={styles.balanceTop}><div className={styles.balanceLabel}><span>Saldo total · agora</span><Sparkles size={16}/></div><p className={styles.balanceAmount} data-testid="total-money">{m(dashboard.totalMoney)}</p><p className={styles.balanceCaption}>Dinheiro em contas e investimentos</p><div className={styles.balanceMeta}><span>Disponível em contas<strong>{m(dashboard.view.cash)}</strong></span><span>Crédito disponível<strong>{dashboard.view.unknownCredit>0 && !dashboard.ownCards.some(c=>c.credit!=null) ? 'Não informado' : m(dashboard.view.credit)}</strong></span></div></div>
          <div className={styles.accounts}>{dashboard.accounts.map(a=><Link href="/contas" key={a.id} className={styles.account} aria-label={`Conta ${a.name}`}><BankMark name={a.institution || a.name} cash={a.type==='cash'}/><div className={styles.accountName}><strong>{a.type==='cash' ? 'Em espécie' : a.institution || a.name.split(' - ')[0]}</strong><small>{a.type==='cash' ? 'Dinheiro físico' : a.scope==='business' ? 'Conta PJ' : a.name.includes(' - ') ? a.name.split(' - ').slice(1).join(' - ') : 'Conta pessoal'}</small></div><span className={styles.accountValue}>{m(a.balance)}</span></Link>)}{dashboard.accounts.length===0 && <p className={styles.empty}>Nenhuma conta ativa.</p>}</div>{dashboard.ownCards.length>0 && <div className={styles.creditLine}>{dashboard.ownCards.map(c=><span key={c.id}>Limite {c.institution || c.name}<strong>{c.credit==null ? 'Não informado' : m(c.credit)}</strong></span>)}</div>}
        </section>
        <section className={`${styles.panel} ${styles.health}`} aria-label="Resultado do mês"><div className={styles.healthHead}><h2>Seu mês</h2><span className={`${styles.tag} ${dashboard.partial ? styles.neutral : dashboard.result>=0 ? styles.positive : styles.negative}`}>{dashboard.past ? 'Realizado' : dashboard.partial ? 'Projeção parcial' : dashboard.result>=0 ? 'Saldo positivo' : 'Saldo negativo'}</span></div>
          <p className={`${styles.result} ${dashboard.result>=0 ? styles.green : styles.red}`} data-testid="month-result">{m(dashboard.result)}</p><p className={styles.resultCaption}>{dashboard.past ? 'Resultado das entradas e saídas realizadas' : `${dashboard.result>=0 ? 'Sobra prevista' : 'Falta prevista'} até o fim de ${monthLabel(month).split(' de ')[0]}`}</p>
          <div className={styles.runway}><div className={styles.runwayTrack}><div className={styles.runwayFill} style={{width:Math.min(100,outRatio)+'%',background:dashboard.result<0 ? '#d97f6d' : '#6558e8'}}/></div><div className={styles.runwayLabels}><span>Saídas realizadas e previstas</span><span>{dashboard.view.cashIn+dashboard.pendingIn>0 ? pct(outRatio)+' das entradas' : 'Sem entradas cadastradas'}</span></div></div>
          <div className={styles.flowGrid}><div className={styles.flowItem}><span><ArrowDownLeft size={13} className={styles.green}/>Entrou</span><strong>{m(dashboard.view.cashIn)}</strong></div><div className={styles.flowItem}><span><ArrowDownLeft size={13} className={styles.green}/>Vai entrar</span><strong>{m(dashboard.pendingIn)}</strong></div><div className={styles.flowItem}><span><ArrowUpRight size={13} className={styles.red}/>Saiu</span><strong>{m(dashboard.view.cashOut)}</strong></div><div className={styles.flowItem}><span><ArrowUpRight size={13} className={styles.red}/>Vai sair</span><strong>{m(dashboard.pendingOut)}</strong></div></div>
          <p className={styles.healthFoot}>{dashboard.past ? 'O saldo atual não é usado como saldo histórico.' : 'Saldo atual + recebimentos previstos − compromissos e planejamento.'}</p>{dashboard.realized.estimatedOut>0 && <p className={styles.healthFoot}>Inclui {m(dashboard.realized.estimatedOut)} de ajuste histórico estimado já cadastrado.</p>}
          {!dashboard.past && <details className={styles.assumptions}><summary>Conferir projeção</summary><ul><li>Saldo sem entradas previstas: {m(dashboard.view.conservativeForecast.end)}.</li><li>Menor saldo previsto: {m(dashboard.view.forecast.minimum)} em {dateLabel(dashboard.view.forecast.minimumOn)}.</li>{dashboard.planning>0 && <li>Planejamento ainda reservado: {m(dashboard.planning)}.</li>}{dashboard.view.unknownCredit>0 && <li>Há limite de crédito não informado. Crédito não entra nesta projeção.</li>}{dashboard.view.issues.map((issue,i)=><li key={i}>{hidden ? 'Mostre os valores para conferir esta observação.' : issue}</li>)}</ul></details>}
        </section>
      </div>

      <section className={`${styles.panel} ${styles.billStrip}`} aria-label="Faturas compactas"><div className={styles.billHeading}><p>Faturas</p><strong data-testid="bills-total">{m(Math.round(dashboard.bills.remaining*100))}</strong></div><div className={styles.bills}>{dashboard.bills.cards.map(card=><button type="button" key={card.id} className={styles.bill} onClick={()=>setDialog(card.id)} disabled={hidden} aria-label={`Ver fatura ${card.title}`}><BankMark name={card.institution || card.name} third={card.thirdParty}/><div><strong>{card.title}</strong><small>{card.bills.length ? card.bills.length===1 ? `Vence ${dateLabel(card.bills[0].due_date).slice(0,5)}` : `${card.bills.length} vencimentos` : 'Sem fatura no mês'}</small></div><span className={styles.billPrice}>{m(Math.round(card.remaining*100))}</span><ChevronRight size={13}/></button>)}{dashboard.bills.cards.length===0 && <p className={styles.empty}>Nenhum cartão cadastrado.</p>}</div><button type="button" className={styles.textButton} onClick={()=>setDialog('manage')} disabled={hidden}>Gerenciar<ChevronRight size={13}/></button></section>

      <div className={styles.middleGrid}>
        <section className={styles.panel} aria-label="Distribuição dos gastos"><div className={styles.panelHead}><div><h2>Para onde vai seu dinheiro</h2><p className={styles.sectionHint}>Realizado + compromissos de {monthLabel(month)}</p></div><span className={styles.tinyLink}><Info size={13}/></span></div>
          <div className={styles.donutWrap}><div className={styles.donut}>{dashboard.spending.total>0 ? <ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart><Pie data={dashboard.spending.groups.filter(g=>g.amount>0)} dataKey="amount" nameKey="name" innerRadius="70%" outerRadius="88%" paddingAngle={3} stroke="none" isAnimationActive={false}>{dashboard.spending.groups.filter(g=>g.amount>0).map(g=><Cell key={g.id} fill={g.color}/>)}</Pie><Tooltip formatter={v=>m(Number(v))} contentStyle={{borderRadius:12,fontSize:10,border:'1px solid #e9ecf1'}}/></PieChart></ResponsiveContainer> : <div style={{width:140,height:140,border:'18px solid #eceff5',borderRadius:'50%',position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)'}}/>}<div className={styles.donutCenter}><small>NO MÊS</small><strong>{m(dashboard.spending.total)}</strong></div></div><div className={styles.legend}>{dashboard.spending.groups.map(g=><div key={g.id}><div className={styles.legendLabel}><i className={styles.dot} style={{background:g.color}}/>{g.name}</div><div className={styles.legendValue}>{m(g.amount)}<span>{pct(g.percent)}</span></div></div>)}</div></div>
          <div className={styles.cost}><Home size={18} className={styles.neutral}/><div><p>Custo essencial para viver</p><small>{dashboard.cost.basis==='average' ? `Média de ${dashboard.cost.months} meses encerrados` : dashboard.cost.basis==='current' ? 'Essenciais cadastrados neste mês · sem média histórica' : 'Sem base de despesas essenciais'}</small></div><strong>{m(dashboard.cost.average)}</strong></div>
        </section>
        <div className={styles.rightStack}>
          <section className={styles.panel} aria-label="Empréstimos"><div className={styles.panelHead}><h2>Empréstimos</h2><HandCoins size={17} className={styles.tinyLink}/></div><div className={styles.twoStats}><div><small>Emprestado a receber</small><strong className={styles.green}>{m(dashboard.lent)}</strong></div><div><small>Empréstimos a pagar</small><strong>{m(dashboard.debts.borrowed)}</strong></div></div>{dashboard.loans.length>0 && <div className={styles.loansList}>{dashboard.loans.slice(0,3).map(l=><p key={str(l.id)}><span>{str(l.borrower)}</span><strong>{m(Math.round(Number(l.remaining_amount)*100))}</strong></p>)}</div>}<p className={styles.loansFooter}><Link className={styles.tinyLink} href="/dividas/valores-a-receber">Ver valores a receber<ChevronRight size={12}/></Link></p></section>
          <section className={styles.panel} aria-label="Investimentos"><div className={styles.panelHead}><h2>Investimentos</h2><TrendingUp size={17} className={styles.green}/></div><div className={styles.investmentTop}><div><small>Patrimônio investido</small><strong>{m(dashboard.investments.total)}</strong></div><div className={styles.investmentReturn}><small>Rendimento registrado</small><strong className={dashboard.investments.gain!=null && dashboard.investments.gain<0 ? styles.red : styles.green}>{m(dashboard.investments.gain)}</strong><small>{pct(dashboard.investments.percent)}</small></div></div><div className={styles.investmentMeta}><span>Capital aplicado <strong>{m(dashboard.investments.principal)}</strong></span><Link href="/contas" className={styles.textButton}>Ver aplicações<ChevronRight size={12}/></Link></div><div className={styles.investmentItems}>{dashboard.investments.positions.map(p=><p key={p.id}><span>{p.name}</span><strong>{m(p.value)}</strong></p>)}{dashboard.investments.positions.length===0 && <p>Nenhuma aplicação ativa cadastrada.</p>}</div><details className={styles.cdi}><summary><span><SlidersHorizontal size={11} style={{display:'inline',marginRight:5}}/>Referência de rendimento</span><span className={`${styles.tag} ${styles.neutral}`}>Em breve</span></summary><div className={styles.cdiFields}><label>Índice de referência<input disabled value="CDI" readOnly/></label><label>% do CDI<input disabled value="—" readOnly/></label></div><p className={styles.cdiNote}>Espaço preparado para acompanhar aplicações por percentual do CDI. O acompanhamento automático ainda não está ativo.</p></details></section>
        </div>
      </div>

      <section className={`${styles.panel} ${styles.debtSection}`} aria-label="Detalhamento das dívidas"><div className={styles.panelHead}><div><h2>Suas dívidas, com clareza</h2><p className={styles.sectionHint}>Valores registrados e encargos calculados até hoje</p></div><label className={styles.tinyLink}><input type="checkbox" checked={showPaid} onChange={e=>setShowPaid(e.target.checked)}/>Incluir quitadas</label></div>
        <div className={styles.debtSummary}><div><small>Total a pagar</small><strong>{m(dashboard.debts.remaining)}</strong></div><div><small>Total já pago</small><strong className={styles.green}>{m(dashboard.debts.paid)}</strong></div><div><small>Parcelas cadastradas</small><strong>{m(dashboard.debts.installmentTotal)}</strong></div><div className={styles.debtProgress}><small>{pct(dashboard.debts.progress)} quitado · base: pago + saldo</small><div className={styles.progress}><i style={{width:dashboard.debts.progress+'%'}}/></div></div></div>
        <div className={styles.debtTable}><div className={styles.debtColumns} aria-hidden="true"><span>Dívida / credor</span><span>Valor original</span><span>Parcela</span><span>Já pago</span><span>A pagar / progresso</span><span/></div>{visibleDebts.map(d=><details key={d.id} className={styles.debtRow}><summary><span><strong>{d.name}</strong><small>{d.description}</small></span><span>{m(d.original)}</span><span>{d.installment>0 ? m(d.installment) : 'A definir'}</span><span>{m(d.paid)}</span><span><strong>{m(d.remaining)}</strong><small>{pct(d.progress)} pago</small><span className={styles.progress} style={{display:'block'}}><i style={{width:d.progress+'%'}}/></span></span><ChevronDown size={13}/></summary><dl className={styles.debtBreakdown}><div><dt>Valor original</dt><dd>{m(d.original)}</dd></div><div><dt>Valor da parcela</dt><dd>{d.installment>0 ? m(d.installment) : 'A definir'}</dd></div><div><dt>Já pago</dt><dd>{m(d.paid)}</dd></div><div><dt>Falta pagar</dt><dd>{m(d.remaining)} · {pct(100-d.progress)}</dd></div><div><dt>Parcelas pagas / total</dt><dd>{hidden ? '•••' : d.totalInstallments ? `${d.paidInstallments ?? 0} / ${d.totalInstallments}` : 'Não informado'}</dd></div><div><dt>Juros e encargos projetados</dt><dd>{m(d.charges)}</dd></div><div><dt>Crescimento por dia</dt><dd>{m(d.dailyGrowth)}</dd></div><div><dt>Vencimento cadastrado</dt><dd>{dateLabel(d.due)}</dd></div></dl></details>)}{visibleDebts.length===0 && <p className={styles.empty}>Nenhuma dívida nesta seleção.</p>}</div><div className={styles.debtBottom}><span>{debtRows.length} {debtRows.length===1 ? 'dívida' : 'dívidas'} · faturas dos cartões aparecem separadamente</span>{debtRows.length>5 ? <button type="button" className={styles.textButton} onClick={()=>setShowAllDebts(v=>!v)}>{showAllDebts ? 'Mostrar menos' : 'Ver todas as dívidas'}<ChevronDown size={13}/></button> : <Link href="/dividas" className={styles.textButton}>Gerenciar<ChevronRight size={12}/></Link>}</div>
      </section>

      <section className={`${styles.panel} ${styles.annual}`} aria-label="Visão anual"><div className={styles.panelHead}><div><h2>Seu dinheiro ao longo do ano</h2><p className={styles.sectionHint}>Entradas e saídas realizadas + previstas</p></div><label><span className={styles.screenReader}>Ano da visão anual</span><select aria-label="Ano da visão anual" className={styles.smallSelect} value={year} onChange={e=>setYear(Number(e.target.value))}>{yearOptions.map(y=><option key={y} value={y}>{y}</option>)}</select></label></div><div className={styles.annualChart}><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={annual} margin={{top:15,right:8,bottom:0,left:0}}><CartesianGrid vertical={false} stroke="#eff1f5"/><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#84909e'}}/><YAxis axisLine={false} tickLine={false} tick={{fontSize:9,fill:'#84909e'}} width={48} tickFormatter={v=>hidden ? '•••' : new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:0}).format(Number(v))}/><Tooltip content={({active,payload})=>active && payload?.length ? <AnnualTooltip point={payload[0].payload as ReturnType<typeof annualDashboard>[number]} money={m}/> : null} cursor={{fill:'#f2f3f8'}}/><Bar dataKey="incoming" name="Entradas" fill="#6558e8" radius={[4,4,0,0]} maxBarSize={19} isAnimationActive={false}/><Bar dataKey="outgoing" name="Saídas" fill="#aeb8cb" radius={[4,4,0,0]} maxBarSize={19} isAnimationActive={false}/></BarChart></ResponsiveContainer></div><div className={styles.chartKeys}><span><i className={styles.dot} style={{background:'#6558e8'}}/>Entradas</span><span><i className={styles.dot} style={{background:'#aeb8cb'}}/>Saídas</span></div><p className={styles.chartNote}><Info size={13}/><span>Realizado pela data do pagamento + pendências pelo vencimento. Passe sobre as barras para conferir cada parte.{annual.some(p=>p.estimatedOut>0) ? ' O histórico inclui ajustes estimados identificados no detalhamento.' : ''}</span></p></section>

      <section className={`${styles.panel} ${styles.upcoming}`} aria-label="Próximos compromissos"><div className={styles.panelHead}><h2>No seu radar</h2><span className={styles.tinyLink}>A receber e a pagar no mês</span></div><div className={styles.upcomingGrid}>{dashboard.next.slice(0,6).map(i=><div key={i.id} className={styles.upcomingItem}><span className={styles.day}>{i.due?.slice(8,10)}<small>{i.due?.slice(5,7)}</small></span><div className={styles.upcomingName}><strong title={i.name}>{i.name}</strong><span className={i.direction==='in' ? styles.green : ''}>{i.direction==='in' ? '+ ' : ''}{m(i.amount)}</span><small>{i.direction==='in' ? 'A receber' : i.due && i.due<today() ? 'Em atraso' : 'A pagar'}</small></div></div>)}{dashboard.next.length===0 && <p className={styles.empty}>Nenhum compromisso pendente neste mês.</p>}</div></section>
      <div className={styles.footer}><span>Atualizado às {snapshot.loadedAt}{loading ? ' · Atualizando…' : ''}</span><span>Valores baseados nos seus registros.</span></div>
      {selectedCard && !hidden && <Dialog title={`Fatura ${selectedCard.title} · ${monthLabel(month)}`} close={close}><InvoiceDetails card={selectedCard} transactions={snapshot.data.transactions} money={m}/></Dialog>}
      {dialog==='manage' && !hidden && <Dialog title="Gerenciar faturas" close={close}><CardBillsPanel/></Dialog>}
    </>}
  </div>;
}
