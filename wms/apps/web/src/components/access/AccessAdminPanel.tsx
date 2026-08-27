import { ArrowLeft, ChevronRight, KeyRound, Printer, ShieldCheck, Smartphone, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { AuthSession, AuthUser } from '../../lib/api';
import './access.css';
import { TsdDeviceAdminPanel } from './TsdDeviceAdminPanel';
import { UserCreateForm } from './UserCreateForm';
import { UserRoleEditor } from './UserRoleEditor';
import { UserPrinterScopeEditor } from './UserPrinterScopeEditor';
import { UserScopeEditor } from './UserScopeEditor';

type AccessAdminPanelProps = {
  session: AuthSession;
};

type AccessTab = 'create' | 'roles' | 'scopes' | 'printers' | 'tsd';

const accessTopics = [
  { id: 'create', label: 'Создать сотрудника', text: 'Новый пользователь, роль и стартовые доступы.', icon: UserPlus },
  { id: 'roles', label: 'Роли', text: 'Настройте наборы прав для должностей.', icon: KeyRound },
  { id: 'scopes', label: 'Доступы', text: 'Ограничьте клиентов, филиалы и разделы для сотрудника.', icon: ShieldCheck },
  { id: 'tsd', label: 'ТСД', text: 'Устройства, сотрудники и работа мобильного приложения.', icon: Smartphone },
  { id: 'printers', label: 'Принтеры', text: 'Кому доступна печать и на какие устройства.', icon: Printer },
] as const;

export function AccessAdminPanel({ session }: AccessAdminPanelProps) {
  const [activeTab, setActiveTab] = useState<AccessTab | null>(null);

  if (!canUse(session.user, 'users:write')) {
    return null;
  }

  return (
    <section className="access-panel" aria-label="Пользователи и доступы">
      <div className="section-heading access-panel__heading">
        <div>
          <p className="eyebrow">RBAC</p>
          <h2>Пользователи и доступы</h2>
        </div>
      </div>

      {!activeTab ? <div className="access-topic-grid" aria-label="Темы доступа">
        {accessTopics.map((topic) => <button className={`access-topic-tile access-topic-tile--${topic.id}`} key={topic.id} type="button" onClick={() => setActiveTab(topic.id)}><span className="access-topic-tile__icon"><topic.icon size={22} /></span><span className="access-topic-tile__content"><small>Доступы</small><strong>{topic.label}</strong><span>{topic.text}</span></span><ChevronRight size={22} /></button>)}
      </div> : null}

      {activeTab ? <div className="access-tabs" role="tablist" aria-label="Раздел доступа">
        <button className="access-tabs__back" type="button" onClick={() => setActiveTab(null)}><ArrowLeft size={16} /><span>Разделы</span></button>
        <button
          aria-selected={activeTab === 'create'}
          className={activeTab === 'create' ? 'active' : ''}
          onClick={() => setActiveTab('create')}
          role="tab"
          type="button"
        >
          <UserPlus size={16} aria-hidden="true" />
          <span>Создать</span>
        </button>
        <button
          aria-selected={activeTab === 'roles'}
          className={activeTab === 'roles' ? 'active' : ''}
          onClick={() => setActiveTab('roles')}
          role="tab"
          type="button"
        >
          <KeyRound size={16} aria-hidden="true" />
          <span>Роли</span>
        </button>
        <button
          aria-selected={activeTab === 'scopes'}
          className={activeTab === 'scopes' ? 'active' : ''}
          onClick={() => setActiveTab('scopes')}
          role="tab"
          type="button"
        >
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Доступы</span>
        </button>
        <button
          aria-selected={activeTab === 'tsd'}
          className={activeTab === 'tsd' ? 'active' : ''}
          onClick={() => setActiveTab('tsd')}
          role="tab"
          type="button"
        >
          <Smartphone size={16} aria-hidden="true" />
          <span>ТСД</span>
        </button>
        <button
          aria-selected={activeTab === 'printers'}
          className={activeTab === 'printers' ? 'active' : ''}
          onClick={() => setActiveTab('printers')}
          role="tab"
          type="button"
        >
          <Printer size={16} aria-hidden="true" />
          <span>Принтеры</span>
        </button>
      </div> : null}

      {activeTab === 'create' ? <UserCreateForm session={session} /> : null}
      {activeTab === 'roles' ? <UserRoleEditor session={session} /> : null}
      {activeTab === 'scopes' ? <UserScopeEditor session={session} /> : null}
      {activeTab === 'printers' ? <UserPrinterScopeEditor session={session} /> : null}
      {activeTab === 'tsd' ? <TsdDeviceAdminPanel session={session} /> : null}
    </section>
  );
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
