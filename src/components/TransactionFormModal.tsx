"use client";

import { useState, useEffect } from "react";
import { X, Trash2, Save, UploadCloud, CheckCircle2, Mail, CreditCard, DollarSign } from "lucide-react";
import { supabase } from "@/lib/supabase";

type TransactionFormModalProps = { aberto: boolean; onClose: () => void; carregarDados: () => void; edicaoData?: any; };

const CATEGORIAS_PADRAO = ["Marketing", "Investimento", "Despesas", "Pró-Labore", "Retirada de Lucro", "Venda", "Imposto", "Ferramentas", "Recorrência", "Adicionar novo"];
const METODOS_PAGAMENTO = ["PIX", "Boleto", "Débito", "Crédito"];

export function TransactionFormModal({ aberto, onClose, carregarDados, edicaoData }: TransactionFormModalProps) {
  const [clientes, setClientes] = useState<any[]>([]);
  const [form, setForm] = useState({
    tipo: 'receita', cliente_id: '', nome: '', email_cliente: '', descricao: '', valor: '', data: new Date().toISOString().split('T')[0],
    status: 'Recebido', categoria: 'Venda', forma_pagamento: 'PIX', emitiu_nota_fiscal: false
  });
  
  const [categoriaCustomizada, setCategoriaCustomizada] = useState('');
  const [arquivoNF, setArquivoNF] = useState<File | null>(null);
  const [enviarEmail, setEnviarEmail] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  const [tipoCobranca, setTipoCobranca] = useState('Única');
  const [qtdParcelas, setQtdParcelas] = useState(2);
  const [cicloAssinatura, setCicloAssinatura] = useState('Mensal');

  useEffect(() => {
    async function fetchClientes() {
      const { data } = await supabase.from('clientes').select('*').order('nome');
      if (data) setClientes(data);
    }
    fetchClientes();

    if (edicaoData) {
      setForm({
        tipo: edicaoData.tipo, cliente_id: edicaoData.cliente_id || '', nome: edicaoData.nome || '', email_cliente: edicaoData.email_cliente || '', descricao: edicaoData.descricao || '', 
        valor: edicaoData.valor.toString(), data: edicaoData.data_competencia, 
        status: edicaoData.status || 'Recebido', categoria: edicaoData.categoria || 'Venda',
        forma_pagamento: edicaoData.forma_pagamento || 'PIX', emitiu_nota_fiscal: edicaoData.emitiu_nota_fiscal || false
      });
      setTipoCobranca('Única'); setArquivoNF(null); setEnviarEmail(false);
    } else {
      setForm({ tipo: 'receita', cliente_id: '', nome: '', email_cliente: '', descricao: '', valor: '', data: new Date().toISOString().split('T')[0], status: 'Recebido', categoria: 'Venda', forma_pagamento: 'PIX', emitiu_nota_fiscal: false });
      setTipoCobranca('Única'); setQtdParcelas(2); setCicloAssinatura('Mensal'); setArquivoNF(null); setEnviarEmail(false);
    }
  }, [edicaoData, aberto]);

  function handleClienteChange(e: any) {
    const cid = e.target.value;
    const cli = clientes.find(c => c.id === cid);
    setForm({...form, cliente_id: cid, nome: cli?.nome || '', email_cliente: cli?.email || ''});
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setUploading(true);
    let url_nf = edicaoData?.arquivo_nf || null;
    
    // UPLOAD COM TRAVA DE SEGURANÇA
    if (arquivoNF) {
      const fileExt = arquivoNF.name.split('.').pop();
      const fileName = `${Date.now()}_nf.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('notas').upload(fileName, arquivoNF);
      
      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage.from('notas').getPublicUrl(fileName);
        url_nf = publicUrlData.publicUrl;
      } else {
        alert("Erro ao enviar a Nota Fiscal pro Supabase: " + uploadError.message);
        setUploading(false);
        return; // Interrompe o processo para não salvar pela metade
      }
    }

    const catFinal = form.categoria === 'Adicionar novo' ? categoriaCustomizada : form.categoria;
    const valorNum = parseFloat(form.valor.replace(',', '.'));
    
    let transacoesParaSalvar = [];
    const baseTransacao = {
      tipo: form.tipo, cliente_id: form.cliente_id || null, nome: form.nome, email_cliente: form.email_cliente, descricao: form.descricao,
      categoria: catFinal, status: form.status, forma_pagamento: form.forma_pagamento,
      emitiu_nota_fiscal: form.emitiu_nota_fiscal, arquivo_nf: url_nf
    };

    if (!edicaoData && tipoCobranca !== 'Única') {
      const iteracoes = tipoCobranca === 'Parcelada' ? qtdParcelas : 12;
      
      for (let i = 0; i < iteracoes; i++) {
        const dataVenc = new Date(form.data);
        if (tipoCobranca === 'Parcelada' || (tipoCobranca === 'Recorrente' && cicloAssinatura === 'Mensal')) {
            dataVenc.setMonth(dataVenc.getMonth() + i);
        } else if (tipoCobranca === 'Recorrente' && cicloAssinatura === 'Anual') {
            dataVenc.setFullYear(dataVenc.getFullYear() + i);
        }
        const dataFormatada = dataVenc.toISOString().split('T')[0];
        
        let desc = form.descricao;
        if (tipoCobranca === 'Parcelada') desc = `${form.descricao} (Parcela ${i+1}/${qtdParcelas})`;
        if (tipoCobranca === 'Recorrente') desc = `${form.descricao} (Recorrência ${i+1})`;

        transacoesParaSalvar.push({
          ...baseTransacao, valor: valorNum, data_competencia: dataFormatada, data_vencimento: dataFormatada,
          data_pagamento: (form.status === 'Pago' || form.status === 'Recebido') && i === 0 ? dataFormatada : null,
          status: i === 0 ? form.status : 'Pendente',
          descricao: desc
        });
      }
    } else {
      transacoesParaSalvar.push({
        ...baseTransacao, valor: valorNum, data_competencia: form.data, data_vencimento: form.data,
        data_pagamento: form.status === 'Pago' || form.status === 'Recebido' ? form.data : null
      });
    }

    let error;
    if (edicaoData) {
      const { error: err } = await supabase.from('transacoes').update(transacoesParaSalvar[0]).eq('id', edicaoData.id);
      error = err;
    } else {
      const { error: err } = await supabase.from('transacoes').insert(transacoesParaSalvar);
      error = err;
    }
    
    if (!error && enviarEmail && url_nf && form.email_cliente) {
      const emails = form.email_cliente.split(',').map(e => e.trim()).filter(e => e);
      for (const email of emails) {
          await fetch('/api/send-email', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ para: email, nomeCliente: form.nome || 'Cliente', valor: form.valor, anexoUrl: url_nf }) 
          });
      }
    }

    setUploading(false);
    if (!error) { carregarDados(); onClose(); } else alert("Erro ao salvar no banco: " + error.message);
  }

  async function apagar() {
    if (!edicaoData || !window.confirm("Tem certeza que deseja apagar?")) return;
    const { error } = await supabase.from('transacoes').delete().eq('id', edicaoData.id);
    if (!error) { carregarDados(); onClose(); }
  }

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex justify-end transition-opacity">
      <div className="w-full max-w-lg bg-white h-screen shadow-2xl flex flex-col font-sans">
        
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-[#f9fafb]">
          <div className="flex items-center gap-3">
            <div className="bg-[#0a003d] text-white p-2 rounded-lg"><DollarSign size={20} strokeWidth={2.5}/></div>
            <h2 className="text-lg font-bold text-gray-900 tracking-tight">{edicaoData ? "Editar Lançamento" : "Novo Lançamento"}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-900 transition-colors"><X size={20} /></button>
        </div>
        
        <form onSubmit={salvar} className="flex-1 overflow-y-auto p-6 space-y-6">
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tipo</label>
              <select className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white shadow-sm" value={form.tipo} onChange={e => { setForm({...form, tipo: e.target.value, status: e.target.value === 'receita' ? 'Recebido' : 'Pago', categoria: e.target.value === 'receita' ? 'Venda' : 'Despesas'}); setTipoCobranca('Única'); }}>
                <option value="receita">Entrada (Receita)</option>
                <option value="despesa">Saída (Despesa)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Status</label>
              <select className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white shadow-sm" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                <option value="Pago">Pago</option><option value="Recebido">Recebido</option><option value="Pendente">Pendente</option><option value="Atrasado">Atrasado</option>
              </select>
            </div>
          </div>
          
          <div className="bg-[#f9fafb] p-5 rounded-xl border border-gray-100 space-y-4">
            {form.tipo === 'receita' ? (
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Cliente (Opcional)</label>
                <select className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={form.cliente_id} onChange={handleClienteChange}>
                  <option value="">Sem cliente vinculado (Ex: Aporte/Investimento)</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            ) : null}

            {(!form.cliente_id || form.tipo === 'despesa') && (
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  {form.tipo === 'receita' ? "Origem / Nome" : "Fornecedor / Favorecido"}
                </label>
                <input type="text" required placeholder="Ex: Investimento Sócio, AWS, etc." className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={form.nome} onChange={e => setForm({...form, nome: e.target.value})}/>
              </div>
            )}
            
            <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Descrição</label>
                <input type="text" placeholder="O que foi vendido/comprado?" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={form.descricao} onChange={e => setForm({...form, descricao: e.target.value})}/>
            </div>
            
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Categoria</label>
              <select className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={form.categoria} onChange={e => setForm({...form, categoria: e.target.value})}>
                {CATEGORIAS_PADRAO.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {form.categoria === 'Adicionar novo' && (<input type="text" autoFocus required placeholder="Digite a nova categoria" className="w-full mt-2 p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={categoriaCustomizada} onChange={e => setCategoriaCustomizada(e.target.value)} />)}
            </div>
          </div>
          
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-5">
            <div className="flex items-center gap-2 border-b border-gray-50 pb-3">
                <CreditCard size={18} className="text-[#0a003d]" />
                <h3 className="text-sm font-bold text-gray-900 tracking-tight">Configuração de Cobrança</h3>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Valor (por cobrança)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">R$</span>
                  <input type="number" step="0.01" required placeholder="0.00" className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] font-bold bg-white" value={form.valor} onChange={e => setForm({...form, valor: e.target.value})}/>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Data</label>
                <input type="date" required className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={form.data} onChange={e => setForm({...form, data: e.target.value})}/>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tipo de Cobrança</label>
                <select className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={tipoCobranca} disabled={!!edicaoData} onChange={e => setTipoCobranca(e.target.value)}>
                  <option value="Única">Única</option>
                  <option value="Parcelada">Parcelada</option>
                  <option value="Recorrente">Recorrente</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Forma de Pagamento</label>
                <select className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={form.forma_pagamento} onChange={e => setForm({...form, forma_pagamento: e.target.value})}>
                  {METODOS_PAGAMENTO.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {!edicaoData && tipoCobranca === 'Parcelada' && (
              <div className="pt-3 border-t border-gray-50">
                <label className="block text-[11px] font-semibold text-[#0097a7] uppercase tracking-wider mb-2">Número de Parcelas</label>
                <input type="number" min="2" max="36" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={qtdParcelas} onChange={e => setQtdParcelas(parseInt(e.target.value))} />
                <p className="text-[11px] text-gray-400 mt-1">Gera {qtdParcelas} lançamentos mensais de R$ {form.valor || '0,00'}.</p>
              </div>
            )}

            {!edicaoData && tipoCobranca === 'Recorrente' && (
              <div className="pt-3 border-t border-gray-50">
                <label className="block text-[11px] font-semibold text-[#0097a7] uppercase tracking-wider mb-2">Ciclo de Cobrança</label>
                <select className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={cicloAssinatura} onChange={e => setCicloAssinatura(e.target.value)}>
                  <option value="Mensal">Mensal</option>
                  <option value="Anual">Anual</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">O sistema irá projetar esta assinatura um ano à frente.</p>
              </div>
            )}

          </div>

          <div className="bg-[#f9fafb] p-5 rounded-xl border border-gray-100 space-y-4">
            <h3 className="text-sm font-bold text-gray-900 tracking-tight mb-2">Emissão e Documentos</h3>
            
            <label className="flex items-center space-x-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-[#0097a7] focus:ring-[#0097a7]" checked={form.emitiu_nota_fiscal} onChange={e => { setForm({...form, emitiu_nota_fiscal: e.target.checked}); if(!e.target.checked) setEnviarEmail(false); }} />
              <span className="text-sm font-medium text-gray-700">Possui Nota Fiscal (PDF)</span>
            </label>
            
            {form.emitiu_nota_fiscal && (
              <div className="space-y-4 mt-4">
                <div className="border border-dashed border-gray-300 rounded-lg p-5 text-center bg-white hover:bg-gray-50 transition-colors">
                  {arquivoNF || edicaoData?.arquivo_nf ? (
                    <div className="text-[#0097a7] flex flex-col items-center">
                      <CheckCircle2 size={28} className="mb-2" />
                      <p className="text-sm font-bold">{arquivoNF ? arquivoNF.name : 'Documento anexado'}</p>
                      {edicaoData?.arquivo_nf && !arquivoNF && <a href={edicaoData.arquivo_nf} target="_blank" className="text-xs text-[#0a003d] hover:underline mt-1 font-semibold">Visualizar Arquivo</a>}
                    </div>
                  ) : (
                    <>
                      <UploadCloud className="mx-auto text-gray-400 mb-2" size={24} />
                      <label className="px-4 py-1.5 bg-white border border-gray-200 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-50 cursor-pointer inline-block shadow-sm">
                        Fazer Upload
                        <input type="file" accept=".pdf,image/*" className="hidden" onChange={e => e.target.files && setArquivoNF(e.target.files[0])} />
                      </label>
                    </>
                  )}
                </div>

                <div className="pt-3">
                  <label className="flex items-center space-x-3 mb-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-[#0097a7] focus:ring-[#0097a7]" checked={enviarEmail} onChange={e => setEnviarEmail(e.target.checked)} />
                    <span className="text-sm font-medium text-gray-700 flex items-center gap-2"><Mail size={16} className="text-gray-400"/> Enviar NF por e-mail</span>
                  </label>
                  
                  {enviarEmail && (
                    <div>
                      <p className="text-[11px] text-gray-500 mb-1">E-mails (separe por vírgula para múltiplos envios)</p>
                      <input type="text" placeholder="ex: cliente@email.com, socio@email.com" className="w-full p-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white" value={form.email_cliente} onChange={e => setForm({...form, email_cliente: e.target.value})} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

        </form>

        <div className="p-6 border-t border-gray-100 bg-white flex gap-3">
          {edicaoData && (
            <button onClick={apagar} type="button" className="flex items-center justify-center px-4 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors">
              <Trash2 size={18} />
            </button>
          )}
          <button onClick={onClose} type="button" className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button onClick={salvar} disabled={uploading} type="submit" className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#0a003d] text-white rounded-lg font-medium text-sm hover:bg-gray-900 transition-colors disabled:opacity-50">
            {uploading ? "Processando..." : <><Save size={16} /> {edicaoData ? "Atualizar" : "Salvar Lançamento"}</>}
          </button>
        </div>

      </div>
    </div>
  );
}
