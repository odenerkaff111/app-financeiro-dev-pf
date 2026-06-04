import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Aqui liberamos o seu domínio oficial para o Next.js não bloquear a tela
  allowedDevOrigins: ['financeiro-pj.grupokaff.fun', 'localhost'],
};

export default nextConfig;
