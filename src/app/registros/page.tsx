"use client";

import { useEffect, useState } from "react";
// AJUSTE: useSearchParams importado para ler a URL
import { useSearchParams } from "next/navigation";
import { Search, FileDown, User, Download, FileText, LayoutList, FolderOpen, ExternalLink, CalendarDays } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { TransactionFormModal } from "@/components/TransactionFormModal";
import { format, parseISO, isAfter } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function RegistrosPage() {
  const searchParams = useSearchParams();
  const [transacoes, setTransacoes] = useState<any[]>([]);
  const [busca, setBusca] = useState("");
  const [filtroPeriodo, setFiltroPeriodo] = useState("mes");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [modalAberto, setModalAberto] = useState(false);
  const [transacaoSelecionada, setTransacaoSelecionada] = useState<any>(null);
  const [modoVisualizacao, setModoVisualizacao] = useState<"lista" | "galeria">("lista");
  const [montado, setMontado] = useState(false);

  useEffect(() => { 
    carregarDados().then(() => setMontado(true)); 
  }, []);

  // AJUSTE: Efeito para ler URL e abrir modal automaticamente
  useEffect(() => {
    if (montado) {
      const openId = searchParams.get('openId');
      if (openId && transacoes.length > 0) {
        const tr = transacoes.find(t => t.id === openId);
        if (tr) {
          setTransacaoSelecionada(tr);
          setModalAberto(true);
        }
      }
    }
  }, [montado, searchParams, transacoes]);

  async function carregarDados() {
    const { data } = await supabase.from('transacoes').select('*').order('data_competencia', { ascending: false });
    if (data) setTransacoes(data);
  }

  function abrirModalParaCriar() {
    setTransacaoSelecionada(null);
    setModalAberto(true);
  }

  const formatarMoeda = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
  const hoje = new Date();
  
  const transacoesFiltradas = transacoes.filter(t => {
    if (busca && !t.descricao?.toLowerCase().includes(busca.toLowerCase()) && !t.nome?.toLowerCase().includes(busca.toLowerCase())) return false;
    if (filtroTipo !== "todos" && t.tipo !== filtroTipo) return false;
    if (filtroPeriodo === "tudo") return true;

    try {
      const dataRef = parseISO(t.data_competencia);
      const anoRef = dataRef.getFullYear();
      const mesRef = dataRef.getMonth();
      const anoHoje = hoje.getFullYear();
      const mesHoje = hoje.getMonth();

      if (filtroPeriodo === "mes") return anoRef === anoHoje && mesRef === mesHoje;
      if (filtroPeriodo === "ano") return anoRef === anoHoje;
    } catch (e) { return true; }
    return true;
  });

  const notasComArquivo = transacoesFiltradas.filter(t => t.arquivo_nf);
  
  const notasAgrupadas = notasComArquivo.reduce((acc: any, t) => {
    const data = parseISO(t.data_competencia);
    const chaveMesAno = format(data, "MMMM yyyy", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase());
    if (!acc[chaveMesAno]) acc[chaveMesAno] = [];
    acc[chaveMesAno].push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-6 font-sans pb-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Registros de Caixa</h1>
          <p className="text-gray-500 text-sm mt-1">Histórico completo de entradas e saídas.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-gray-100 p-1 rounded-lg flex items-center border border-gray-200">
            <button onClick={() => setModoVisualizacao('lista')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-all ${modoVisualizacao === 'lista' ? 'bg-white text-[#0a003d] shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>
              <LayoutList size={16} /> Tabela
            </button>
            <button onClick={() => setModoVisualizacao('galeria')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-all ${modoVisualizacao === 'galeria' ? 'bg-white text-[#0a003d] shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>
              <FolderOpen size={16} /> Arquivos NF
            </button>
          </div>
          
          <button onClick={abrirModalParaCriar} className="flex items-center gap-2 px-5 py-2.5 bg-[#ffab40] text-[#0a003d] font-bold rounded-lg hover:bg-[#e69a39] transition-colors shadow-sm">
            <FileText size={18} strokeWidth={2.5}/> Novo Lançamento
          </button>
        </div>
      </header>

      <div className="bg-white p-6 rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Buscar por descrição ou nome..." value={busca} onChange={e => setBusca(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] transition-all" />
        </div>
        <select className="p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white text-gray-700 shadow-sm" value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)}>
          <option value="mes">Este Mês</option><option value="ano">Este Ano</option><option value="tudo">Todo o Histórico</option>
        </select>
        {modoVisualizacao === 'lista' && (
          <select className="p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white text-gray-700 shadow-sm" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="todos">Todos os tipos</option><option value="receita">Apenas Entradas</option><option value="despesa">Apenas Saídas</option>
          </select>
        )}
      </div>

      {modoVisualizacao === 'lista' ? (
        <div className="bg-white rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.04)] border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left table-auto">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Data</th>
                  <th className="px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cliente/Fornecedor</th>
                  <th className="px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Descrição</th>
                  <th className="px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tipo</th>
                  <th className="px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Valor</th>
                  <th className="px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Ação</th>
                </tr>
              </thead>
              <tbody>
                {transacoesFiltradas.map((t) => {
                  const vencido = t.status?.toLowerCase() === 'pendente' && isAfter(hoje, parseISO(t.data_vencimento));
                  return (
                    <tr key={t.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4 text-gray-600 tabular-nums">{format(new Date(t.data_competencia), "dd MMM, yyyy", { locale: ptBR })}</td>
                      <td className="px-5 py-4 text-gray-900 font-medium flex items-center gap-2.5"><div className="bg-gray-100 p-1.5 rounded-full text-gray-500"><User size={14}/></div>{t.nome}</td>
                      <td className="px-5 py-4 text-gray-600 truncate max-w-xs">{t.descricao || '-'}</td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider ${t.tipo === 'receita' ? 'bg-emerald-50 text-[#0097a7]' : 'bg-gray-100 text-gray-600'}`}>{t.tipo === 'receita' ? 'Entrada' : 'Saída'}</span>
                      </td>
                      <td className={`px-5 py-4 font-bold ${t.tipo === 'receita' ? 'text-gray-900' : 'text-gray-600'}`}>{formatarMoeda(t.valor)}</td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider ${t.status?.toLowerCase() === 'pago' || t.status?.toLowerCase() === 'recebido' ? 'bg-emerald-50 text-emerald-800' : vencido ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                          {vencido ? 'Atrasado' : t.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <div className="flex justify-center items-center gap-1.5">
                          <button onClick={() => { setTransacaoSelecionada(t); setModalAberto(true); }} className="p-1.5 text-gray-400 hover:text-[#ffab40] rounded transition-colors" title="Editar Lançamento"><User size={16}/></button>
                          {t.arquivo_nf ? (
                              <a href={t.arquivo_nf} download={`NF_${t.nome}_${t.data_competencia}.pdf`} target="_blank" className="p-1.5 text-[#0097a7] hover:bg-[#0097a7]/10 rounded transition-colors" title="Baixar Nota Fiscal"><Download size={16} /></a>
                          ) : (<span className="text-gray-300">-</span>)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {transacoesFiltradas.length === 0 && (<div className="text-center p-12 text-gray-400 text-sm font-medium">Nenhum registro encontrado para este período.</div>)}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.keys(notasAgrupadas).length === 0 ? (
            <div className="bg-white rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.04)] border border-gray-100 p-16 text-center">
              <FolderOpen size={48} strokeWidth={1.5} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-bold text-gray-900 tracking-tight">Nenhuma nota fiscal encontrada</h3>
              <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto">Os PDFs das notas fiscais vinculados aos seus lançamentos aparecerão aqui organizados por mês.</p>
            </div>
          ) : (
            Object.keys(notasAgrupadas).map(mesAno => (
              <div key={mesAno} className="bg-white rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.04)] border border-gray-100 p-6">
                <div className="flex items-center gap-2 mb-6 border-b border-gray-100 pb-4">
                  <FolderOpen size={20} className="text-[#0a003d]" />
                  <h2 className="text-base font-bold text-gray-900">{mesAno}</h2>
                  <span className="ml-2 bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs font-bold">{notasAgrupadas[mesAno].length} doc(s)</span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {notasAgrupadas[mesAno].map((nota: any) => (
                    <div key={nota.id} className="border border-gray-200 rounded-lg p-4 hover:border-[#0097a7] hover:shadow-md transition-all group relative bg-gray-50/50">
                      <div className="flex justify-between items-start mb-3">
                        <div className="bg-red-100 text-red-600 p-2 rounded-md"><FileText size={20} /></div>
                        <div className="flex gap-1">
                          <button onClick={() => { setTransacaoSelecionada(nota); setModalAberto(true); }} className="p-1.5 text-gray-400 hover:text-[#0a003d] transition-colors"><ExternalLink size={16}/></button>
                          <a href={nota.arquivo_nf} download target="_blank" className="p-1.5 text-gray-400 hover:text-[#0097a7] transition-colors"><Download size={16}/></a>
                        </div>
                      </div>
                      <h4 className="font-semibold text-gray-900 text-sm truncate" title={nota.nome}>{nota.nome}</h4>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{nota.descricao || 'Sem descrição'}</p>
                      <div className="mt-4 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-gray-400">{format(parseISO(nota.data_competencia), 'dd/MM/yyyy')}</span>
                        <span className={`text-sm font-bold ${nota.tipo === 'receita' ? 'text-[#0097a7]' : 'text-gray-600'}`}>{formatarMoeda(nota.valor)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <TransactionFormModal aberto={modalAberto} onClose={() => setModalAberto(false)} carregarDados={carregarDados} edicaoData={transacaoSelecionada} />
    </div>
  );
}
