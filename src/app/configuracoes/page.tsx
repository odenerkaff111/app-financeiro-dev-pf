"use client";

import { useEffect, useState, useRef } from "react";
import { UserPlus, Settings, Save, Trash2, User, Users, LogOut, Edit, PlusCircle, Scale, Percent, UploadCloud, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function ConfiguracoesPage() {
  const [abaAtiva, setAbaAtiva] = useState("perfil"); 
  const [sessaoUsuario, setSessaoUsuario] = useState<any>(null);
  const [perfilUsuario, setPerfilUsuario] = useState<any>(null);
  
  const [usuariosSistema, setUsuariosSistema] = useState<any[]>([]);
  const [modalUserAberto, setModalUserAberto] = useState(false);
  const [edicaoUserId, setEdicaoUserId] = useState<string | null>(null);
  const [formUser, setFormUser] = useState({ nome: '', email: '', papel: 'Financeiro' });

  const [configFiscais, setConfigFiscais] = useState({ sn_percentual: 15.5, ir_percentual: 0 });

  const [nomeForm, setNomeForm] = useState("");
  const [avatarForm, setAvatarForm] = useState<string | null>(null);
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);

  const router = useRouter();

  useEffect(() => { carregarUsuarioAtual(); }, []);
  useEffect(() => {
    if (abaAtiva === 'pessoas') carregarUsuariosSistema();
    if (abaAtiva === 'imposto') carregarConfiguracoesFiscais();
  }, [abaAtiva]);

  async function carregarUsuarioAtual() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setSessaoUsuario(session.user);
      const { data: perfil } = await supabase.from('perfis').select('*').eq('id', session.user.id).single();
      if (perfil) {
        setPerfilUsuario(perfil);
        setNomeForm(perfil.nome);
        setAvatarForm(perfil.avatar_url); 
        setPreviewAvatar(perfil.avatar_url); 
      }
    } else {
      router.push('/auth');
    }
  }

  async function carregarUsuariosSistema() {
    const { data } = await supabase.from('usuarios').select('*').order('created_at');
    if (data) setUsuariosSistema(data);
  }

  function abrirNovoUser() {
    setEdicaoUserId(null);
    setFormUser({ nome: '', email: '', papel: 'Financeiro' });
    setModalUserAberto(true);
  }

  function abrirEdicaoUser(u: any) {
    setEdicaoUserId(u.id);
    setFormUser({ nome: u.nome, email: u.email, papel: u.papel });
    setModalUserAberto(true);
  }

  async function salvarUsuario(e: React.FormEvent) {
    e.preventDefault();
    if (edicaoUserId) await supabase.from('usuarios').update(formUser).eq('id', edicaoUserId);
    else await supabase.from('usuarios').insert([formUser]);
    setModalUserAberto(false);
    carregarUsuariosSistema();
  }

  async function apagarUsuario(id: string) {
    if (window.confirm("Remover este usuário da equipe?")) {
      await supabase.from('usuarios').delete().eq('id', id);
      carregarUsuariosSistema();
    }
  }

  async function carregarConfiguracoesFiscais() {
    const { data } = await supabase.from('configuracoes_sistema').select('*').eq('id', 1).single();
    if (data) setConfigFiscais({ sn_percentual: Number(data.imposto_simples_nacional_percentual), ir_percentual: Number(data.imposto_renda_percentual) });
  }

  async function salvarConfiguracoesFiscais() {
    await supabase.from('configuracoes_sistema').upsert({ id: 1, imposto_simples_nacional_percentual: configFiscais.sn_percentual, imposto_renda_percentual: configFiscais.ir_percentual });
    alert("Configurações fiscais salvas!");
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) setPreviewAvatar(URL.createObjectURL(file));
  }

  async function salvarPerfil() {
    if (!sessaoUsuario) return;
    setSalvandoPerfil(true);
    let finalAvatarUrl = avatarForm;

    if (fileInputRef.current?.files?.[0]) {
      const file = fileInputRef.current.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${sessaoUsuario.id}_${Date.now()}.${fileExt}`;
      const filePath = `user_avatars/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file);
      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
        finalAvatarUrl = publicUrlData.publicUrl;
      } else {
        alert("Erro no upload da imagem.");
        setSalvandoPerfil(false);
        return;
      }
    }

    await supabase.from('perfis').update({ nome: nomeForm, avatar_url: finalAvatarUrl }).eq('id', sessaoUsuario.id);
    await supabase.from('usuarios').update({ avatar_url: finalAvatarUrl }).eq('email', sessaoUsuario.email);

    alert("Perfil e foto atualizados!");
    carregarUsuarioAtual();
    setSalvandoPerfil(false);
  }

  async function deslogar() {
    await supabase.auth.signOut();
    router.push('/auth');
  }

  return (
    <div className="font-sans flex h-[85vh] bg-white/[0.055] backdrop-blur-2xl rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.04)] border border-white/10 overflow-hidden">
      
      <div className="w-64 border-r border-white/10 bg-[#f9fafb] p-6 flex flex-col">
        <h2 className="text-sm font-semibold text-white/55 uppercase tracking-wider mb-6">Configurações</h2>
        <nav className="space-y-1 flex-1">
          <button onClick={() => setAbaAtiva('perfil')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${abaAtiva === 'perfil' ? 'bg-white/[0.055] text-[#0a003d] shadow-[0_18px_55px_rgba(0,0,0,0.22)] border border-white/10' : 'text-white/65 hover:bg-white/[0.055]'}`}>
            <User size={16} /> Meu Perfil
          </button>
          <button onClick={() => setAbaAtiva('pessoas')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${abaAtiva === 'pessoas' ? 'bg-white/[0.055] text-[#0a003d] shadow-[0_18px_55px_rgba(0,0,0,0.22)] border border-white/10' : 'text-white/65 hover:bg-white/[0.055]'}`}>
            <Users size={16} /> Pessoas
          </button>
          <button onClick={() => setAbaAtiva('imposto')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${abaAtiva === 'imposto' ? 'bg-white/[0.055] text-[#0a003d] shadow-[0_18px_55px_rgba(0,0,0,0.22)] border border-white/10' : 'text-white/65 hover:bg-white/[0.055]'}`}>
            <Scale size={16} /> Impostos
          </button>
        </nav>
        <button onClick={deslogar} className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-white/55 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors mt-auto">
          <LogOut size={16} /> Sair da conta
        </button>
      </div>

      <div className="flex-1 p-10 overflow-y-auto">
        
        {abaAtiva === 'perfil' && (
          <div className="max-w-2xl">
            <h1 className="text-2xl font-bold text-white tracking-tight mb-8">Minhas configurações</h1>
            <div className="flex flex-col md:flex-row items-start gap-12">
              <div className="w-full md:w-1/3">
                <h3 className="text-sm font-semibold text-white">Perfil</h3>
                <p className="text-xs text-white/55 mt-1 leading-relaxed">Suas informações pessoais e configurações de segurança.</p>
              </div>
              <div className="w-full md:w-2/3 space-y-6">
                <div>
                  <label className="block text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">Avatar</label>
                  <div className="flex items-center gap-5">
                    {previewAvatar ? (
                        <img src={previewAvatar} alt="Sua Foto" className="w-16 h-16 rounded-full object-cover border border-white/10 shadow-[0_18px_55px_rgba(0,0,0,0.22)]" />
                    ) : (
                        <div className="w-16 h-16 rounded-full bg-white/[0.055] text-white/55 flex items-center justify-center text-xl font-bold border border-white/10 shadow-[0_18px_55px_rgba(0,0,0,0.22)]">
                            {perfilUsuario ? perfilUsuario.nome.substring(0, 2).toUpperCase() : '..'}
                        </div>
                    )}
                    <div>
                        <input type="file" ref={fileInputRef} accept="image/*" onChange={handleFileChange} className="hidden" />
                        <button onClick={() => fileInputRef.current?.click()} type="button" className="flex items-center gap-1.5 px-4 py-2 bg-white/[0.055] border border-white/10 text-white/80 text-[13px] font-medium rounded-lg hover:bg-white/[0.045] transition-colors shadow-[0_18px_55px_rgba(0,0,0,0.22)]">
                            <UploadCloud size={14}/> {previewAvatar ? "Alterar foto" : "Escolher foto"}
                        </button>
                    </div>
                  </div>
                </div>
                <div><label className="block text-[13px] font-medium text-white/80 mb-1">Nome completo</label><input type="text" className="w-full p-2.5 text-sm border border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white/[0.055] transition-all" value={nomeForm} onChange={e => setNomeForm(e.target.value)} /></div>
                <div><label className="block text-[13px] font-medium text-white/80 mb-1">E-mail</label><input type="email" disabled className="w-full p-2.5 text-sm border border-white/10 bg-white/[0.045] text-white/40 rounded-lg" value={sessaoUsuario?.email || ''} /></div>
                <div className="pt-4 mt-8 border-t border-gray-50">
                  <button onClick={salvarPerfil} disabled={salvandoPerfil} className="px-5 py-2.5 bg-[#0a003d] text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition-colors disabled:opacity-50">
                    {salvandoPerfil ? "Salvando..." : "Salvar alterações"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {abaAtiva === 'pessoas' && (
          <div>
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-2xl font-bold text-white tracking-tight">Gerenciar pessoas</h1>
              <button onClick={abrirNovoUser} className="flex items-center gap-2 px-4 py-2 bg-[#0a003d] text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition-colors shadow-[0_18px_55px_rgba(0,0,0,0.22)]">
                <PlusCircle size={16} /> Convidar pessoas
              </button>
            </div>
            <div className="border border-white/10 rounded-xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.02)] bg-white/[0.055]">
              <table className="w-full text-sm text-left">
                <thead className="bg-white/[0.045]/80 border-b border-white/10">
                  <tr><th className="px-6 py-4 text-xs font-semibold text-white/55 uppercase tracking-wider">Nome</th><th className="px-6 py-4 text-xs font-semibold text-white/55 uppercase tracking-wider">E-mail</th><th className="px-6 py-4 text-xs font-semibold text-white/55 uppercase tracking-wider">Função</th><th className="px-6 py-4 text-xs font-semibold text-white/55 uppercase tracking-wider text-right">Ação</th></tr>
                </thead>
                <tbody>
                  {usuariosSistema.map(p => (
                    <tr key={p.id} className="border-b border-gray-50 last:border-0 hover:bg-white/[0.045]/50 transition-colors">
                      <td className="px-6 py-4 flex items-center gap-3">
                        {p.avatar_url ? (
                            <img src={p.avatar_url} alt={p.nome} className="w-8 h-8 rounded-full object-cover border border-white/10" />
                        ) : (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs bg-white/[0.055] text-white/65 border border-white/10">{p.nome.substring(0, 2).toUpperCase()}</div>
                        )}
                        <span className="font-medium text-white">{p.nome}</span>
                      </td>
                      <td className="px-6 py-4 text-white/55">{p.email}</td>
                      <td className="px-6 py-4"><span className="px-2.5 py-1 rounded bg-white/[0.055] text-white/80 text-[11px] font-semibold uppercase tracking-wider">{p.papel}</span></td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => abrirEdicaoUser(p)} className="p-1.5 text-white/40 hover:text-[#0097a7] rounded transition-colors"><Edit size={16}/></button>
                          <button onClick={() => apagarUsuario(p.id)} className="p-1.5 text-white/40 hover:text-red-500 rounded transition-colors"><Trash2 size={16}/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {usuariosSistema.length === 0 && <p className="text-center p-10 text-white/40 text-sm">Nenhum membro na equipe.</p>}
            </div>
          </div>
        )}

        {abaAtiva === 'imposto' && (
          <div className="max-w-2xl">
            <h1 className="text-2xl font-bold text-white tracking-tight mb-8">Tributação</h1>
            <div className="space-y-6">
                <div className="border border-white/10 bg-white/[0.055] backdrop-blur-2xl p-6 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
                    <div className="flex items-center gap-2 mb-2"><Percent className="text-white/40" size={18}/><h3 className="text-sm font-semibold text-white">Simples Nacional (Anexo V)</h3></div>
                    <p className="text-xs text-white/55 mb-5">Usado para cálculo da reserva tributária no Dashboard.</p>
                    <div className="relative max-w-[140px]">
                      <input type="number" step="0.01" className="w-full pl-4 pr-10 py-2.5 text-sm border border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] font-medium" value={configFiscais.sn_percentual} onChange={e => setConfigFiscais({...configFiscais, sn_percentual: parseFloat(e.target.value)})} />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 font-medium">%</span>
                    </div>
                </div>
                <div className="pt-4">
                  <button onClick={salvarConfiguracoesFiscais} className="flex items-center gap-2 px-5 py-2.5 bg-[#0a003d] text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition-colors shadow-[0_18px_55px_rgba(0,0,0,0.22)]"><Save size={16} /> Salvar Alterações</button>
                </div>
            </div>
          </div>
        )}

      </div>

      {modalUserAberto && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white/[0.055] backdrop-blur-2xl p-8 rounded-xl w-full max-w-sm shadow-2xl border border-white/10">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">{edicaoUserId ? "Editar Membro" : "Novo Membro"}</h2>
              <button onClick={() => setModalUserAberto(false)} className="p-1 text-white/40 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={salvarUsuario} className="space-y-4">
              <div><label className="block text-[13px] font-medium mb-1 text-white/80">Nome</label><input required type="text" className="w-full p-2.5 text-sm border border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] transition-all" value={formUser.nome} onChange={e => setFormUser({...formUser, nome: e.target.value})}/></div>
              <div><label className="block text-[13px] font-medium mb-1 text-white/80">E-mail</label><input required type="email" disabled={!!edicaoUserId} className="w-full p-2.5 text-sm border border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] disabled:bg-white/[0.04] disabled:text-white/35 transition-all" value={formUser.email} onChange={e => setFormUser({...formUser, email: e.target.value})}/></div>
              <div>
                <label className="block text-[13px] font-medium mb-1 text-white/80">Papel</label>
                <select className="w-full p-2.5 text-sm border border-white/10 rounded-lg outline-none focus:ring-2 focus:ring-[#0097a7] bg-white/[0.055] transition-all" value={formUser.papel} onChange={e => setFormUser({...formUser, papel: e.target.value})}>
                  <option value="Admin">Admin</option><option value="Financeiro">Financeiro</option><option value="Membro">Membro</option>
                </select>
              </div>
              <button type="submit" className="w-full py-2.5 bg-[#0a003d] text-white rounded-lg text-sm font-medium mt-4 hover:bg-gray-900 transition-colors shadow-[0_18px_55px_rgba(0,0,0,0.22)]">
                {edicaoUserId ? "Salvar" : "Adicionar"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


