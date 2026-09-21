import { ArrowLeft } from 'lucide-react';
import { StockManagementMenu } from './StockManagementMenu';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchDuplicateGroupCapabilities, fetchMarketplaceAllocationCapabilities, fetchMarketplaceAllocation, fetchMarketplaceConnections, type AuthSession } from '../../lib/api';
import { FbsStockAllocationView } from './FbsStockAllocationView';
import { MarketplaceAllocationView } from './MarketplaceAllocationView';
import { DuplicateStockGroupsView } from './DuplicateStockGroupsView';

// FIX: only the selected panel mounts; entering stock management does not fetch stock tables.
export function StockManagementView({ session, clientId, connectionId, renderStocks }: {
  session: AuthSession; clientId: string; connectionId: string; renderStocks: () => ReactNode;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [section, setSection] = useState('');
  const [cabinetMessage, setCabinetMessage] = useState('Проверка подключённых кабинетов…');
  const [wbConnectionId, setWbConnectionId] = useState(connectionId);
  const [reload, setReload] = useState(0);
  const [duplicatesEnabled, setDuplicatesEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    setSection(''); setEnabled(null); setError(''); setDuplicatesEnabled(false);
    void fetchMarketplaceAllocationCapabilities(session.accessToken).then(async r => {
      if (!active) return;
      if (r.enabled) {
        const [settings, duplicateCapabilities] = await Promise.all([
          fetchMarketplaceAllocation(session.accessToken, clientId),
          fetchDuplicateGroupCapabilities(session.accessToken).catch(() => ({ enabled: false })),
        ]);
        if (!active) return;
        setDuplicatesEnabled(duplicateCapabilities.enabled);
        setCabinetMessage(settings.message || 'Подключены Wildberries и Ozon');
        setWbConnectionId(settings.connections.find(c => c.marketplace === 'WILDBERRIES')?.id ?? '');
      } else {
        const connections = await fetchMarketplaceConnections(session.accessToken, { clientId });
        if (!active) return;
        setWbConnectionId(connections.find(c => c.isActive && c.marketplace === 'WILDBERRIES')?.id ?? '');
      }
      setEnabled(r.enabled);
    })
      .catch(() => { if (active) setError('Не удалось проверить доступность управления остатками. Откройте раздел повторно.'); });
    return () => { active = false; };
  }, [clientId, session.accessToken, reload]);
  if (error) return <p role="alert">{error} <button onClick={() => setReload(v => v + 1)}>Повторить</button></p>;
  if (enabled === null) return <p>Загрузка раздела…</p>;
  if (!enabled) return <FbsStockAllocationView session={session} clientId={clientId} connectionId={wbConnectionId} />;
  return <section>
    <h3>Управление остатками</h3>
    {section ? <button type="button" className="icon-text-button stock-management-back" onClick={() => setSection('')}><ArrowLeft size={18} aria-hidden="true" /> Все разделы</button>
      : <StockManagementMenu cabinetMessage={cabinetMessage} duplicatesEnabled={duplicatesEnabled} onSelect={setSection} />}
    {section === 'marketplaces' && <MarketplaceAllocationView key={clientId} session={session} clientId={clientId} />}
    {section === 'duplicates' && duplicatesEnabled && <DuplicateStockGroupsView key={clientId} session={session} clientId={clientId} />}
    {section === 'stocks' && renderStocks()}
    {section === 'warehouses' && <FbsStockAllocationView key={clientId} session={session} clientId={clientId} connectionId={wbConnectionId} />}
  </section>;
}
