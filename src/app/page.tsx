"use client";

import { useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Wallet, AlertCircle, Clock, Receipt, X } from "lucide-react";
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
  const [contaSelecionada, setContaSelecionada] = useState<any>(null);

  const mockTransacoes = [
    { id: "m1", tipo: "receita", valor: 5800, status: "Pago", categoria: "Serviços", nome: "Cliente A", descricao: "Projeto mensal", data_competencia: "2026-07-01", data_pagamento: "2026-07-01", data_vencimento: "2026-07-05" },
    { id: "m2", tipo: "despesa", valor: 1420, status: "Pago", categoria: "Despesas", nome: "Fornecedor", descricao: "Conta de internet", data_competencia: "2026-07-03", data_pagamento: "2026-07-03", data_vencimento: "2026-07-03" },
    { id: "m3", tipo: "receita", valor: 3200, status: "Pendente", categoria: "Serviços", nome: "Cliente B", descricao: "Prestação de serviço", data_competencia: "2026-07-09", data_pagamento: null, data_vencimento: "2026-07-15" },
    { id: "m4", tipo: "despesa", valor: 890, status: "Pendente", categoria: "Diversão", nome: "Ads", descricao: "Campanha", data_competencia: "2026-07-10", data_pagamento: null, data_vencimento: "2026-07-20" },
    { id: "m5", tipo: "receita", valor: 1800, status: "Recebido", categoria: "Serviços", nome: "Cliente C", descricao: "Reembolso", data_competencia: "2026-06-22", data_pagamento: "2026-06-22", data_vencimento: "2026-06-22" },
    { id: "m6", tipo: "despesa", valor: 560, status: "Pago", categoria: "Educação", nome: "Estado", descricao: "ISS", data_competencia: "2026-06-18", data_pagamento: "2026-06-18", data_vencimento: "2026-06-18" },
    { id: "m7", tipo: "despesa", valor: 780, status: "Pendente", categoria: "Empréstimo", nome: "Banco", descricao: "Parcela", data_competencia: "2026-07-12", data_pagamento: null, data_vencimento: "2026-07-25" },
    { id: "m8", tipo: "despesa", valor: 320, status: "Pago", categoria: "Alimentação", nome: "Super", descricao: "Compras do mês", data_competencia: "2026-07-04", data_pagamento: "2026-07-04", data_vencimento: "2026-07-04" },
    { id: "m9", tipo: "despesa", valor: 950, status: "Pago", categoria: "Investimento", nome: "Renda fixa", descricao: "Aplicação", data_competencia: "2026-07-06", data_pagamento: "2026-07-06", data_vencimento: "2026-07-06" },
    { id: "m10", tipo: "despesa", valor: 410, status: "Pendente", categoria: "Dívidas", nome: "Cartão", descricao: "Fatura", data_competencia: "2026-07-14", data_pagamento: null, data_vencimento: "2026-07-28" },
  ];

  const mockClientes = [
    { id: "c1", status: "Ativo" },
    { id: "c2", status: "Ativo" },
    { id: "c3", status: "Inativo" },
  ];

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
    
    const transacoesCarregadas = resTransacoes.data && resTransacoes.data.length > 0 ? resTransacoes.data : mockTransacoes;
    const clientesCarregados = resClientes.data && resClientes.data.length > 0 ? resClientes.data : mockClientes;

    setTransacoes(transacoesCarregadas as any[]);
    setClientesBase(clientesCarregados as any[]);
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
  const margemLucro = entrada > 0 ? ((entrada - saida) / entrada) * 100 : 0;

  const categoriasObjetivo = ['alimentação', 'empréstimo', 'dívidas', 'despesas', 'investimento', 'educação', 'diversão'];
  const gastosPorCategoria = categoriasObjetivo.reduce((acc, cat) => ({ ...acc, [cat]: 0 }), {} as Record<string, number>);

  transacoes.forEach(t => {
    if (t.tipo !== 'despesa') return;
    const categoriaNormalizada = String(t.categoria || '').trim().toLowerCase();
    const mapaCategoria = {
      'alimentação': 'alimentação',
      'alimento': 'alimentação',
      'comida': 'alimentação',
      'emprestimo': 'empréstimo',
      'empréstimo': 'empréstimo',
      'divida': 'dívidas',
      'dívida': 'dívidas',
      'dividas': 'dívidas',
      'despesa': 'despesas',
      'despesas': 'despesas',
      'investimento': 'investimento',
      'investir': 'investimento',
      'educação': 'educação',
      'educacao': 'educação',
      'curso': 'educação',
      'diversao': 'diversão',
      'lazer': 'diversão',
      'entretenimento': 'diversão',
    } as Record<string, string>;

    const categoriaFinal = mapaCategoria[categoriaNormalizada] || 'despesas';
    gastosPorCategoria[categoriaFinal] = (gastosPorCategoria[categoriaFinal] || 0) + Number(t.valor || 0);
  });

  const dadosGastosCategorias = categoriasObjetivo.map(cat => ({ name: cat, value: gastosPorCategoria[cat] || 0 })).filter(d => d.value > 0);
  const dadosPerformance = meses.map(m => graficoMap[m] || { name: m, Entrada: 0, Saida: 0 });
  const CORES_PIE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
  const dadosCategorias = Object.keys(despesasPorCategoria).map(key => ({ name: key, value: despesasPorCategoria[key] })).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  
  const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const formatarEixoY = (v: number) => new Intl.NumberFormat('pt-BR', { notation: "compact", compactDisplay: "short" }).format(v);
  const abrirConta = (conta: any) => setContaSelecionada(conta);
  const fecharConta = () => setContaSelecionada(null);
  const alternarStatusConta = (id: string, novoStatus: string) => {
    setTransacoes(prev => prev.map(item => item.id === id ? { ...item, status: novoStatus } : item));
    setContaSelecionada((prev: any) => prev ? { ...prev, status: novoStatus } : prev);
  };

  if (!montado) return null;

  const cardEstilo = "bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex flex-col";

  return (
    <div className="space-y-6 font-sans pb-10">
      <header className="flex justify-end mb-2">
        <select className="p-2.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm text-gray-700 font-medium transition-all" value={filtroPeriodo} onChange={(e) => setFiltroPeriodo(e.target.value)}>
          <option value="hoje">Hoje</option>
          <option value="semana">Esta Semana</option>
          <option value="mes">Este Mês</option>
          <option value="tudo">Todo o Período</option>
        </select>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className={cardEstilo}>
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-medium text-gray-600">Entradas</span><ArrowUpCircle className="text-green-500" size={20} /></div>
          <h3 className="text-3xl font-semibold text-gray-900 tracking-tight">{formatarMoeda(entrada)}</h3>
        </div>
        <div className={cardEstilo}>
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-medium text-gray-600">Saídas</span><ArrowDownCircle className="text-red-500" size={20} /></div>
          <h3 className="text-3xl font-semibold text-gray-900 tracking-tight">{formatarMoeda(saida)}</h3>
        </div>
        <div className={cardEstilo}>
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-medium text-gray-600">Caixa</span><Wallet className="text-blue-600" size={20} /></div>
          <h3 className={`text-3xl font-semibold tracking-tight ${saldo >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatarMoeda(saldo)}</h3>
        </div>
        <div className={`${cardEstilo} bg-emerald-50 border-emerald-200`}>
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-medium text-emerald-700">A receber (Mês seguinte)</span><Receipt className="text-emerald-600" size={20} /></div>
          <h3 className="text-3xl font-semibold text-emerald-900 tracking-tight tabular-nums">{formatarMoeda(aReceberProximoMes)}</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className={`${cardEstilo} xl:col-span-2`}>
          <h2 className="text-base font-semibold text-gray-900 mb-6">Fluxo de Caixa Mensal</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dadosPerformance} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} tickFormatter={formatarEixoY} />
                <RechartsTooltip cursor={{ fill: '#f3f4f6' }} contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', fontSize: '13px' }} />
                <Bar dataKey="Entrada" fill="#10b981" radius={[4, 4, 0, 0]} barSize={16} />
                <Bar dataKey="Saida" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={cardEstilo}>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Distribuição de Gastos</h2>
          {dadosGastosCategorias.length > 0 ? (
            <div className="flex-1 flex flex-col justify-center items-center mt-4">
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={dadosGastosCategorias} innerRadius={55} outerRadius={75} paddingAngle={2} dataKey="value" stroke="none">
                      {dadosGastosCategorias.map((_, index) => (<Cell key={`cell-${index}`} fill={CORES_PIE[index % CORES_PIE.length]} />))}
                    </Pie>
                    <RechartsTooltip formatter={(value: any) => formatarMoeda(Number(value))} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '13px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full mt-6 space-y-3">
                {dadosGastosCategorias.map((cat, i) => {
                  const totalGasto = Object.values(gastosPorCategoria).reduce((acc, cur) => acc + cur, 0);
                  const porcentagem = totalGasto > 0 ? ((cat.value / totalGasto) * 100).toFixed(1) : '0.0';
                  return (
                    <div key={i} className="flex justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CORES_PIE[i % CORES_PIE.length] }}></div>
                        <span className="text-gray-600 capitalize">{cat.name}</span>
                      </div>
                      <span className="font-medium text-gray-900">{porcentagem}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (<div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Dados insuficientes.</div>)}
        </div>
      </div>

      <div className={`${cardEstilo} justify-start`}>
        <div className="flex items-center gap-2 mb-6"><AlertCircle className="text-gray-500" size={18} strokeWidth={2.5}/><h2 className="text-base font-semibold text-gray-900">Contas Pendentes</h2></div>
        <div className="space-y-3">
          {lembretes.length > 0 ? lembretes.map(l => {
            const vencido = isAfter(hoje, getSafeDate(l.data_vencimento));
            return (
              <button type="button" onClick={() => abrirConta(l)} key={l.id} className="flex w-full items-center justify-between p-3.5 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-all group cursor-pointer text-left">
                <div className="flex items-center gap-4">
                  <div className={`w-2 h-2 rounded-full ${vencido ? 'bg-red-500' : 'bg-amber-400'}`}></div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm group-hover:text-blue-700">{l.nome || l.descricao}</p>
                    <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5 uppercase tracking-wide"><Clock size={10} /> Vencimento: {format(getSafeDate(l.data_vencimento), 'dd/MM/yyyy')}</div>
                  </div>
                </div>
                <div className="text-right flex items-center gap-3">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{formatarMoeda(l.valor)}</p>
                    {vencido ? (<span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Atrasado</span>) : (<span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Aguardando</span>)}
                  </div>
                  <Wallet size={16} className="text-gray-400 group-hover:text-blue-600" />
                </div>
              </button>
            )
          }) : (<div className="text-center text-gray-400 py-6 text-sm">Sem pendências registradas.</div>)}
        </div>
      </div>

      {contaSelecionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{contaSelecionada.nome || contaSelecionada.descricao}</h3>
                <p className="mt-1 text-sm text-gray-600">{contaSelecionada.descricao || 'Detalhes da conta pendente'}</p>
              </div>
              <button type="button" onClick={fecharConta} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 space-y-3 text-sm text-gray-700">
              <div className="flex justify-between"><span className="text-gray-500">Valor</span><span className="font-semibold text-gray-900">{formatarMoeda(Number(contaSelecionada.valor || 0))}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Vencimento</span><span className="font-semibold text-gray-900">{format(getSafeDate(contaSelecionada.data_vencimento), 'dd/MM/yyyy')}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Categoria</span><span className="font-semibold text-gray-900">{contaSelecionada.categoria || 'Sem categoria'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Status</span><span className={`font-semibold ${contaSelecionada.status?.toLowerCase() === 'pago' || contaSelecionada.status?.toLowerCase() === 'recebido' ? 'text-emerald-600' : 'text-amber-600'}`}>{contaSelecionada.status || 'Pendente'}</span></div>
            </div>

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => alternarStatusConta(contaSelecionada.id, contaSelecionada.status?.toLowerCase() === 'pago' || contaSelecionada.status?.toLowerCase() === 'recebido' ? 'Pendente' : 'Pago')} className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700">
                {contaSelecionada.status?.toLowerCase() === 'pago' || contaSelecionada.status?.toLowerCase() === 'recebido' ? 'Marcar como pendente' : 'Marcar como pago'}
              </button>
              <button type="button" onClick={fecharConta} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


