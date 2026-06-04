"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2, Lock, Mail } from "lucide-react";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : signInError.message
      );
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#090814] px-6 py-10 text-white">
      <div className="pointer-events-none absolute -left-32 top-[-120px] h-96 w-96 rounded-full bg-fuchsia-600/30 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-140px] right-[-100px] h-[420px] w-[420px] rounded-full bg-cyan-400/30 blur-[130px]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[160px]" />

      <section className="relative w-full max-w-[430px] rounded-[34px] border border-white/20 bg-white/[0.08] p-8 shadow-[0_30px_100px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
        <div className="mb-9 text-center">
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">
            Meu Dinheiro PF
          </h1>
          <p className="mt-3 text-sm text-white/65">
            Acesse sua conta para continuar
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <label className="group flex items-center gap-3 border-b border-white/35 px-1 pb-3 transition focus-within:border-cyan-300">
            <Mail className="h-4 w-4 text-white/60 transition group-focus-within:text-cyan-200" />
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="E-mail"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="group flex items-center gap-3 border-b border-white/35 px-1 pb-3 transition focus-within:border-cyan-300">
            <Lock className="h-4 w-4 text-white/60 transition group-focus-within:text-cyan-200" />
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Senha"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <div className="flex items-center justify-between pt-1 text-xs text-white/55">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/30 bg-white/10 accent-cyan-300"
              />
              Lembrar acesso
            </label>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-center text-xs text-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-fuchsia-600 via-purple-600 to-cyan-500 text-sm font-bold uppercase tracking-[0.22em] text-white shadow-[0_16px_45px_rgba(59,130,246,0.35)] transition hover:scale-[1.01] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
