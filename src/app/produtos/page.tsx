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
          <h1 className="text-2xl font-bold text-white tracking-tight">Produtos & ServiÃ§os</h1>
          <p className="text-white/55 text-sm mt-1">CatÃ¡logo de ofertas da Kaff Co.</p>
        </div>
        <button onClick={() => setModalAberto(true)} className="flex items-center gap-2 px-5 py-2.5 bg-[#ffab40] text-[#0a003d] font-bold rounded-lg hover:bg-[#e69a39] transition-colors shadow-[0_18px_55px_rgba(0,0,0,0.22)]">
          <PlusCircle size={18} strokeWidth={2.5}/> Novo Produto
        </button>
      </header>

      <div className="bg-white/[0.055] backdrop-blur-2xl p-6 rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.04)] border border-white/10">
        <div className="relative mb-6">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" size={18} />
          <input type="text" placeholder="Buscar produto..." value={busca} onChange={e => setBusca(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-sm border border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] transition-all" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {filtrados.map(p => (
            <div key={p.id} className="p-6 border border-white/10 rounded-xl hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all bg-white/[0.055] flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 bg-white/[0.045] text-[#0a003d] rounded-lg flex items-center justify-center mb-4 border border-white/10"><PackageOpen size={20}/></div>
                <h3 className="font-semibold text-white text-lg tracking-tight">{p.nome}</h3>
                <p className="text-sm text-white/55 mt-1.5 line-clamp-2 leading-relaxed">{p.descricao}</p>
              </div>
              <div className="mt-6 flex items-center justify-between pt-4 border-t border-gray-50">
                <span className="font-bold text-white">{formatarMoeda(p.preco)}</span>
                <button onClick={() => apagar(p.id)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={18}/></button>
              </div>
            </div>
          ))}
          {filtrados.length === 0 && <p className="text-white/40 text-sm col-span-3 text-center py-10">Nenhum produto cadastrado.</p>}
        </div>
      </div>

      {modalAberto && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white/[0.055] backdrop-blur-2xl p-8 rounded-xl w-full max-w-md shadow-2xl border border-white/10">
            <h2 className="text-xl font-bold text-white mb-6">Cadastrar Oferta</h2>
            <form onSubmit={salvar} className="space-y-4">
              <div><label className="block text-[13px] font-medium text-white/80 mb-1">Nome do Produto/ServiÃ§o</label><input required type="text" className="w-full p-2.5 text-sm border border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.nome} onChange={e => setForm({...form, nome: e.target.value})}/></div>
              <div><label className="block text-[13px] font-medium text-white/80 mb-1">DescriÃ§Ã£o</label><textarea rows={3} className="w-full p-2.5 text-sm border border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.descricao} onChange={e => setForm({...form, descricao: e.target.value})}/></div>
              <div><label className="block text-[13px] font-medium text-white/80 mb-1">PreÃ§o Base (R$)</label><input type="number" step="0.01" required className="w-full p-2.5 text-sm border border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7]" value={form.preco} onChange={e => setForm({...form, preco: e.target.value})}/></div>
              
              <div className="flex gap-3 mt-6 pt-4">
                <button type="button" onClick={() => setModalAberto(false)} className="flex-1 py-2.5 bg-white/[0.055] border border-white/10 text-white/80 rounded-lg font-medium text-sm hover:bg-white/[0.045] transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 py-2.5 bg-[#0a003d] text-white rounded-lg font-medium text-sm hover:bg-gray-900 transition-colors">Salvar Produto</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


