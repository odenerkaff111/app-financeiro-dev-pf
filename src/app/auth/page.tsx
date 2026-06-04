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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#080512] px-6 py-10 text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_18%_18%,rgba(168,85,247,0.34),transparent_32%),radial-gradient(circle_at_82%_78%,rgba(34,211,238,0.24),transparent_34%),radial-gradient(circle_at_50%_50%,rgba(236,72,153,0.15),transparent_42%)]" />
      <div className="pointer-events-none absolute -left-40 top-[-160px] z-0 h-[460px] w-[460px] rounded-full bg-purple-700/40 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-[-180px] right-[-120px] z-0 h-[520px] w-[520px] rounded-full bg-cyan-400/25 blur-[150px]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[580px] w-[580px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-500/10 blur-[170px]" />

      <section className="relative z-10 w-full max-w-[440px]">
        <div className="pointer-events-none absolute -inset-[2px] z-0 rounded-[40px] bg-gradient-to-br from-fuchsia-400/70 via-purple-500/45 to-cyan-300/60 opacity-80 blur-[1px]" />
        <div className="pointer-events-none absolute -inset-5 z-0 rounded-[52px] bg-gradient-to-br from-fuchsia-500/25 via-purple-600/10 to-cyan-300/25 blur-2xl" />
        <div className="pointer-events-none absolute -left-10 top-16 z-0 h-28 w-2 rounded-full bg-cyan-300/70 blur-md" />
        <div className="pointer-events-none absolute -right-8 bottom-16 z-0 h-28 w-2 rounded-full bg-fuchsia-400/70 blur-md" />

        <div className="relative z-10 overflow-hidden rounded-[40px] border border-white/20 bg-white/[0.08] p-8 shadow-[0_35px_120px_rgba(0,0,0,0.62)] backdrop-blur-3xl before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[40px] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.24),rgba(255,255,255,0.04)_38%,rgba(255,255,255,0.12)_100%)] before:content-[''] after:pointer-events-none after:absolute after:inset-px after:z-0 after:rounded-[39px] after:border after:border-white/10 after:content-['']">
          <div className="pointer-events-none absolute -left-16 -top-20 z-0 h-56 w-56 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -right-20 z-0 h-64 w-64 rounded-full bg-cyan-300/20 blur-3xl" />

          <div className="relative z-20 mb-9 text-center">
            <h1 className="bg-gradient-to-r from-white via-fuchsia-100 to-cyan-100 bg-clip-text text-4xl font-semibold tracking-[-0.055em] text-transparent">
              Kyra
            </h1>
            <p className="mt-3 text-sm text-white/68">
              Acesse sua conta para continuar
            </p>
          </div>

          <form onSubmit={handleLogin} className="relative z-20 space-y-5">
            <label className="group flex items-center gap-3 border-b border-white/35 px-1 pb-3 transition focus-within:border-cyan-200">
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

            <label className="group flex items-center gap-3 border-b border-white/35 px-1 pb-3 transition focus-within:border-cyan-200">
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

            <div className="flex items-center justify-between pt-1 text-xs text-white/56">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-white/30 bg-white/10 accent-fuchsia-400"
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
              className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-fuchsia-700 via-purple-600 to-cyan-500 text-sm font-bold uppercase tracking-[0.24em] text-white shadow-[0_18px_55px_rgba(168,85,247,0.42)] transition hover:scale-[1.01] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Entrar"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
