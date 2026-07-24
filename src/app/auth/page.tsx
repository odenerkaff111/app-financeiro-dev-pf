"use client";

import {
  useState,
} from "react";
import {
  useRouter,
} from "next/navigation";
import {
  ArrowRight,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import {
  supabase,
} from "@/lib/supabase";

export default function AuthPage() {
  const router =
    useRouter();

  const [
    email,
    setEmail,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    sendingReset,
    setSendingReset,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    message,
    setMessage,
  ] = useState("");

  async function handleLogin(
    event:
      React.FormEvent,
  ) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setMessage("");

    const {
      error:
        signInError,
    } =
      await supabase.auth.signInWithPassword({
        email:
          email.trim(),

        password,
      });

    if (signInError) {
      setError(
        signInError.message ===
        "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : signInError.message,
      );

      setLoading(
        false,
      );

      return;
    }

    router.replace("/");
    router.refresh();
  }

  async function handleResetPassword() {
    const normalizedEmail =
      email
        .trim()
        .toLowerCase();

    if (!normalizedEmail) {
      setError(
        "Informe seu e-mail antes de solicitar uma nova senha.",
      );

      return;
    }

    setSendingReset(
      true,
    );

    setError("");
    setMessage("");

    const redirectTo =
      `${window.location.origin}/auth/definir-senha`;

    const {
      error:
        resetError,
    } =
      await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo,
        },
      );

    if (resetError) {
      setError(
        resetError.message,
      );
    } else {
      setMessage(
        "Enviamos um link para você definir uma nova senha.",
      );
    }

    setSendingReset(
      false,
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#F7F5EF] px-5 py-10 text-[#0D1B2A]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_12%,rgba(200,161,90,0.22),transparent_28%),radial-gradient(circle_at_88%_88%,rgba(13,27,42,0.10),transparent_32%)]" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-[#0D1B2A]/10 bg-white shadow-[0_30px_100px_rgba(13,27,42,0.16)] lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden overflow-hidden bg-[#0D1B2A] p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(200,161,90,0.28),transparent_34%),radial-gradient(circle_at_90%_90%,rgba(255,255,255,0.08),transparent_36%)]" />

          <div className="relative">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#C8A15A]/40 bg-white/5 text-[#C8A15A]">
              <ShieldCheck
                size={27}
              />
            </div>

            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.28em] text-[#C8A15A]">
              Grupo Umsó
            </p>

            <h1 className="mt-4 max-w-md font-serif text-5xl font-semibold leading-[1.02]">
              Clareza para construir liberdade financeira.
            </h1>

            <p className="mt-5 max-w-md text-sm leading-7 text-white/65">
              Organize sua realidade, acompanhe sua evolução e tome decisões com mais consciência.
            </p>
          </div>

          <div className="relative rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-white/65">
            Seus dados financeiros são privados e o acesso é concedido somente por um administrador.
          </div>
        </section>

        <section className="p-7 sm:p-10 lg:p-12">
          <div className="mx-auto w-full max-w-sm">
            <div className="lg:hidden">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#C8A15A]">
                Grupo Umsó
              </p>
            </div>

            <h2 className="mt-3 font-serif text-4xl font-semibold">
              Acessar
            </h2>

            <p className="mt-2 text-sm leading-6 text-[#3A3A3C]/60">
              Entre com o acesso criado pelo administrador.
            </p>

            <form
              onSubmit={
                handleLogin
              }
              className="mt-8 space-y-5"
            >
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  E-mail
                </span>

                <div className="flex h-12 items-center gap-3 rounded-xl border border-[#0D1B2A]/12 bg-[#F7F5EF] px-4 focus-within:border-[#C8A15A] focus-within:ring-2 focus-within:ring-[#C8A15A]/15">
                  <Mail
                    size={17}
                    className="text-[#3A3A3C]/45"
                  />

                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(
                      event,
                    ) =>
                      setEmail(
                        event.target.value,
                      )
                    }
                    placeholder="seu@email.com"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#3A3A3C]/35"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Senha
                </span>

                <div className="flex h-12 items-center gap-3 rounded-xl border border-[#0D1B2A]/12 bg-[#F7F5EF] px-4 focus-within:border-[#C8A15A] focus-within:ring-2 focus-within:ring-[#C8A15A]/15">
                  <Lock
                    size={17}
                    className="text-[#3A3A3C]/45"
                  />

                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="current-password"
                    value={password}
                    onChange={(
                      event,
                    ) =>
                      setPassword(
                        event.target.value,
                      )
                    }
                    placeholder="Sua senha"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#3A3A3C]/35"
                  />
                </div>
              </label>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {message && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] text-sm font-semibold text-white shadow-lg transition hover:bg-[#172D43] disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Entrar
                    <ArrowRight
                      size={17}
                    />
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              onClick={() =>
                void handleResetPassword()
              }
              disabled={
                sendingReset
              }
              className="mt-4 flex w-full items-center justify-center gap-2 text-sm font-medium text-[#3A3A3C]/60 transition hover:text-[#0D1B2A] disabled:opacity-60"
            >
              {sendingReset ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound
                  size={15}
                />
              )}

              Esqueci minha senha
            </button>

            <p className="mt-8 text-center text-xs leading-5 text-[#3A3A3C]/45">
              Não existe cadastro público. Novos acessos são criados apenas pelo administrador.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
