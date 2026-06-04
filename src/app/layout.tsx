import type { Metadata } from "next";
import "./globals.css";
import { AppLayout } from "@/components/AppLayout";

export const metadata: Metadata = {
  title: "Kaff ERP | Gestão Inteligente",
  description: "Controle financeiro e CRM completo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        {/* Todo o controle de Sidebar agora é feito pelo AppLayout */}
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
