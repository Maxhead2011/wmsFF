import { useState } from 'react';
import type { AuthSession } from '../../lib/api';
import { FbsStockAllocationView } from './FbsStockAllocationView';

// FIX: load rules on demand, retain drafts while collapsed, and bind them to the stock cabinet.
export function FbsStockAllocationSection({ session, clientId, connectionId, disabled = false }: {
  session: AuthSession; clientId: string; connectionId: string; disabled?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <fieldset className="fbs-stock-management" disabled={disabled} aria-busy={disabled}>
      <details onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
        <summary>Настройки автоматического распределения остатков</summary>
        <p className="fbs-stock-management__hint">Проценты по складам, основной склад, рекомендации и доступ внешней системы учёта. Настройки для выбранного выше кабинета WB.</p>
        {opened ? <FbsStockAllocationView key={`${clientId}:${connectionId}`} session={session} clientId={clientId} connectionId={connectionId} /> : null}
      </details>
    </fieldset>
  );
}
