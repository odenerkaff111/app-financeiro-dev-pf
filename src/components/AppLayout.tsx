"use client";

import { Sidebar } from "./Sidebar";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = pathname?.startsWith("/auth");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session && !isAuthPage) router.replace("/auth");
      else if (session && isAuthPage) router.replace("/");

      setLoading(false);
    };

    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session && !isAuthPage) router.replace("/auth");
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [pathname, router, isAuthPage]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090814] text-white">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
      </div>
    );
  }

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#090814] text-slate-100">
      <div className="pointer-events-none fixed -left-32 top-[-120px] h-96 w-96 rounded-full bg-fuchsia-600/20 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-[-160px] right-[-120px] h-[460px] w-[460px] rounded-full bg-cyan-400/20 blur-[130px]" />
      <div className="pointer-events-none fixed left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[170px]" />

      <div className="relative flex min-h-screen">
        <Sidebar />
        <section className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="min-h-[calc(100vh-4rem)] rounded-[32px] border border-white/10 bg-white/[0.06] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:p-6 lg:p-8">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
