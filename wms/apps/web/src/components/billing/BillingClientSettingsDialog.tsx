import { Building2, Factory, PackageCheck, ShoppingCart, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { updateClient, type AuthSession, type ClientSummary } from '../../lib/api';
import { FbsPricingSettings } from '../fbs/FbsPanel';
import { ClientBillingServicesPanel } from './ClientBillingServicesPanel';

type BillingClientSettingsDialogProps = {
  client: ClientSummary;
  session: AuthSession;
  onClose: () => void;
};

type SettingsTab = 'fbo' | 'fbs' | 'factory';

export function BillingClientSettingsDialog({
  client,
  session,
  onClose,
}: BillingClientSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('fbo');
  const [factoryEnabled, setFactoryEnabled] = useState(Boolean(client.factoryEnabled));
  const [factoryName, setFactoryName] = useState(client.factoryName || 'Бишкек');
  const [factoryCode, setFactoryCode] = useState(client.factoryCode || '');
  const [factoryMessage, setFactoryMessage] = useState('');

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="billing-client-settings-dialog" role="presentation">
      <section
        className="billing-client-settings-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-client-settings-title"
      >
        <header className="billing-client-settings-dialog__header">
          <div className="billing-client-settings-dialog__identity">
            <span><Building2 size={20} aria-hidden="true" /></span>
            <div>
              <small>Карточка настроек биллинга</small>
              <h2 id="billing-client-settings-title">{client.name}</h2>
              <p>{client.code} · индивидуальные услуги и правила расчёта</p>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки клиента"
            title="Закрыть"
          >
            <X size={19} aria-hidden="true" />
          </button>
          <button className={activeTab === 'factory' ? 'is-active' : undefined} type="button" onClick={() => setActiveTab('factory')}>
            <Factory size={17} aria-hidden="true" />
            <span><strong>Фабрика</strong><small>Отдельный доступ клиента к предварительным отправкам</small></span>
          </button>
        </header>

        <nav className="billing-client-settings-dialog__tabs" aria-label="Разделы настроек клиента">
          <button
            className={activeTab === 'fbo' ? 'is-active' : undefined}
            type="button"
            onClick={() => setActiveTab('fbo')}
          >
            <PackageCheck size={17} aria-hidden="true" />
            <span>
              <strong>Услуги FBO</strong>
              <small>Приёмка, обработка, хранение и дополнительные услуги</small>
            </span>
          </button>
          <button
            className={activeTab === 'fbs' ? 'is-active' : undefined}
            type="button"
            onClick={() => setActiveTab('fbs')}
          >
            <ShoppingCart size={17} aria-hidden="true" />
            <span>
              <strong>Услуги FBS</strong>
              <small>Обработка заказов, логистика, короба и паллеты</small>
            </span>
          </button>
        </nav>

        <div className="billing-client-settings-dialog__body">
          <div hidden={activeTab !== 'fbo'}>
            <ClientBillingServicesPanel
              clients={[client]}
              session={session}
              fixedClientId={client.id}
              section="fbo"
              embedded
            />
          </div>

          <div className="billing-client-settings-dialog__fbs" hidden={activeTab !== 'fbs'}>
            <ClientBillingServicesPanel
              clients={[client]}
              session={session}
              fixedClientId={client.id}
              section="fbs"
              embedded
            />
            <section className="billing-client-settings-dialog__fbs-operational">
              <header>
                <span>Автоматическое начисление FBS</span>
                <h3>Услуги заказа, доставки и упаковки</h3>
                <p>
                  Здесь задаются базовая обработка FBS, дополнительные услуги,
                  маршруты доставки, короба и паллеты.
                </p>
              </header>
              <FbsPricingSettings clientId={client.id} session={session} onSaved={() => undefined} />
            </section>
          </div>
          <div hidden={activeTab !== 'factory'} className="billing-client-settings-dialog__fbs-operational">
            <section>
              <header><span>Отправка с производства</span><h3>Своя фабрика клиента</h3><p>Отправки из этого контура видны только пользователям с доступом к данному клиенту. В складские остатки они не попадают.</p></header>
              <label className="checkbox-row"><input type="checkbox" checked={factoryEnabled} onChange={(e) => setFactoryEnabled(e.target.checked)}/><span>Разрешить отправки с фабрики</span></label>
              <label>Название фабрики<input value={factoryName} onChange={(e) => setFactoryName(e.target.value)} placeholder="Например, Бишкек" /></label>
              <label>Код точки подключения<input value={factoryCode} onChange={(e) => setFactoryCode(e.target.value)} placeholder="Например, LUKIN-BISHKEK" /></label>
              <button className="primary-button" type="button" onClick={async () => { try { await updateClient(session.accessToken, client.id, { factoryEnabled, factoryName, factoryCode }); setFactoryMessage('Настройки фабрики сохранены.'); } catch (error) { setFactoryMessage(error instanceof Error ? error.message : 'Не удалось сохранить настройки.'); } }}>Сохранить фабрику</button>
              {factoryMessage && <p>{factoryMessage}</p>}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
