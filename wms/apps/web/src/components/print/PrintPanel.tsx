import { ArrowLeft, Boxes, ChevronRight, FileText, Layers3, ListChecks, Network, Package, Printer } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { AuthSession, AuthUser } from '../../lib/api';
import { BoxLabelForm } from './BoxLabelForm';
import { LabelTemplatePanel } from './LabelTemplatePanel';
import { PalletLabelForm } from './PalletLabelForm';
import './print.css';
import { PrintJobPanel } from './PrintJobPanel';
import { PrintPrinterPanel } from './PrintPrinterPanel';
import { SkuLabelForm } from './SkuLabelForm';
import { StickerSetPanel } from './StickerSetPanel';

type PrintPanelProps = {
  session: AuthSession;
};

type PrintTab = 'box' | 'sku' | 'pallet' | 'sets' | 'templates' | 'printers' | 'jobs';

const printTabs: Array<{ id: PrintTab; label: string; icon: LucideIcon }> = [
  { id: 'box', label: 'Короб', icon: Boxes },
  { id: 'sku', label: 'SKU', icon: Package },
  { id: 'pallet', label: 'Паллета', icon: Layers3 },
  { id: 'sets', label: 'Наборы', icon: Package },
  { id: 'templates', label: 'Шаблоны', icon: FileText },
  { id: 'printers', label: 'Принтеры', icon: Network },
  { id: 'jobs', label: 'Задания', icon: ListChecks },
];

export function PrintPanel({ session }: PrintPanelProps) {
  const [activeTab, setActiveTab] = useState<PrintTab | null>(null);

  if (!canUse(session.user, 'print:write')) {
    return null;
  }

  return (
    <section className="print-panel" aria-label="Печать этикеток">
      <div className="section-heading print-panel__heading">
        <div>
          <p className="eyebrow">Печать</p>
          <h2>Печать этикеток</h2>
        </div>
        <Printer size={20} aria-hidden="true" />
      </div>

      {!activeTab ? <div className="print-topic-grid" aria-label="Разделы печати">
        {printTabs.map((tab) => { const Icon = tab.icon; return <button className={`print-topic-tile print-topic-tile--${tab.id}`} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}><span className="print-topic-tile__icon"><Icon size={22} /></span><span className="print-topic-tile__content"><small>Печать</small><strong>{tab.label}</strong><span>{printTopicDescription(tab.id)}</span></span><ChevronRight size={22} /></button>; })}
      </div> : null}

      {activeTab ? <div className="print-tabs" role="tablist" aria-label="Тип этикетки">
        <button className="print-tabs__back" type="button" onClick={() => setActiveTab(null)}><ArrowLeft size={16} /><span>Разделы</span></button>
        {printTabs.map((tab) => {
          const Icon = tab.icon;

          return (
            <button
              className={activeTab === tab.id ? 'active' : ''}
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div> : null}

      {activeTab === 'box' ? <BoxLabelForm session={session} /> : null}
      {activeTab === 'sku' ? <SkuLabelForm session={session} /> : null}
      {activeTab === 'pallet' ? <PalletLabelForm session={session} /> : null}
      {activeTab === 'sets' ? <StickerSetPanel session={session} /> : null}
      {activeTab === 'templates' ? <LabelTemplatePanel session={session} /> : null}
      {activeTab === 'printers' ? <PrintPrinterPanel session={session} /> : null}
      {activeTab === 'jobs' ? <PrintJobPanel session={session} /> : null}
    </section>
  );
}

function printTopicDescription(tab: PrintTab) {
  if (tab === 'box') return 'Создание и печать этикетки для складского короба.';
  if (tab === 'sku') return 'Этикетки товара с названием, артикулом и штрихкодом.';
  if (tab === 'pallet') return 'Маркировка паллет и паллет-сортов.';
  if (tab === 'sets') return 'Серийные ШК и QR для коробов с префиксом и счётчиком.';
  if (tab === 'templates') return 'Настройка макетов этикеток для вашей ВМС.';
  if (tab === 'printers') return 'Подключённые принтеры и их параметры.';
  return 'Очередь заданий, статус и история печати.';
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
