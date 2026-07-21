"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type HouseholdRole = "owner" | "member" | "viewer";

type Household = {
  id: string;
  name: string;
  role: HouseholdRole;
};

type HouseholdContextValue = {
  household: Household;
  refreshHousehold: () => Promise<void>;
};

type EnsureHouseholdRow = {
  household_id: string;
  household_name: string;
  member_role: HouseholdRole;
};

const HouseholdContext =
  createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [household, setHousehold] =
    useState<Household | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHousehold = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc(
      "pf_ensure_household",
      {
        default_name: "Nossa família",
      }
    );

    if (rpcError) {
      throw rpcError;
    }

    const row =
      (data as EnsureHouseholdRow[] | null)?.[0];

    if (!row) {
      throw new Error(
        "O Supabase não retornou o grupo familiar."
      );
    }

    setHousehold({
      id: row.household_id,
      name: row.household_name,
      role: row.member_role,
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;

    void loadHousehold().catch((loadError: unknown) => {
      if (!active) return;

      const message =
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível preparar os dados da família.";

      console.error(
        "Erro ao carregar grupo familiar:",
        loadError
      );

      setError(message);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [loadHousehold]);

  const value = useMemo<HouseholdContextValue | null>(() => {
    if (!household) return null;

    return {
      household,
      refreshHousehold: loadHousehold,
    };
  }, [household, loadHousehold]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-gray-900">
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          Preparando seu espaço financeiro...
        </div>
      </div>
    );
  }

  if (error || !value) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 text-gray-900">
        <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />

            <div>
              <h1 className="font-semibold text-red-900">
                Não foi possível abrir seu espaço financeiro
              </h1>

              <p className="mt-2 text-sm text-red-700">
                {error ?? "Grupo familiar não encontrado."}
              </p>

              <button
                type="button"
                onClick={() => void loadHousehold()}
                className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <HouseholdContext.Provider value={value}>
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  const context = useContext(HouseholdContext);

  if (!context) {
    throw new Error(
      "useHousehold deve ser usado dentro de HouseholdProvider."
    );
  }

  return context;
}