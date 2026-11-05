'use client';
import {useId,useState} from 'react';
import {ArrowUpRight,Bookmark,ChevronDown,Maximize2} from 'lucide-react';
import {currency,dateLabel} from '@/lib/family-finance';
import type {ChatCard} from '@/lib/chat-workspace';
import s from './chat.module.css';
const COLORS=['#C8A15A','#0D1B2A','#4C827D','#829BB2','#C4A494','#8F859F','#CBD0D5'];
export function ChatVisuals({cards,onSave,onAsk}:{cards:ChatCard[];onSave?:(i:number)=>void;onAsk?:(text:string)=>void}){
 const [expanded,setExpanded]=useState<number|null>(null);
 return <div className={s.visuals}>{cards.map((card,i)=><article className={s.card} key={`${card.kind}-${card.period}-${i}`}>
  <header className={s.cardHeader}><div><span className={s.eyebrow}>{card.kind==='goal'||card.kind==='scenarios'?'Simulação':'Seus registros'} · {card.period}</span><h3>{card.title}</h3></div><button className={s.icon} aria-label={expanded===i?'Recolher gráfico':'Ampliar detalhes do gráfico'} onClick={()=>setExpanded(expanded===i?null:i)}><Maximize2 size={17}/></button></header>
  {card.goal&&<><div className={s.goalValue}>{currency(card.goal.saved)} <span>de {currency(card.goal.target)}</span></div><div className={s.progress} role="progressbar" aria-label="Progresso da meta" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(card.goal.progress)}><i style={{width:`${Math.min(100,Math.max(0,card.goal.progress))}%`}}/></div><div className={s.goalMeta}><span>{card.goal.progress.toFixed(0)}% reservado</span><span>Até {dateLabel(card.goal.deadline)}</span></div><div className={s.goalSummary}><div><span>Falta reservar</span><strong>{currency(card.goal.remaining)}</strong></div><div><span>Por aporte ({card.goal.months}x)</span><strong>{currency(card.goal.monthly)}</strong></div></div></>}
  {card.kind==='categories'&&<Donut rows={card.rows??[]}/>}
  {card.points&&card.points.length>0&&<Line points={card.points}/>}
  {card.rows&&<div className={s.cardRows}>{card.rows.slice(0,expanded===i?10000:card.kind==='categories'?5:8).map((row,j)=><div className={s.cardRow} key={j}><div><span>{row.label}</span>{row.detail&&<small>{row.detail}</small>}</div><strong className={row.value<0?s.negative:undefined}>{currency(row.value)}{card.kind==='invoices'&&row.secondary!==undefined&&<small>Total {currency(row.secondary??0)}</small>}</strong></div>)}{card.rows.length===0&&<p className={s.muted}>Não há registros para mostrar neste período.</p>}{expanded!==i&&card.rows.length>(card.kind==='categories'?5:8)&&<button className={s.textButton} onClick={()=>setExpanded(i)}>Ver todos os itens</button>}</div>}
  {onSave&&card.kind==='goal'&&<button className={s.secondary} onClick={()=>onSave(i)}><Bookmark size={16}/> Salvar este plano</button>}
  {onAsk&&(card.kind==='goal'||card.kind==='scenarios')&&<button className={s.textButton} onClick={()=>onAsk(card.kind==='goal'?`Compare alternativas para o plano “${card.title}”, considerando os compromissos e as receitas incertas.`:'Como posso reduzir o impacto dessa compra nas minhas finanças?')}>Comparar alternativas <ArrowUpRight size={15}/></button>}
  <details className={s.assumptions} open={expanded===i||undefined}><summary>Dados e premissas <ChevronDown size={14}/></summary><p>{card.source} · consultado em {new Date(card.asOf).toLocaleString('pt-BR')}</p>{card.notes.map((n,j)=><p key={j}>{n}</p>)}</details>
 </article>)}</div>;
}
function Donut({rows}:{rows:NonNullable<ChatCard['rows']>}){
 const label=useId(),positive=rows.filter(r=>r.value>0),total=positive.reduce((n,r)=>n+r.value,0),segments=positive.slice(0,6);
 if(positive.length>6)segments.push({label:'Outras categorias',value:positive.slice(6).reduce((n,r)=>n+r.value,0)});
 let offset=0;
 return <div className={s.donutWrap}><svg viewBox="0 0 180 180" role="img" aria-labelledby={label} className={s.donut}><title id={label}>{`Distribuição dos gastos. Total ${currency(total)}. ${segments.map(r=>`${r.label}: ${currency(r.value)}`).join('; ')}`}</title><circle cx="90" cy="90" r="67" fill="none" stroke="#E8E6E0" strokeWidth="19"/>{segments.map((r,i)=>{const part=total?r.value/total*100:0,old=offset;offset+=part;return <circle key={i} cx="90" cy="90" r="67" fill="none" stroke={COLORS[i]} strokeWidth="19" pathLength="100" strokeDasharray={`${part} ${100-part}`} strokeDashoffset={-old} transform="rotate(-90 90 90)"/>;})}<text x="90" y="84" textAnchor="middle" fontSize="10" fill="#66717B">Total de gastos</text><text x="90" y="106" textAnchor="middle" fontSize="14" fontWeight="650" fill="#0D1B2A">{currency(total)}</text></svg><div className={s.legend}>{segments.map((r,i)=><span key={i}><i style={{background:COLORS[i]}}/>{r.label}<b>{total?(r.value/total*100).toFixed(0):0}%</b></span>)}</div></div>;
}
function Line({points}:{points:NonNullable<ChatCard['points']>}){
 const id=useId(),min=Math.min(0,...points.map(p=>p.value)),max=Math.max(1,...points.map(p=>p.value)),range=max-min;
 const coords=points.map((p,i)=>`${12+i/Math.max(points.length-1,1)*336},${115-(p.value-min)/range*99}`).join(' '),zero=115-(0-min)/range*99;
 return <div className={s.lineWrap}><svg viewBox="0 0 360 145" role="img" aria-labelledby={id}><title id={id}>Evolução do saldo projetado: {points.map(p=>`${dateLabel(p.label)}: ${currency(p.value)}`).join('; ')}</title><line x1="12" y1={zero} x2="348" y2={zero} stroke="#BFC5C9" strokeDasharray="4 4"/><polyline fill="none" stroke="#4C827D" strokeWidth="2.5" strokeLinejoin="round" points={coords}/><text x="12" y="138" fontSize="10" fill="#66717B">{dateLabel(points[0].label)}</text><text x="348" y="138" textAnchor="end" fontSize="10" fill="#66717B">{dateLabel(points.at(-1)!.label)}</text></svg></div>;
}
export function MessageText({text}:{text:string}){
 function inline(line:string){return line.split(/(\*\*[^*]+\*\*)/g).map((part,i)=>part.startsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part);}
 return <div className={s.prose}>{text.split(/\n\s*\n/).map((block,i)=>{const lines=block.split('\n');return <div key={i}>{lines.map((line,j)=>/^#{1,4}\s/.test(line)?<h3 key={j}>{inline(line.replace(/^#{1,4}\s/,''))}</h3>:/^[-*•]\s/.test(line)?<div className={s.bullet} key={j}><span aria-hidden>•</span><span>{inline(line.replace(/^[-*•]\s/,''))}</span></div>:<p key={j}>{inline(line)}</p>)}</div>;})}</div>;
}
