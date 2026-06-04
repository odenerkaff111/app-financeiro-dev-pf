"use client";

import { Sidebar } from "./Sidebar";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = pathname?.startsWith('/auth');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session && !isAuthPage) router.replace('/auth');
      else if (session && isAuthPage) router.replace('/');
      setLoading(false);
    };
    checkAuth();
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session && !isAuthPage) router.replace('/auth');
    });
    return () => { authListener.subscription.unsubscribe(); };
  }, [pathname, router, isAuthPage]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f9fafb]">
        <Loader2 className="animate-spin text-[#0097a7]" size={40} strokeWidth={1.5} />
      </div>
    );
  }

  if (isAuthPage) {
    return <div className="w-full min-h-screen bg-[#f9fafb]">{children}</div>;
  }

  return (
    <div className="flex h-screen bg-[#f9fafb] overflow-hidden selection:bg-[#ffab40] selection:text-[#0a003d]">
      <Sidebar />
      <main className="flex-1 p-8 lg:p-12 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
