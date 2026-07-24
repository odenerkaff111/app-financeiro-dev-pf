"use client";

import {
  useEffect,
  useState,
} from "react";
import {
  useRouter,
} from "next/navigation";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
} from "lucide-react";
import {
  supabase,
} from "@/lib/supabase";

export default function DefinirSenhaPage() {
  const router =
    useRouter();

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    confirmation,
    setConfirmation,
  ] = useState("");

  const [
    checking,
    setChecking,
  ] = useState(true);

  const [
    hasSession,
    setHasSession,
  ] = useState(false);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  useEffect(() => {
    let active =
      true;

    async function checkSession() {
      const {
        data,
      } =
        await supabase.auth.getSession();

      if (!active) {
        return;
      }

      setHasSession(
        Boolean(
          data.session,
        ),
      );

      setChecking(
        false,
      );
    }

    void checkSession();

    const {
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        (
          event,
          session,
        ) => {
          if (!active) {
            return;
          }

          if (
            event ===
              "PASSWORD_RECOVERY" ||
            event ===
              "SIGNED_IN"
          ) {
            setHasSession(
              Boolean(
                session,
              ),
            );

            setChecking(
              false,
            );
          }
        },
      );

    return () => {
      active =
        false;

      subscription.unsubscribe();
    };
  }, []);

  async function savePassword(
    event:
      React.FormEvent,
  ) {
    event.preventDefault();

    setError("");

    if (
      password.length <
      8
    ) {
      setError(
        "A senha precisa ter pelo menos 8 caracteres.",
      );

      return;
    }

    if (
      password !==
      confirmation
    ) {
      setError(
        "As senhas não coincidem.",
      );

      return;
    }

    setSaving(
      true,
    );

    const {
      error:
        updateError,
    } =
      await supabase.auth.updateUser({
        password,
      });

    if (updateError) {
      setError(
        updateError.message,
      );

      setSaving(
        false,
      );

      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#F7F5EF] px-5 py-10 text-[#0D1B2A]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_12%,rgba(200,161,90,0.22),transparent_28%),radial-gradient(circle_at_88%_88%,rgba(13,27,42,0.10),transparent_32%)]" />

      <section className="relative w-full max-w-md rounded-[28px] border border-[#0D1B2A]/10 bg-white p-7 shadow-[0_30px_100px_rgba(13,27,42,0.15)] sm:p-9">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0D1B2A] text-[#C8A15A]">
          {hasSession ? (
            <KeyRound
              size={22}
            />
          ) : (
            <CheckCircle2
              size={22}
            />
          )}
        </div>

        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
          Grupo Umsó
        </p>

        <h1 className="mt-2 font-serif text-4xl font-semibold">
          Definir senha
        </h1>

        {checking ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
          </div>
        ) : hasSession ? (
          <form
            onSubmit={
              savePassword
            }
            className="mt-7 space-y-5"
          >
            <label className="block">
              <span className="mb-2 block text-sm font-medium">
                Nova senha
              </span>

              <input
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={password}
                onChange={(
                  event,
                ) =>
                  setPassword(
                    event.target.value,
                  )
                }
                className="h-12 w-full rounded-xl border border-[#0D1B2A]/12 bg-[#F7F5EF] px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/15"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium">
                Confirmar senha
              </span>

              <input
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={
                  confirmation
                }
                onChange={(
                  event,
                ) =>
                  setConfirmation(
                    event.target.value,
                  )
                }
                className="h-12 w-full rounded-xl border border-[#0D1B2A]/12 bg-[#F7F5EF] px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/15"
              />
            </label>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={
                saving
              }
              className="flex h-12 w-full items-center justify-center rounded-xl bg-[#0D1B2A] text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Salvar senha e entrar"
              )}
            </button>
          </form>
        ) : (
          <div className="mt-7 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
            Este link é inválido ou expirou. Solicite um novo convite ao administrador ou use “Esqueci minha senha” na tela de acesso.
          </div>
        )}
      </section>
    </main>
  );
}
