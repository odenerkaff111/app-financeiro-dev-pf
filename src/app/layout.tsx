import type {
  Metadata,
  Viewport,
} from "next";
import {
  Cormorant_Garamond,
  Montserrat,
} from "next/font/google";
import "./globals.css";
import {
  AppLayout,
} from "@/components/AppLayout";
import { PwaServiceWorkerRegistrar } from "@/components/pwa/PwaServiceWorkerRegistrar";

const montserrat =
  Montserrat({
    subsets: [
      "latin",
    ],
    variable:
      "--font-montserrat",
    display:
      "swap",
    weight: [
      "400",
      "500",
      "600",
      "700",
    ],
  });

const cormorantGaramond =
  Cormorant_Garamond({
    subsets: [
      "latin",
    ],
    variable:
      "--font-cormorant",
    display:
      "swap",
    weight: [
      "500",
      "600",
      "700",
    ],
  });

export const metadata:
  Metadata = {
    title: {
      default:
        "Minhas Finanças",
      template:
        "%s | Minhas Finanças",
    },

    description:
      "Gestão financeira e patrimonial da família.",

    manifest:
      "/manifest.webmanifest",

    appleWebApp: {
      capable: true,
      title: "Minhas Finanças",
      statusBarStyle: "default",
    },

    icons: {
      icon:
        "/brand/grupo-umso-icon.png",

      shortcut:
        "/brand/grupo-umso-icon.png",

      apple:
        "/icons/apple-touch-icon.png",
    },
  };


export const viewport:
  Viewport = {
    themeColor:
      "#0D1B2A",
  };

export default function RootLayout({
  children,
}: Readonly<{
  children:
    React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      data-scroll-behavior="smooth"
    >
      <body
        className={`${montserrat.variable} ${cormorantGaramond.variable}`}
      >
        <PwaServiceWorkerRegistrar />
        <AppLayout>
          {children}
        </AppLayout>
      </body>
    </html>
  );
}
