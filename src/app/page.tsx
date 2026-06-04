"use client";

import { useEffect, useState } from "react";
// AJUSTE: Link importado para tornar itens clicáveis
import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Wallet, Users, AlertCircle, Clock, HeartPulse, Receipt } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, PieChart, Pie, Cell } from "recharts";
import { supabase } from "@/lib/supabase";
import { format, isAfter, isSameMonth, isSameWeek, isToday, parseISO, addMonths } from "date-fns";

export default function DashboardPage() {
  const [montado, setMontado] = useState(false);
  const [transacoes, setTransacoes] = useState<any[]>([]);
  const [clientesBase, setClientesBase] = useState<any[]>([]);
  const [filtroPeriodo, setFiltroPeriodo] = useState("mes");
  const [userName, setUserName] = useState("Sócio"); 
  const [taxaImposto, setTaxaImposto] = useState(0.155);

  useEffect(() => {
    setMontado(true);
    carregarDados();
  }, []);

  async function carregarDados() {
    const [resTransacoes, resClientes, resSession, resConfig] = await Promise.all([
      supabase.from('transacoes').select('*'),
      supabase.from('clientes').select('id, status'),
      supabase.auth.getSession(),
      supabase.from('configuracoes_sistema').select('imposto_simples_nacional_percentual').eq('id', 1).single()
    ]);
    
    if (resTransacoes.data) setTransacoes(resTransacoes.data);
    if (resClientes.data) setClientesBase(resClientes.data);
    if (resConfig.data) setTaxaImposto(Number(resConfig.data.imposto_simples_nacional_percentual) / 100);

    let nomeReal = "Sócio";
    if (resSession.data.session) {
      const { data: perfil } = await supabase.from('perfis').select('nome').eq('id', resSession.data.session.user.id).single();
      if (perfil?.nome) {
        nomeReal = perfil.nome.split(' ')[0];
        setUserName(nomeReal);
      }
    }

    if ('speechSynthesis' in window) {
      const agora = Date.now();
      const ultimo = localStorage.getItem('jarvis_last_speak');
      const quatroHoras = 1000 * 60 * 60 * 4;

      if (!ultimo || (agora - parseInt(ultimo)) > quatroHoras) {
        const msg = new SpeechSynthesisUtterance(`Bem-vindo de volta, ${nomeReal}. Este é seu resumo financeiro!`);
        msg.lang = 'pt-BR';
        msg.rate = 1.0; 
        window.speechSynthesis.speak(msg);
        localStorage.setItem('jarvis_last_speak', agora.toString());
      }
    }
  }

  const getSafeDate = (dateStr: any) => {
    try { return dateStr ? parseISO(dateStr) : new Date(); } catch { return new Date(); }
  };

  const hoje = new Date();
  const proximoMes = addMonths(hoje, 1);
  
  const dadosFiltrados = transacoes.filter(t => {
    if (filtroPeriodo === "tudo") return true;
    const dataRef = getSafeDate(t.data_competencia);
    if (filtroPeriodo === "hoje") return isToday(dataRef);
    if (filtroPeriodo === "semana") return isSameWeek(dataRef, hoje);
    if (filtroPeriodo === "mes") return isSameMonth(dataRef, hoje);
    return true;
  });

  let entrada = 0; let saida = 0;
  let pagamentosEmDia = 0; let pagamentosAtrasados = 0;
  let aReceberProximoMes = 0; 
  
  const despesasPorCategoria: Record<string, number> = {};
  const graficoMap: Record<string, any> = {};
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  const lembretes = transacoes
    .filter(t => t.status?.toLowerCase() === 'pendente')
    .sort((a, b) => getSafeDate(a.data_vencimento).getTime() - getSafeDate(b.data_vencimento).getTime())
    .slice(0, 5);

  dadosFiltrados.forEach(t => {
    const valor = Number(t.valor) || 0;
    const statusPago = t.status?.toLowerCase() === 'pago' || t.status?.toLowerCase() === 'recebido';
    
    if (statusPago) {
      if (t.tipo === 'receita') entrada += valor;
      if (t.tipo === 'despesa') {
        saida += valor;
        const cat = t.categoria || 'Despesas';
        despesasPorCategoria[cat] = (despesasPorCategoria[cat] || 0) + valor;
      }
      
      const dataPagamentoReal = t.data_pagamento || t.data_competencia;
      const mesIdx = getSafeDate(dataPagamentoReal).getMonth();
      const nomeMes = meses[mesIdx];
      if (!graficoMap[nomeMes]) graficoMap[nomeMes] = { name: nomeMes, Entrada: 0, Saida: 0 };
      if (t.tipo === 'receita') graficoMap[nomeMes].Entrada += valor;
      if (t.tipo === 'despesa') graficoMap[nomeMes].Saida += valor;
    }

    if (t.tipo === 'receita') {
      if (statusPago) pagamentosEmDia++;
      if ((t.status?.toLowerCase() === 'pendente' || t.status?.toLowerCase() === 'atrasado') && isAfter(hoje, getSafeDate(t.data_vencimento))) pagamentosAtrasados++;
    }
  });

  transacoes.forEach(t => {
    if (t.tipo === 'receita' && t.status?.toLowerCase() === 'pendente') {
      if (isSameMonth(getSafeDate(t.data_vencimento), proximoMes)) {
        aReceberProximoMes += Number(t.valor) || 0;
      }
    }
  });

  const saldo = entrada - saida;
  const impostoEstimado = entrada * taxaImposto;
  const margemLucro = entrada > 0 ? ((entrada - saida) / entrada) * 100 : 0;
  
  const totalClientesAtivos = clientesBase.filter(c => c.status?.toLowerCase() === 'ativo').length;
  
  let corSaude = "bg-[#0097a7]"; let textoSaude = "Lucrativo";
  if (margemLucro < 20 && margemLucro >= 0) { corSaude = "bg-[#ffab40]"; textoSaude = "Margem Baixa"; }
  if (margemLucro < 0) { corSaude = "bg-red-500"; textoSaude = "Prejuízo"; }

  const dadosPerformance = meses.map(m => graficoMap[m] || { name: m, Entrada: 0, Saida: 0 });
  const CORES_PIE = ['#0a003d', '#ffab40', '#0097a7', '#4b5563', '#9ca3af', '#d1d5db', '#1f2937'];
  const dadosCategorias = Object.keys(despesasPorCategoria).map(key => ({ name: key, value: despesasPorCategoria[key] })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  
  const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const formatarEixoY = (v: number) => new Intl.NumberFormat('pt-BR', { notation: "compact", compactDisplay: "short" }).format(v);

  if (!montado) return null;

  const cardEstilo = "bg-white p-6 rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col";

  return (
    <div className="space-y-6 font-sans pb-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Resumo Financeiro</h1>
          <p className="text-gray-500 text-sm mt-1">Bem-vindo de volta, {userName}. Este é seu resumo financeiro!</p>
        </div>
        <select className="p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white shadow-sm text-gray-700 font-medium transition-all" value={filtroPeriodo} onChange={(e) => setFiltroPeriodo(e.target.value)}>
          <option value="hoje">Hoje</option>
          <option value="semana">Esta Semana</option>
          <option value="mes">Este Mês</option>
          <option value="tudo">Todo o Período</option>
        </select>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
        <div className={cardEstilo}>
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-medium text-gray-500">Receita Gerada</span><ArrowUpCircle className="text-[#0097a7]" size={20} /></div>
          <h3 className="text-3xl font-semibold text-gray-900 tracking-tight">{formatarMoeda(entrada)}</h3>
        </div>
        <div className={cardEstilo}>
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-medium text-gray-500">Saídas</span><ArrowDownCircle className="text-red-500" size={20} /></div>
          <h3 className="text-3xl font-semibold text-gray-900 tracking-tight">{formatarMoeda(saida)}</h3>
        </div>
        <div className={cardEstilo}>
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-medium text-gray-500">Caixa</span><Wallet className="text-[#0a003d]" size={20} /></div>
          <h3 className={`text-3xl font-semibold tracking-tight ${saldo >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatarMoeda(saldo)}</h3>
        </div>
        <div className={`${cardEstilo} bg-emerald-50 border-emerald-100`}>
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-medium text-emerald-800">A receber (Mês seguinte)</span><Receipt className="text-emerald-600" size={20} /></div>
          <h3 className="text-3xl font-semibold text-emerald-900 tracking-tight tabular-nums">{formatarMoeda(aReceberProximoMes)}</h3>
        </div>
        <div className={cardEstilo}>
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-medium text-gray-500">Clientes</span><Users className="text-[#ffab40]" size={20} /></div>
          <h3 className="text-3xl font-semibold text-gray-900 tracking-tight">{totalClientesAtivos}</h3>
          <p className="text-xs text-gray-500 mt-2 font-medium"><span className="text-emerald-600">{pagamentosEmDia} em dia</span> | <span className="text-red-500">{pagamentosAtrasados} atrasos</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className={`${cardEstilo} xl:col-span-2`}>
          <h2 className="text-base font-semibold text-gray-900 mb-6">Fluxo de Caixa Mensal</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dadosPerformance} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={formatarEixoY} />
                <RechartsTooltip cursor={{ fill: '#f9fafb' }} contentStyle={{ borderRadius: '8px', border: '1px solid #f3f4f6', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', fontSize: '13px' }} />
                <Bar dataKey="Entrada" fill="#0097a7" radius={[4, 4, 0, 0]} barSize={16} />
                <Bar dataKey="Saida" fill="#1f2937" radius={[4, 4, 0, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={cardEstilo}>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Distribuição de Custos</h2>
          {dadosCategorias.length > 0 ? (
            <div className="flex-1 flex flex-col justify-center items-center mt-4">
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={dadosCategorias} innerRadius={55} outerRadius={75} paddingAngle={2} dataKey="value" stroke="none">
                      {dadosCategorias.map((_, index) => (<Cell key={`cell-${index}`} fill={CORES_PIE[index % CORES_PIE.length]} />))}
                    </Pie>
                    <RechartsTooltip formatter={(value: any) => formatarMoeda(Number(value))} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '13px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full mt-6 space-y-3">
                {dadosCategorias.slice(0, 4).map((cat, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CORES_PIE[i % CORES_PIE.length] }}></div>
                      <span className="text-gray-500">{cat.name}</span>
                    </div>
                    <span className="font-medium text-gray-900">{formatarMoeda(cat.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (<div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Dados insuficientes.</div>)}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${cardEstilo} gap-6 lg:col-span-1 justify-start`}>
          <div>
            <div className="flex items-center gap-2 mb-3"><HeartPulse className="text-[#ffab40]" size={18} strokeWidth={2.5}/><h2 className="text-base font-semibold text-gray-900">Saúde do Negócio</h2></div>
            <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${corSaude} transition-all duration-1000`} style={{ width: `${Math.min(Math.max(margemLucro, 5), 100)}%` }}></div></div>
            <div className="flex justify-between mt-2 text-[13px] font-medium"><span className="text-gray-500">Margem: {margemLucro.toFixed(1)}%</span><span className={corSaude.replace('bg-', 'text-')}>{textoSaude}</span></div>
          </div>
          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center gap-2 mb-2"><Receipt className="text-[#0a003d]" size={18} strokeWidth={2.5} /><h2 className="text-base font-semibold text-gray-900">Total a Declarar</h2></div>
            <p className="text-[13px] text-gray-500 mb-4">Provisão base: {(taxaImposto * 100).toFixed(1)}%</p>
            <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl">
              <p className="text-2xl font-bold text-amber-600">{formatarMoeda(impostoEstimado)}</p>
            </div>
          </div>
        </div>
        <div className={`${cardEstilo} lg:col-span-2 justify-start`}>
          <div className="flex items-center gap-2 mb-6"><AlertCircle className="text-gray-400" size={18} strokeWidth={2.5}/><h2 className="text-base font-semibold text-gray-900">Radar de Contas (Pendentes)</h2></div>
          <div className="space-y-3">
            {lembretes.length > 0 ? lembretes.map(l => {
              const vencido = isAfter(hoje, getSafeDate(l.data_vencimento));
              return (
                // AJUSTE: Transformado div em LINK para navegar para registros passando o ID
                <Link href={`/registros?openId=${l.id}`} key={l.id} className="flex items-center justify-between p-3.5 border border-gray-100 rounded-xl hover:bg-amber-50 hover:border-amber-100 transition-all group cursor-pointer block">
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${vencido ? 'bg-red-500' : 'bg-amber-400'}`}></div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm group-hover:text-amber-900">{l.nome || l.descricao}</p>
                      <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5 uppercase tracking-wide"><Clock size={10} /> Vencimento: {format(getSafeDate(l.data_vencimento), 'dd/MM/yyyy')}</div>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{formatarMoeda(l.valor)}</p>
                      {vencido ? (<span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Atrasado</span>) : (<span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Aguardando</span>)}
                    </div>
                    {/* Ícone sutil para indicar que é clicável no hover */}
                    <Wallet size={16} className="text-gray-300 group-hover:text-amber-500" />
                  </div>
                </Link>
              )
            }) : (<div className="text-center text-gray-400 py-6 text-sm">Sem pendências registradas.</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
