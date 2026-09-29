import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Minhas Financas',
    short_name: 'Financas',
    description: 'Gestao financeira e patrimonial da familia.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F7F5EF',
    theme_color: '#0D1B2A',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
