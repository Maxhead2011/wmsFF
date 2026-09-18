import { Boxes, RadioTower } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AuthSession } from '../../lib/api';
import { FbsStockMonitoringPanel } from './FbsStockMonitoringPanel';
import { TsdMonitoringPanel } from './TsdMonitoringPanel';
import './stock-monitoring.css';
import { WbSyncHealthPanel } from './WbSyncHealthPanel';
import './wb-sync-health.css';

type Props = { session: AuthSession };
type MonitorSurface = 'tsd' | 'stock' | 'wb-sync';

export function MonitoringPanel({ session }: Props) {
  const canSeeTsd = session.user.permissionCodes.includes('system:admin')
    || session.user.permissionCodes.includes('administration:demo');
  // FIX: клиент сразу попадает в безопасный монитор остатков и не получает
  // даже переключателя внутренней диспетчерской ТСД.
  const canSeeSync = session.user.permissionCodes.includes('system:admin') || session.user.roleCodes.some(role => ['ADMIN', 'OWNER'].includes(role));
  const [surface, setSurface] = useState<MonitorSurface>(() => canSeeSync && sessionStorage.getItem('monitoring-surface') === 'wb-sync' ? 'wb-sync' : canSeeTsd ? 'tsd' : 'stock');
  useEffect(() => {
    const open = () => { if (canSeeSync) setSurface('wb-sync'); };
    window.addEventListener('wb-sync-health-open', open);
    return () => window.removeEventListener('wb-sync-health-open', open);
  }, [canSeeSync]);

  return (
    <div className="monitoring-hub">
      <nav className="monitoring-hub__switcher" aria-label="Сервисы мониторинга">
        {canSeeSync ? <button type="button" className={surface === 'wb-sync' ? 'is-active' : ''} aria-pressed={surface === 'wb-sync'} onClick={() => setSurface('wb-sync')}>
          <RadioTower size={20} aria-hidden="true" /><span><strong>Синхронизация WB</strong><small>Циклы, подтверждения WB и ошибки биллинга</small></span>
        </button> : null}
        {canSeeTsd ? (
          <button
            type="button"
            className={surface === 'tsd' ? 'is-active' : ''}
            aria-pressed={surface === 'tsd'}
            onClick={() => setSurface('tsd')}
          >
            <RadioTower size={20} aria-hidden="true" />
            <span><strong>Мониторинг ТСД</strong><small>Устройства, сборщики и ошибки сканирования</small></span>
          </button>
        ) : null}
        <button
          type="button"
          className={surface === 'stock' ? 'is-active' : ''}
          aria-pressed={surface === 'stock'}
          onClick={() => setSurface('stock')}
        >
          <Boxes size={20} aria-hidden="true" />
          <span><strong>Мониторинг остатков ВБ и WMS</strong><small>Продажи, резервы и подтверждение списаний</small></span>
        </button>
      </nav>

      {surface === 'wb-sync' ? <WbSyncHealthPanel session={session} /> : surface === 'stock'
        ? <FbsStockMonitoringPanel session={session} />
        : <TsdMonitoringPanel session={session} />}
    </div>
  );
}
