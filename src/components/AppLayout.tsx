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
      <div className="flex min-h-screen items-center justify-center bg-white text-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-gray-900">
      <div className="relative flex min-h-screen">
        <Sidebar />
        <section className="flex-1 bg-white p-4 md:p-6 lg:p-8">
          {children}
        </section>
      </div>
    </main>
  );
}


