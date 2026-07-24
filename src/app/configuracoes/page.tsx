"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  supabase,
} from "@/lib/supabase";
import {
  useHousehold,
} from "@/contexts/HouseholdContext";

type AccessRole =
  | "admin"
  | "viewer";

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  accessRole: AccessRole;
  internalRole:
    | "owner"
    | "member"
    | "viewer";
  invitedAt: string | null;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
};

type InviteForm = {
  name: string;
  email: string;
  accessRole: AccessRole;
};

export default function ConfiguracoesPage() {
  const {
    household,
    isAdmin,
    isViewer,
    roleLabel,
  } =
    useHousehold();

  const [
    activeSection,
    setActiveSection,
  ] = useState<
    "profile" | "people"
  >("profile");

  const [
    currentUserId,
    setCurrentUserId,
  ] = useState("");

  const [
    email,
    setEmail,
  ] = useState("");

  const [
    name,
    setName,
  ] = useState("");

  const [
    users,
    setUsers,
  ] = useState<
    ManagedUser[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    loadingUsers,
    setLoadingUsers,
  ] = useState(false);

  const [
    savingProfile,
    setSavingProfile,
  ] = useState(false);

  const [
    inviteOpen,
    setInviteOpen,
  ] = useState(false);

  const [
    savingInvite,
    setSavingInvite,
  ] = useState(false);

  const [
    inviteForm,
    setInviteForm,
  ] = useState<InviteForm>({
    name: "",
    email: "",
    accessRole:
      "viewer",
  });

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  const [
    success,
    setSuccess,
  ] = useState<
    string | null
  >(null);

  const initials =
    useMemo(() => {
      const source =
        name.trim() ||
        email.trim() ||
        "GU";

      return source
        .split(/\s+/)
        .slice(0, 2)
        .map(
          (part) =>
            part[0],
        )
        .join("")
        .toUpperCase();
    }, [
      email,
      name,
    ]);

  async function getAccessToken() {
    const {
      data,
    } =
      await supabase.auth.getSession();

    const accessToken =
      data.session
        ?.access_token;

    if (!accessToken) {
      throw new Error(
        "Sua sessão expirou.",
      );
    }

    return accessToken;
  }

  const loadUsers =
    useCallback(
      async () => {
        if (!isAdmin) {
          setUsers([]);
          return;
        }

        setLoadingUsers(
          true,
        );

        try {
          const accessToken =
            await getAccessToken();

          const query =
            new URLSearchParams({
              householdId:
                household.id,
            });

          const response =
            await fetch(
              `/api/admin/users?${query.toString()}`,
              {
                headers: {
                  Authorization:
                    `Bearer ${accessToken}`,
                },
              },
            );

          const body =
            (await response.json()) as {
              users?: ManagedUser[];
              error?: string;
            };

          if (!response.ok) {
            throw new Error(
              body.error ||
                "Não foi possível carregar os usuários.",
            );
          }

          setUsers(
            body.users ??
            [],
          );
        } catch (
          loadError
        ) {
          setError(
            loadError instanceof
            Error
              ? loadError.message
              : "Não foi possível carregar os usuários.",
          );
        } finally {
          setLoadingUsers(
            false,
          );
        }
      },
      [
        household.id,
        isAdmin,
      ],
    );

  useEffect(() => {
    let active =
      true;

    async function loadProfile() {
      setLoading(
        true,
      );

      const {
        data,
        error:
          userError,
      } =
        await supabase.auth.getUser();

      if (!active) {
        return;
      }

      if (
        userError ||
        !data.user
      ) {
        setError(
          "Não foi possível carregar seu perfil.",
        );

        setLoading(
          false,
        );

        return;
      }

      setCurrentUserId(
        data.user.id,
      );

      setEmail(
        data.user.email ??
        "",
      );

      setName(
        String(
          data.user
            .user_metadata
            ?.name ??
          data.user
            .user_metadata
            ?.full_name ??
          "",
        ),
      );

      setLoading(
        false,
      );
    }

    void loadProfile();

    return () => {
      active =
        false;
    };
  }, []);

  useEffect(() => {
    if (
      activeSection ===
        "people" &&
      isAdmin
    ) {
      void loadUsers();
    }
  }, [
    activeSection,
    isAdmin,
    loadUsers,
  ]);

  async function saveProfile() {
    setSavingProfile(
      true,
    );

    setError(null);
    setSuccess(null);

    const {
      error:
        updateError,
    } =
      await supabase.auth.updateUser({
        data: {
          name:
            name.trim(),
        },
      });

    if (updateError) {
      setError(
        updateError.message,
      );
    } else {
      setSuccess(
        "Perfil atualizado.",
      );
    }

    setSavingProfile(
      false,
    );
  }

  async function inviteUser(
    event:
      React.FormEvent,
  ) {
    event.preventDefault();

    setSavingInvite(
      true,
    );

    setError(null);
    setSuccess(null);

    try {
      const accessToken =
        await getAccessToken();

      const response =
        await fetch(
          "/api/admin/users",
          {
            method:
              "POST",

            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                householdId:
                  household.id,

                ...inviteForm,
              }),
          },
        );

      const body =
        (await response.json()) as {
          error?: string;
          inviteSent?: boolean;
        };

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Não foi possível conceder o acesso.",
        );
      }

      setSuccess(
        body.inviteSent
          ? "Convite enviado por e-mail."
          : "O usuário já existia e recebeu acesso ao grupo.",
      );

      setInviteOpen(
        false,
      );

      setInviteForm({
        name: "",
        email: "",
        accessRole:
          "viewer",
      });

      await loadUsers();
    } catch (
      inviteError
    ) {
      setError(
        inviteError instanceof
        Error
          ? inviteError.message
          : "Não foi possível conceder o acesso.",
      );
    } finally {
      setSavingInvite(
        false,
      );
    }
  }

  async function changeRole(
    user:
      ManagedUser,
    accessRole:
      AccessRole,
  ) {
    setError(null);
    setSuccess(null);

    try {
      const accessToken =
        await getAccessToken();

      const response =
        await fetch(
          "/api/admin/users",
          {
            method:
              "PATCH",

            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                householdId:
                  household.id,

                userId:
                  user.id,

                accessRole,
              }),
          },
        );

      const body =
        (await response.json()) as {
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Não foi possível alterar o acesso.",
        );
      }

      setSuccess(
        "Tipo de acesso atualizado.",
      );

      await loadUsers();
    } catch (
      roleError
    ) {
      setError(
        roleError instanceof
        Error
          ? roleError.message
          : "Não foi possível alterar o acesso.",
      );
    }
  }

  async function removeAccess(
    user:
      ManagedUser,
  ) {
    const confirmed =
      window.confirm(
        `Remover o acesso de ${user.name}?`,
      );

    if (!confirmed) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const accessToken =
        await getAccessToken();

      const response =
        await fetch(
          "/api/admin/users",
          {
            method:
              "DELETE",

            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                householdId:
                  household.id,

                userId:
                  user.id,
              }),
          },
        );

      const body =
        (await response.json()) as {
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Não foi possível remover o acesso.",
        );
      }

      setSuccess(
        "Acesso removido.",
      );

      await loadUsers();
    } catch (
      deleteError
    ) {
      setError(
        deleteError instanceof
        Error
          ? deleteError.message
          : "Não foi possível remover o acesso.",
      );
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
          Configurações
        </p>

        <h1 className="mt-2 font-serif text-4xl font-semibold text-[#0D1B2A]">
          Acesso e perfil
        </h1>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/65">
          Gerencie seus dados pessoais e, como administrador, controle quem pode acessar as finanças da família.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2
            size={17}
          />

          {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-[#0D1B2A]/10 bg-white p-3 shadow-sm">
          <button
            type="button"
            onClick={() =>
              setActiveSection(
                "profile",
              )
            }
            className={[
              "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition",
              activeSection ===
              "profile"
                ? "bg-[#0D1B2A] text-white"
                : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
            ].join(" ")}
          >
            <ShieldCheck
              size={17}
            />
            Meu perfil
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() =>
                setActiveSection(
                  "people",
                )
              }
              className={[
                "mt-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition",
                activeSection ===
                "people"
                  ? "bg-[#0D1B2A] text-white"
                  : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
              ].join(" ")}
            >
              <Users
                size={17}
              />
              Pessoas e acessos
            </button>
          )}
        </aside>

        {activeSection ===
        "profile" ? (
          <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#0D1B2A] font-serif text-2xl font-semibold text-[#C8A15A]">
                {initials}
              </div>

              <div>
                <h2 className="text-xl font-semibold text-[#0D1B2A]">
                  Informações pessoais
                </h2>

                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#F7F5EF] px-3 py-1.5 text-xs font-semibold text-[#0D1B2A]">
                  {isViewer ? (
                    <Eye
                      size={14}
                    />
                  ) : (
                    <ShieldCheck
                      size={14}
                    />
                  )}

                  {roleLabel}
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Nome completo
                </span>

                <input
                  value={name}
                  onChange={(
                    event,
                  ) =>
                    setName(
                      event.target.value,
                    )
                  }
                  className="h-12 w-full rounded-xl border border-[#0D1B2A]/12 bg-[#F7F5EF] px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/15"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  E-mail
                </span>

                <div className="flex h-12 items-center gap-3 rounded-xl border border-[#0D1B2A]/8 bg-[#F7F5EF] px-4 text-sm text-[#3A3A3C]/55">
                  <Mail
                    size={16}
                  />

                  <span className="truncate">
                    {email}
                  </span>
                </div>
              </label>
            </div>

            <button
              type="button"
              onClick={() =>
                void saveProfile()
              }
              disabled={
                savingProfile
              }
              className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {savingProfile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save
                  size={16}
                />
              )}

              Salvar perfil
            </button>
          </section>
        ) : (
          <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#0D1B2A]">
                  Pessoas com acesso
                </h2>

                <p className="mt-1 text-sm text-[#3A3A3C]/55">
                  Administradores alteram dados. Visualizadores apenas consultam.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setInviteOpen(
                    true,
                  )
                }
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-5 text-sm font-semibold text-white"
              >
                <UserPlus
                  size={16}
                />
                Convidar
              </button>
            </div>

            {loadingUsers ? (
              <div className="flex min-h-56 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {users.map(
                  (user) => (
                    <article
                      key={
                        user.id
                      }
                      className="flex flex-col gap-4 rounded-xl border border-[#0D1B2A]/8 bg-[#F7F5EF] p-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white font-semibold text-[#0D1B2A] shadow-sm">
                          {user.name
                            .split(
                              /\s+/,
                            )
                            .slice(
                              0,
                              2,
                            )
                            .map(
                              (
                                part,
                              ) =>
                                part[0],
                            )
                            .join("")
                            .toUpperCase()}
                        </div>

                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#0D1B2A]">
                            {user.name}
                            {user.id ===
                            currentUserId
                              ? " · Você"
                              : ""}
                          </p>

                          <p className="truncate text-xs text-[#3A3A3C]/50">
                            {user.email}
                          </p>
                        </div>
                      </div>

                      {user.internalRole ===
                      "owner" ? (
                        <span className="rounded-full bg-[#C8A15A]/15 px-3 py-1.5 text-xs font-semibold text-[#8A6426]">
                          Proprietário
                        </span>
                      ) : (
                        <select
                          value={
                            user.accessRole
                          }
                          onChange={(
                            event,
                          ) =>
                            void changeRole(
                              user,
                              event
                                .target
                                .value as AccessRole,
                            )
                          }
                          className="h-10 rounded-xl border border-[#0D1B2A]/10 bg-white px-3 text-sm outline-none"
                        >
                          <option value="admin">
                            Administrador
                          </option>

                          <option value="viewer">
                            Visualizador
                          </option>
                        </select>
                      )}

                      {user.internalRole !==
                        "owner" &&
                        user.id !==
                          currentUserId && (
                          <button
                            type="button"
                            onClick={() =>
                              void removeAccess(
                                user,
                              )
                            }
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                          >
                            <Trash2
                              size={15}
                            />
                            Remover
                          </button>
                        )}
                    </article>
                  ),
                )}

                {users.length ===
                  0 && (
                  <div className="rounded-xl border border-dashed border-[#0D1B2A]/15 p-8 text-center text-sm text-[#3A3A3C]/55">
                    Nenhum usuário encontrado.
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {inviteOpen && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-[#0D1B2A]/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#0D1B2A]/10 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">
                  Convidar pessoa
                </h2>

                <p className="mt-1 text-sm text-[#3A3A3C]/55">
                  O acesso será enviado por e-mail.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setInviteOpen(
                    false,
                  )
                }
                className="rounded-lg p-2 text-[#3A3A3C]/50 hover:bg-[#F7F5EF]"
              >
                <X
                  size={19}
                />
              </button>
            </div>

            <form
              onSubmit={
                inviteUser
              }
              className="mt-6 space-y-4"
            >
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Nome
                </span>

                <input
                  required
                  value={
                    inviteForm.name
                  }
                  onChange={(
                    event,
                  ) =>
                    setInviteForm(
                      {
                        ...inviteForm,
                        name:
                          event.target.value,
                      },
                    )
                  }
                  className="h-11 w-full rounded-xl border border-[#0D1B2A]/12 px-4 text-sm outline-none focus:border-[#C8A15A]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  E-mail
                </span>

                <input
                  type="email"
                  required
                  value={
                    inviteForm.email
                  }
                  onChange={(
                    event,
                  ) =>
                    setInviteForm(
                      {
                        ...inviteForm,
                        email:
                          event.target.value,
                      },
                    )
                  }
                  className="h-11 w-full rounded-xl border border-[#0D1B2A]/12 px-4 text-sm outline-none focus:border-[#C8A15A]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Tipo de acesso
                </span>

                <select
                  value={
                    inviteForm.accessRole
                  }
                  onChange={(
                    event,
                  ) =>
                    setInviteForm(
                      {
                        ...inviteForm,

                        accessRole:
                          event
                            .target
                            .value as AccessRole,
                      },
                    )
                  }
                  className="h-11 w-full rounded-xl border border-[#0D1B2A]/12 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                >
                  <option value="viewer">
                    Visualizador
                  </option>

                  <option value="admin">
                    Administrador
                  </option>
                </select>
              </label>

              <button
                type="submit"
                disabled={
                  savingInvite
                }
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] text-sm font-semibold text-white disabled:opacity-60"
              >
                {savingInvite ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus
                    size={16}
                  />
                )}

                Enviar convite
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
