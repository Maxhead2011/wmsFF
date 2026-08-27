import { Truck, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AuthSession, AuthUser } from '../../lib/api';
import { WorkspaceTileGate } from '../common/WorkspaceTileGate';
import { LogisticsImportForm } from './LogisticsImportForm';
import { StockImportForm } from './StockImportForm';

type ImportPanelProps = {
  session: AuthSession;
};

const importTabs = [
  { id: 'stock', label: 'Остатки', permission: 'imports:write', icon: Upload },
  { id: 'logistics', label: 'Тарифы логистики', permission: 'logistics:write', icon: Truck },
] as const;

type ImportTab = (typeof importTabs)[number]['id'];

export function ImportPanel({ session }: ImportPanelProps) {
  const [activeTab, setActiveTab] = useState<ImportTab>('stock');
  const availableTabs = useMemo(
    () => importTabs.filter((tab) => canUse(session.user, tab.permission)),
    [session.user],
  );
  const activeTabMeta = availableTabs.find((tab) => tab.id === activeTab);

  useEffect(() => {
    if (availableTabs.length > 0 && !activeTabMeta) {
      setActiveTab(availableTabs[0].id);
    }
  }, [activeTabMeta, availableTabs]);

  if (availableTabs.length === 0) {
    return null;
  }

  return (
    <WorkspaceTileGate
      eyebrow="Управление данными"
      title="Импорт"
      description="Выберите, какие данные загрузить. Формат и проверка файла откроются только после выбора операции."
      tiles={availableTabs.map((tab) => ({ title: tab.label, description: tab.id === 'stock' ? 'Загрузка остатков из XLSX с проверкой строк.' : 'Загрузка и обновление тарифов доставки.', icon: tab.icon, tone: tab.id === 'stock' ? 'green' : 'orange' }))}
    >
    <section className="import-panel" aria-label="Импорт XLSX">
      <div className="section-heading import-panel__heading">
        <div>
          <p className="eyebrow">Импорт XLSX</p>
          <h2>Загрузка данных</h2>
        </div>
      </div>

      <div className="import-tabs" role="tablist" aria-label="Тип импорта">
        {availableTabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            <tab.icon size={16} aria-hidden="true" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'stock' ? <StockImportForm session={session} /> : null}
      {activeTab === 'logistics' ? <LogisticsImportForm session={session} /> : null}
    </section>
    </WorkspaceTileGate>
  );
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
