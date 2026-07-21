import type { Metadata } from "next";
import {
  Cormorant_Garamond,
  Montserrat,
} from "next/font/google";
import "./globals.css";
import { AppLayout } from "@/components/AppLayout";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Minhas Finanças",
    template: "%s | Minhas Finanças",
  },
  description:
    "Gestão financeira e patrimonial da família.",
  icons: {
    icon: "/brand/grupo-umso-icon.png",
    shortcut: "/brand/grupo-umso-icon.png",
    apple: "/brand/grupo-umso-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${montserrat.variable} ${cormorantGaramond.variable}`}
      >
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}