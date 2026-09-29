'use client';
import { useEffect } from 'react';
import { pushSupported, registerPushServiceWorker } from '@/lib/push-client';

export function PwaServiceWorkerRegistrar() {
  useEffect(() => {
    if (!pushSupported()) return;
    void registerPushServiceWorker().catch(() => {
      // A tela de configuracoes mostra o erro de forma acionavel se o usuario tentar ativar o push.
    });
  }, []);
  return null;
}
