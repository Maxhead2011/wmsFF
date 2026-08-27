import { ArrowLeft, ChevronRight, GitCompareArrows, PackagePlus, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AuthSession, AuthUser } from '../../lib/api';
import { ArticleMappingPanel } from './ArticleMappingPanel';
import { ClientCreateForm } from './ClientCreateForm';
import { ClientImportForm } from './ClientImportForm';
import { ClientRequisitesForm } from './ClientRequisitesForm';
import './directories.css';
import { SkuCreateForm } from './SkuCreateForm';
import { SkuDirectoryTable } from './SkuDirectoryTable';
import { SkuImportForm } from './SkuImportForm';

type DirectoryPanelProps = {
  session: AuthSession;
};

const directoryTabs = [
  { id: 'clients', label: 'Клиент', permission: 'clients:write', icon: UserPlus },
  { id: 'skus', label: 'Номенклатура', permission: 'skus:write', icon: PackagePlus },
  { id: 'article-mappings', label: 'Соответствия', permission: 'skus:write', icon: GitCompareArrows },
] as const;

type DirectoryTab = (typeof directoryTabs)[number]['id'];

export function DirectoryPanel({ session }: DirectoryPanelProps) {
  const [activeTab, setActiveTab] = useState<DirectoryTab | null>(null);
  const [skuReloadKey, setSkuReloadKey] = useState(0);
  const availableTabs = useMemo(
    () => directoryTabs.filter((tab) => canUse(session.user, tab.permission)),
    [session.user],
  );

  if (availableTabs.length === 0) {
    return null;
  }

  return (
    <section className="directory-panel" aria-label="Справочники">
      <div className="section-heading directory-panel__heading">
        <div>
          <p className="eyebrow">Справочники</p>
          <h2>Справочники</h2>
        </div>
      </div>

      {!activeTab ? <div className="directory-topic-grid" aria-label="Темы справочников">
        {availableTabs.map((tab) => (
          <button
            className={`directory-topic-tile directory-topic-tile--${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            <span className="directory-topic-tile__icon"><tab.icon size={22} aria-hidden="true" /></span>
            <span className="directory-topic-tile__content"><small>Справочник</small><strong>{tab.label}</strong><span>{directoryTopicDescription(tab.id)}</span></span>
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        ))}
      </div> : null}

      {activeTab ? <div className="directory-tabs" role="tablist" aria-label="Тип справочника">
        <button className="directory-tabs__back" type="button" onClick={() => setActiveTab(null)}><ArrowLeft size={16} /><span>Разделы</span></button>
        {availableTabs.map((tab) => (
          <button aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'active' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)} role="tab" type="button"><tab.icon size={16} aria-hidden="true" /><span>{tab.label}</span></button>
        ))}
      </div> : null}

      {activeTab === 'clients' ? (
        <div className="directory-stack">
          <ClientImportForm session={session} />
          <ClientCreateForm session={session} />
          <ClientRequisitesForm session={session} />
        </div>
      ) : null}
      {activeTab === 'skus' ? (
        <div className="directory-stack">
          <SkuImportForm session={session} onImported={() => setSkuReloadKey((current) => current + 1)} />
          <SkuCreateForm session={session} onCreated={() => setSkuReloadKey((current) => current + 1)} />
          <SkuDirectoryTable session={session} reloadKey={skuReloadKey} />
        </div>
      ) : null}
      {activeTab === 'article-mappings' ? <ArticleMappingPanel session={session} /> : null}
    </section>
  );
}

function directoryTopicDescription(tab: DirectoryTab) {
  if (tab === 'clients') return 'Карточки клиентов, реквизиты и загрузка данных из файлов.';
  if (tab === 'skus') return 'Товары, штрихкоды, размеры, карточки и импорт номенклатуры.';
  return 'Связи старых и новых артикулов для корректной переклейки и остатков.';
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
