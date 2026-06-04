"use client";

import { useEffect, useState } from "react";
import { PlusCircle, Search, Eye, Building2, Wallet, X, Save, Star, Edit, Package } from "lucide-react";
import { supabase } from "@/lib/supabase";
// CORREÇÃO: parseISO adicionado na importação abaixo
import { format, parseISO } from "date-fns";

export default function ClientesPage() {
  const [clientes, setClientes] = useState<any[]>([]);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [transacoes, setTransacoes] = useState<any[]>([]);
  const [busca, setBusca] = useState("");
  
  const [modalCriar, setModalCriar] = useState(false);
  const [clienteVisor, setClienteVisor] = useState<any>(null);
  const [edicaoId, setEdicaoId] = useState<string | null>(null);
  
  const formVazio = { nome: '', email: '', telefone: '', nome_empresa: '', produto_id: '', segmento: '', endereco: '', cpf_cnpj: '', status: 'Ativo', data_cliente: new Date().toISOString().split('T')[0], score: 0 };
  const [form, setForm] = useState(formVazio);

  useEffect(() => { carregarDados(); }, []);

  async function carregarDados() {
    const [resClientes, resProdutos, resTransacoes] = await Promise.all([
      supabase.from('clientes').select('*').order('nome'),
      supabase.from('produtos').select('*').order('nome'),
      supabase.from('transacoes').select('*').eq('tipo', 'receita')
    ]);
    if (resClientes.data) setClientes(resClientes.data);
    if (resProdutos.data) setProdutos(resProdutos.data);
    if (resTransacoes.data) setTransacoes(resTransacoes.data);
  }

  function abrirNovo() { setEdicaoId(null); setForm(formVazio); setModalCriar(true); }

  function abrirEdicao(cliente: any) {
    setEdicaoId(cliente.id);
    setForm({
      nome: cliente.nome || '', email: cliente.email || '', telefone: cliente.telefone || '', 
      nome_empresa: cliente.nome_empresa || '', produto_id: cliente.produto_id || '', 
      segmento: cliente.segmento || '', endereco: cliente.endereco || '', 
      cpf_cnpj: cliente.cpf_cnpj || '', status: cliente.status || 'Ativo', 
      data_cliente: cliente.data_cliente || new Date().toISOString().split('T')[0], score: cliente.score || 0
    });
    setClienteVisor(null);
    setModalCriar(true);
  }

  async function salvarCliente(e: React.FormEvent) {
    e.preventDefault();
    const dadosSalvar = { ...form, produto_id: form.produto_id || null };
    if (edicaoId) await supabase.from('clientes').update(dadosSalvar).eq('id', edicaoId);
    else await supabase.from('clientes').insert([dadosSalvar]);
    setModalCriar(false);
    carregarDados();
  }

  const getLTV = (clienteId: string) => transacoes.filter(t => t.cliente_id === clienteId && (t.status === 'Pago' || t.status === 'Recebido')).reduce((acc, t) => acc + Number(t.valor), 0);
  const getHistoricoCompras = (clienteId: string) => transacoes.filter(t => t.cliente_id === clienteId);
  const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const filtrados = clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()) || (c.nome_empresa && c.nome_empresa.toLowerCase().includes(busca.toLowerCase())));

  return (
    <div className="space-y-8 font-sans pb-10">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Gestão de Clientes</h1>
          <p className="text-[#6b7280] text-sm mt-1">CRM e Base de Contatos</p>
        </div>
        <button onClick={abrirNovo} className="flex items-center gap-2 px-5 py-2.5 bg-[#ffab40] text-[#0a003d] font-bold rounded-lg hover:bg-[#e69a39] transition-colors shadow-sm">
          <PlusCircle size={18} strokeWidth={2.5}/> Novo Cliente
        </button>
      </header>

      <div className="bg-white p-6 rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.04)] border border-gray-100/50">
        <div className="relative mb-6">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Buscar por nome ou empresa..." value={busca} onChange={e => setBusca(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] transition-all" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Empresa / Segmento</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Total Gasto (LTV)</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(c => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-4 font-medium text-gray-900">{c.nome}</td>
                  <td className="px-4 py-4 text-gray-600">{c.nome_empresa || '-'}<br/><span className="text-xs text-gray-400">{c.segmento || ''}</span></td>
                  <td className="px-4 py-4">
                    <span className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider ${c.status?.toLowerCase() === 'ativo' ? 'bg-emerald-100 text-emerald-800' : c.status?.toLowerCase() === 'inadimplente' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 font-bold text-emerald-600">{formatarMoeda(getLTV(c.id))}</td>
                  <td className="px-4 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setClienteVisor(c)} className="p-1.5 text-gray-400 hover:text-[#0097a7] rounded transition" title="Ver Perfil"><Eye size={18} /></button>
                      <button onClick={() => abrirEdicao(c)} className="p-1.5 text-gray-400 hover:text-[#ffab40] rounded transition" title="Editar Cliente"><Edit size={18} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtrados.length === 0 && <p className="text-center p-8 text-gray-400 text-sm">Nenhum cliente encontrado.</p>}
        </div>
      </div>

      {modalCriar && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex justify-end transition-opacity">
          <div className="w-full max-w-lg bg-white h-screen p-8 shadow-2xl overflow-y-auto flex flex-col font-sans">
            <div className="flex items-center justify-between pb-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900">{edicaoId ? "Editar Cliente" : "Novo Cliente"}</h2>
              <button onClick={() => setModalCriar(false)} className="p-1 text-gray-400 hover:text-gray-900"><X size={20} /></button>
            </div>
            
            <form onSubmit={salvarCliente} className="space-y-4 flex-1">
              <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Nome Completo</label><input required type="text" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.nome} onChange={e => setForm({...form, nome: e.target.value})}/></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-[13px] font-medium text-gray-700 mb-1">E-mail</label><input type="email" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.email} onChange={e => setForm({...form, email: e.target.value})}/></div>
                <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Telefone</label><input type="text" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.telefone} onChange={e => setForm({...form, telefone: e.target.value})}/></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Empresa</label><input type="text" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.nome_empresa} onChange={e => setForm({...form, nome_empresa: e.target.value})}/></div>
                <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Documento</label><input type="text" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.cpf_cnpj} onChange={e => setForm({...form, cpf_cnpj: e.target.value})}/></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Segmento</label><input type="text" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.segmento} onChange={e => setForm({...form, segmento: e.target.value})}/></div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">Produto Interesse</label>
                  <select className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={form.produto_id} onChange={e => setForm({...form, produto_id: e.target.value})}>
                    <option value="">Nenhum...</option>
                    {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Endereço Completo</label><input type="text" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.endereco} onChange={e => setForm({...form, endereco: e.target.value})}/></div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">Status</label>
                  <select className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                    <option value="Ativo">Ativo</option><option value="Inativo">Inativo</option><option value="Inadimplente">Inadimplente</option><option value="Lead">Lead</option>
                  </select>
                </div>
                <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Desde</label><input type="date" required className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.data_cliente} onChange={e => setForm({...form, data_cliente: e.target.value})}/></div>
              </div>

              <div className="pt-6 mt-6">
                <button type="submit" className="w-full py-2.5 bg-[#0a003d] text-white rounded-lg font-medium text-sm hover:bg-gray-900 transition-colors">
                  <Save size={16} className="inline mr-2"/> {edicaoId ? "Atualizar Perfil" : "Cadastrar Cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {clienteVisor && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100">
            <div className="bg-[#0a003d] p-8 relative">
              <button onClick={() => setClienteVisor(null)} className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-white transition"><X size={20} /></button>
              <button onClick={() => abrirEdicao(clienteVisor)} className="absolute top-4 right-12 p-1.5 text-gray-400 hover:text-[#ffab40] transition"><Edit size={18}/></button>
              
              <div className="flex items-center gap-5 mt-2">
                <div className="w-16 h-16 bg-[#ffab40] text-[#0a003d] rounded-full flex items-center justify-center font-bold text-2xl shrink-0">
                  {clienteVisor.nome.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">{clienteVisor.nome}</h2>
                  <p className="text-gray-300 text-sm mt-1 flex items-center gap-2"><Building2 size={14}/> {clienteVisor.nome_empresa || 'Pessoa Física'} • {clienteVisor.cpf_cnpj}</p>
                </div>
              </div>
            </div>

            <div className="p-8 space-y-8">
              <div className="grid grid-cols-3 gap-4 border-b border-gray-100 pb-8">
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">Status</p>
                  <p className={`inline-block px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider ${clienteVisor.status?.toLowerCase() === 'ativo' ? 'bg-emerald-100 text-emerald-800' : clienteVisor.status?.toLowerCase() === 'inadimplente' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                    {clienteVisor.status || 'Ativo'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1 flex items-center gap-1"><Wallet size={12}/> Total Gasto</p>
                  <p className="font-bold text-emerald-600 text-lg">{formatarMoeda(getLTV(clienteVisor.id))}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1 flex items-center gap-1"><Star size={12}/> Score</p>
                  <p className="font-bold text-amber-500 text-lg">{clienteVisor.score} pts</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                <div><p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Contato</p><p className="text-sm text-gray-800">{clienteVisor.telefone || '-'}<br/>{clienteVisor.email || '-'}</p></div>
                <div><p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Segmento</p><p className="text-sm text-gray-800">{clienteVisor.segmento || '-'}</p></div>
                <div><p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Endereço</p><p className="text-sm text-gray-800">{clienteVisor.endereco || '-'}</p></div>
                <div>
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Entrou em</p>
                    {/* AQUI ESTÁ A LINHA QUE QUEBRAVA, AGORA CORRIGIDA */}
                    <p className="text-sm text-gray-800">{clienteVisor.data_cliente ? format(parseISO(clienteVisor.data_cliente), 'dd/MM/yyyy') : '-'}</p>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2 mt-6"><Package size={16}/> Histórico de Compras</h3>
                <div className="space-y-2">
                  {getHistoricoCompras(clienteVisor.id).map(compra => (
                    <div key={compra.id} className="flex items-center justify-between py-3 border-b border-gray-50 text-sm">
                      <div>
                        <p className="font-medium text-gray-900">{compra.descricao || 'Produto / Serviço'}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{compra.data_competencia.split('-').reverse().join('/')}</p>
                      </div>
                      <span className="font-bold text-emerald-600">{formatarMoeda(Number(compra.valor))}</span>
                    </div>
                  ))}
                  {getHistoricoCompras(clienteVisor.id).length === 0 && <p className="text-sm text-gray-400">Nenhuma transação registrada.</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
