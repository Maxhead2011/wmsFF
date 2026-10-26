import { useEffect, useState, type ReactNode } from 'react';
import type { AuthSession } from '../../lib/api';
import { MultishopStockGroupsView } from './MultishopStockGroupsView';

// FIX: retain the prior pair editor; sold deployments keep their existing interface.
export function MultishopStockGroupsEntry({ session, clientId, fallback = null }: { session: AuthSession; clientId: string; fallback?: ReactNode }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setEnabled(null);
    fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/marketplace-connections/multishop/capabilities`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }, signal: controller.signal,
    }).then(async response => response.ok ? response.json() : { enabled: false })
      .then(value => { if (!controller.signal.aborted) setEnabled(value.enabled === true); })
      .catch(() => { if (!controller.signal.aborted) setEnabled(false); });
    return () => controller.abort();
  }, [session.accessToken]);
  if (enabled === null) return <p role="status">Загрузка настроек магазинов…</p>;
  if (!enabled) return <>{fallback}</>;
  return <><MultishopStockGroupsView session={session} clientId={clientId} />{fallback && <details><summary>Прежняя настройка одной пары WB/Ozon</summary>{fallback}</details>}</>;
}
