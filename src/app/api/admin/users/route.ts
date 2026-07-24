import {
  createClient,
  type User,
} from "@supabase/supabase-js";
import {
  NextResponse,
} from "next/server";
import {
  createSupabaseAdmin,
} from "@/lib/supabase-admin";

type AccessRole =
  | "admin"
  | "viewer";

type UserMutationBody = {
  householdId?: string;
  userId?: string;
  email?: string;
  name?: string;
  accessRole?: AccessRole;
};

function getAccessToken(
  request: Request,
) {
  const authorization =
    request.headers.get(
      "authorization",
    );

  if (
    !authorization?.startsWith(
      "Bearer ",
    )
  ) {
    return null;
  }

  return authorization
    .slice(7)
    .trim();
}

function createAuthorizedClient(
  accessToken: string,
) {
  const supabaseUrl =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL
      ?.trim();

  const publishableKey = (
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env
      .NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (
    !supabaseUrl ||
    !publishableKey
  ) {
    throw new Error(
      "Supabase não configurado.",
    );
  }

  return createClient(
    supabaseUrl,
    publishableKey,
    {
      global: {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },
      },

      auth: {
        autoRefreshToken:
          false,

        persistSession:
          false,
      },
    },
  );
}

async function getAuthorizedAdmin(
  request: Request,
  householdId: string,
) {
  const accessToken =
    getAccessToken(
      request,
    );

  if (!accessToken) {
    throw new Error(
      "Sessão não informada.",
    );
  }

  const supabase =
    createAuthorizedClient(
      accessToken,
    );

  const {
    data: userResult,
    error: userError,
  } =
    await supabase.auth.getUser();

  if (
    userError ||
    !userResult.user
  ) {
    throw new Error(
      "Sua sessão expirou.",
    );
  }

  const {
    data: membership,
    error: membershipError,
  } = await supabase
    .from(
      "pf_household_members",
    )
    .select("role")
    .eq(
      "household_id",
      householdId,
    )
    .eq(
      "user_id",
      userResult.user.id,
    )
    .maybeSingle();

  if (
    membershipError ||
    !membership ||
    ![
      "owner",
      "member",
    ].includes(
      String(
        membership.role,
      ),
    )
  ) {
    throw new Error(
      "Apenas administradores podem gerenciar acessos.",
    );
  }

  return {
    supabase,
    user:
      userResult.user,

    role:
      String(
        membership.role,
      ),
  };
}

async function findUserByEmail(
  email: string,
) {
  const admin =
    createSupabaseAdmin();

  const normalizedEmail =
    email
      .trim()
      .toLowerCase();

  for (
    let page = 1;
    page <= 10;
    page += 1
  ) {
    const {
      data,
      error,
    } =
      await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });

    if (error) {
      throw error;
    }

    const found =
      data.users.find(
        (user) =>
          user.email
            ?.toLowerCase() ===
          normalizedEmail,
      );

    if (found) {
      return found;
    }

    if (
      data.users.length <
      200
    ) {
      break;
    }
  }

  return null;
}

function mapUser(
  user: User,
  membership: {
    role: string;
    created_at?: string | null;
  },
) {
  return {
    id:
      user.id,

    email:
      user.email ??
      "",

    name:
      String(
        user.user_metadata
          ?.name ??
        user.user_metadata
          ?.full_name ??
        user.email
          ?.split("@")[0] ??
        "Usuário",
      ),

    accessRole:
      membership.role ===
      "viewer"
        ? "viewer"
        : "admin",

    internalRole:
      membership.role,

    invitedAt:
      user.invited_at ??
      null,

    lastSignInAt:
      user.last_sign_in_at ??
      null,

    emailConfirmed:
      Boolean(
        user.email_confirmed_at,
      ),
  };
}

export async function GET(
  request: Request,
) {
  try {
    const url =
      new URL(
        request.url,
      );

    const householdId =
      url.searchParams
        .get(
          "householdId",
        )
        ?.trim();

    if (!householdId) {
      throw new Error(
        "Grupo familiar não informado.",
      );
    }

    const {
      supabase,
    } =
      await getAuthorizedAdmin(
        request,
        householdId,
      );

    const {
      data: members,
      error: membersError,
    } = await supabase
      .from(
        "pf_household_members",
      )
      .select(
        "user_id, role, created_at",
      )
      .eq(
        "household_id",
        householdId,
      )
      .order(
        "created_at",
      );

    if (membersError) {
      throw membersError;
    }

    const admin =
      createSupabaseAdmin();

    const users =
      await Promise.all(
        (
          members ??
          []
        ).map(
          async (
            membership,
          ) => {
            const {
              data,
              error,
            } =
              await admin.auth.admin.getUserById(
                String(
                  membership.user_id,
                ),
              );

            if (
              error ||
              !data.user
            ) {
              return null;
            }

            return mapUser(
              data.user,
              {
                role:
                  String(
                    membership.role,
                  ),

                created_at:
                  membership.created_at
                    ? String(
                        membership.created_at,
                      )
                    : null,
              },
            );
          },
        ),
      );

    return NextResponse.json({
      users:
        users.filter(
          Boolean,
        ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os usuários.",
      },
      {
        status:
          400,
      },
    );
  }
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as
        UserMutationBody;

    const householdId =
      body.householdId
        ?.trim();

    const email =
      body.email
        ?.trim()
        .toLowerCase();

    const name =
      body.name?.trim();

    const accessRole =
      body.accessRole;

    if (
      !householdId ||
      !email ||
      !name
    ) {
      throw new Error(
        "Nome, e-mail e grupo familiar são obrigatórios.",
      );
    }

    if (
      accessRole !==
        "admin" &&
      accessRole !==
        "viewer"
    ) {
      throw new Error(
        "O tipo de acesso é inválido.",
      );
    }

    const {
      supabase,
    } =
      await getAuthorizedAdmin(
        request,
        householdId,
      );

    const admin =
      createSupabaseAdmin();

    const redirectTo =
      new URL(
        "/auth/definir-senha",
        request.url,
      ).toString();

    let invitedUser:
      | User
      | null = null;

    const {
      data:
        invitationResult,
      error:
        invitationError,
    } =
      await admin.auth.admin.inviteUserByEmail(
        email,
        {
          data: {
            name,
          },

          redirectTo,
        },
      );

    if (
      invitationResult.user
    ) {
      invitedUser =
        invitationResult.user;
    }

    if (
      invitationError
    ) {
      invitedUser =
        await findUserByEmail(
          email,
        );

      if (!invitedUser) {
        throw invitationError;
      }
    }

    if (!invitedUser) {
      throw new Error(
        "O usuário não foi criado nem encontrado.",
      );
    }

    const {
      error:
        membershipError,
    } = await supabase
      .from(
        "pf_household_members",
      )
      .upsert(
        {
          household_id:
            householdId,

          user_id:
            invitedUser.id,

          role:
            accessRole ===
            "viewer"
              ? "viewer"
              : "member",
        },
        {
          onConflict:
            "household_id,user_id",
        },
      );

    if (
      membershipError
    ) {
      throw membershipError;
    }

    return NextResponse.json({
      success:
        true,

      user:
        mapUser(
          invitedUser,
          {
            role:
              accessRole ===
              "viewer"
                ? "viewer"
                : "member",
          },
        ),

      inviteSent:
        !invitationError,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível convidar o usuário.",
      },
      {
        status:
          400,
      },
    );
  }
}

export async function PATCH(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as
        UserMutationBody;

    const householdId =
      body.householdId
        ?.trim();

    const userId =
      body.userId
        ?.trim();

    const accessRole =
      body.accessRole;

    if (
      !householdId ||
      !userId
    ) {
      throw new Error(
        "Usuário e grupo familiar são obrigatórios.",
      );
    }

    if (
      accessRole !==
        "admin" &&
      accessRole !==
        "viewer"
    ) {
      throw new Error(
        "O tipo de acesso é inválido.",
      );
    }

    const {
      supabase,
    } =
      await getAuthorizedAdmin(
        request,
        householdId,
      );

    const {
      data:
        currentMembership,
      error:
        currentError,
    } = await supabase
      .from(
        "pf_household_members",
      )
      .select("role")
      .eq(
        "household_id",
        householdId,
      )
      .eq(
        "user_id",
        userId,
      )
      .maybeSingle();

    if (
      currentError ||
      !currentMembership
    ) {
      throw new Error(
        "O acesso do usuário não foi encontrado.",
      );
    }

    if (
      currentMembership.role ===
      "owner"
    ) {
      throw new Error(
        "O acesso do proprietário não pode ser alterado por esta tela.",
      );
    }

    const {
      error:
        updateError,
    } = await supabase
      .from(
        "pf_household_members",
      )
      .update({
        role:
          accessRole ===
          "viewer"
            ? "viewer"
            : "member",
      })
      .eq(
        "household_id",
        householdId,
      )
      .eq(
        "user_id",
        userId,
      );

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success:
        true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível alterar o acesso.",
      },
      {
        status:
          400,
      },
    );
  }
}

export async function DELETE(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as
        UserMutationBody;

    const householdId =
      body.householdId
        ?.trim();

    const userId =
      body.userId
        ?.trim();

    if (
      !householdId ||
      !userId
    ) {
      throw new Error(
        "Usuário e grupo familiar são obrigatórios.",
      );
    }

    const {
      supabase,
      user,
    } =
      await getAuthorizedAdmin(
        request,
        householdId,
      );

    if (
      user.id === userId
    ) {
      throw new Error(
        "Você não pode remover o próprio acesso.",
      );
    }

    const {
      data:
        currentMembership,
      error:
        currentError,
    } = await supabase
      .from(
        "pf_household_members",
      )
      .select("role")
      .eq(
        "household_id",
        householdId,
      )
      .eq(
        "user_id",
        userId,
      )
      .maybeSingle();

    if (
      currentError ||
      !currentMembership
    ) {
      throw new Error(
        "O acesso do usuário não foi encontrado.",
      );
    }

    if (
      currentMembership.role ===
      "owner"
    ) {
      throw new Error(
        "O proprietário não pode ser removido.",
      );
    }

    const {
      error:
        deleteError,
    } = await supabase
      .from(
        "pf_household_members",
      )
      .delete()
      .eq(
        "household_id",
        householdId,
      )
      .eq(
        "user_id",
        userId,
      );

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      success:
        true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível remover o acesso.",
      },
      {
        status:
          400,
      },
    );
  }
}
