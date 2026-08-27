import { Boxes, RadioTower } from 'lucide-react';
import { useState } from 'react';
import type { AuthSession } from '../../lib/api';
import { FbsStockMonitoringPanel } from './FbsStockMonitoringPanel';
import { TsdMonitoringPanel } from './TsdMonitoringPanel';
import './stock-monitoring.css';

type Props = { session: AuthSession };
type MonitorSurface = 'tsd' | 'stock';

export function MonitoringPanel({ session }: Props) {
  const canSeeTsd = session.user.permissionCodes.includes('system:admin')
    || session.user.permissionCodes.includes('administration:demo');
  // FIX: клиент сразу попадает в безопасный монитор остатков и не получает
  // даже переключателя внутренней диспетчерской ТСД.
  const [surface, setSurface] = useState<MonitorSurface>(() => canSeeTsd ? 'tsd' : 'stock');

  return (
    <div className="monitoring-hub">
      <nav className="monitoring-hub__switcher" aria-label="Сервисы мониторинга">
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

      {surface === 'stock'
        ? <FbsStockMonitoringPanel session={session} />
        : <TsdMonitoringPanel session={session} />}
    </div>
  );
}
