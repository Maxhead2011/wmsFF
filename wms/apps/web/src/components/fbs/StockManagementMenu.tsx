import { ArrowLeftRight, Copy, PackageCheck, ShieldCheck, Warehouse } from 'lucide-react';
import './StockManagementMenu.css';

// FIX: reuse FBS theme tiles; unavailable sections remain native disabled buttons.
export function StockManagementMenu({ cabinetMessage, duplicatesEnabled, onSelect }: {
  cabinetMessage: string; duplicatesEnabled: boolean; onSelect: (section: string) => void;
}) {
  const items = [
    { id: 'marketplaces', title: 'Между маркетплейсами', description: cabinetMessage, icon: ArrowLeftRight, accent: 'blue' },
    { id: 'stocks', title: 'Резервы и предпросмотр', description: 'Текущие настройки остатков WB', icon: ShieldCheck, accent: 'green' },
    { id: 'duplicates', title: 'Между артикулами', description: duplicatesEnabled ? 'Доли, размеры и страховой резерв' : 'Раздел ещё не включён', icon: Copy, accent: 'violet', disabled: !duplicatesEnabled },
    { id: 'warehouses', title: 'Между складами', description: 'Действующее распределение WB', icon: Warehouse, accent: 'amber' },
    { id: 'confirmation', title: 'Подтверждение остатков WB', description: 'Отдельная статистика — следующий этап', icon: PackageCheck, accent: 'slate', disabled: true },
  ];
  return <nav className="stock-management-menu" aria-label="Разделы управления остатками">
    {items.map(({ id, title, description, icon: Icon, accent, disabled }) => <div key={id} className={`fbs-tile fbs-tile--${accent}${disabled ? ' stock-management-menu__disabled' : ''}`}>
      <button type="button" className="fbs-tile__open" disabled={disabled} onClick={() => onSelect(id)}>
        <span className="fbs-tile__icon"><Icon size={22} aria-hidden="true" /></span>
        <span className="fbs-tile__content"><strong>{title}</strong><small>{description}</small>
          {disabled && <span className="stock-management-menu__badge">Скоро</span>}
        </span>
      </button>
    </div>)}
  </nav>;
}
