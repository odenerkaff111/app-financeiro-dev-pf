"use client";

import { useEffect, useState } from "react";
import { PlusCircle, Search, PackageOpen, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<any[]>([]);
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState({ nome: '', descricao: '', preco: '' });

  useEffect(() => { carregarProdutos(); }, []);

  async function carregarProdutos() {
    const { data } = await supabase.from('produtos').select('*').order('nome');
    if (data) setProdutos(data);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const precoNum = parseFloat(form.preco.replace(',', '.'));
    await supabase.from('produtos').insert([{ ...form, preco: precoNum }]);
    setForm({ nome: '', descricao: '', preco: '' });
    setModalAberto(false);
    carregarProdutos();
  }

  async function apagar(id: string) {
    if(window.confirm("Apagar produto?")) {
      await supabase.from('produtos').delete().eq('id', id);
      carregarProdutos();
    }
  }

  const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const filtrados = produtos.filter(p => p.nome.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div className="space-y-6 font-sans pb-10">
      <header className="flex justify-between items-center mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Produtos & Serviços</h1>
          <p className="text-gray-500 text-sm mt-1">Catálogo de ofertas da Kaff Co.</p>
        </div>
        <button onClick={() => setModalAberto(true)} className="flex items-center gap-2 px-5 py-2.5 bg-[#ffab40] text-[#0a003d] font-bold rounded-lg hover:bg-[#e69a39] transition-colors shadow-sm">
          <PlusCircle size={18} strokeWidth={2.5}/> Novo Produto
        </button>
      </header>

      <div className="bg-white p-6 rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.04)] border border-gray-100">
        <div className="relative mb-6">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Buscar produto..." value={busca} onChange={e => setBusca(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] transition-all" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {filtrados.map(p => (
            <div key={p.id} className="p-6 border border-gray-100 rounded-xl hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all bg-white flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 bg-gray-50 text-[#0a003d] rounded-lg flex items-center justify-center mb-4 border border-gray-100"><PackageOpen size={20}/></div>
                <h3 className="font-semibold text-gray-900 text-lg tracking-tight">{p.nome}</h3>
                <p className="text-sm text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{p.descricao}</p>
              </div>
              <div className="mt-6 flex items-center justify-between pt-4 border-t border-gray-50">
                <span className="font-bold text-gray-900">{formatarMoeda(p.preco)}</span>
                <button onClick={() => apagar(p.id)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={18}/></button>
              </div>
            </div>
          ))}
          {filtrados.length === 0 && <p className="text-gray-400 text-sm col-span-3 text-center py-10">Nenhum produto cadastrado.</p>}
        </div>
      </div>

      {modalAberto && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white p-8 rounded-xl w-full max-w-md shadow-2xl border border-gray-100">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Cadastrar Oferta</h2>
            <form onSubmit={salvar} className="space-y-4">
              <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Nome do Produto/Serviço</label><input required type="text" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.nome} onChange={e => setForm({...form, nome: e.target.value})}/></div>
              <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Descrição</label><textarea rows={3} className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.descricao} onChange={e => setForm({...form, descricao: e.target.value})}/></div>
              <div><label className="block text-[13px] font-medium text-gray-700 mb-1">Preço Base (R$)</label><input type="number" step="0.01" required className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.preco} onChange={e => setForm({...form, preco: e.target.value})}/></div>
              
              <div className="flex gap-3 mt-6 pt-4">
                <button type="button" onClick={() => setModalAberto(false)} className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 py-2.5 bg-[#0a003d] text-white rounded-lg font-medium text-sm hover:bg-gray-900 transition-colors">Salvar Produto</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
