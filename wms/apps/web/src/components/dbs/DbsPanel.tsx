import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  KeyRound,
  PackageCheck,
  PlugZap,
  Save,
  ShoppingBag,
  Store,
  Truck,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  checkDbsIntegration,
  createDbsIntegration,
  fetchClients,
  fetchDbsIntegrations,
  updateDbsIntegration,
  type AuthSession,
  type ClientSummary,
  type DbsIntegrationSummary,
  type UpsertDbsIntegrationPayload,
} from '../../lib/api';
import './dbs.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';

type DbsMarketplace = 'WB' | 'OZON' | 'YM';
type DbsMarketplaceApi = UpsertDbsIntegrationPayload['marketplace'];
type DbsForm = Omit<UpsertDbsIntegrationPayload, 'marketplace'> & { id: string; deliveryApiSecret: string };

const dbsMarketplaces: Array<{
  id: DbsMarketplace;
  apiValue: DbsMarketplaceApi;
  eyebrow: string;
  title: string;
  description: string;
  brand: string;
  accent: 'wb' | 'ozon' | 'ym';
}> = [
  {
    id: 'WB',
    apiValue: 'WILDBERRIES',
    eyebrow: 'Wildberries',
    title: 'DBS WB',
    description: 'Заказы DBS Wildberries, самостоятельная доставка, статусы и подтверждение вручения.',
    brand: 'WB',
    accent: 'wb',
  },
  {
    id: 'OZON',
    apiValue: 'OZON',
    eyebrow: 'Ozon Seller',
    title: 'DBS OZON',
    description: 'Отдельная очередь DBS Ozon, сборка, доставка продавцом и контроль статусов.',
    brand: 'OZON',
    accent: 'ozon',
  },
  {
    id: 'YM',
    apiValue: 'YANDEX_MARKET',
    eyebrow: 'Яндекс Маркет',
    title: 'DBS YM',
    description: 'Заказы DBS Яндекс Маркета, подготовка, передача курьеру и завершение доставки.',
    brand: 'Я',
    accent: 'ym',
  },
];

const deliveryProviders = [
  { value: 'CDEK', label: 'СДЭК' },
  { value: 'YANDEX_DELIVERY', label: 'Яндекс Доставка' },
  { value: 'DOSTAVISTA', label: 'Dostavista' },
  { value: 'BOXBERRY', label: 'Boxberry' },
  { value: 'OTHER', label: 'Другая служба' },
];

const emptyForm: DbsForm = {
  id: '',
  clientId: '',
  senderName: '',
  contactName: '',
  phone: '',
  email: '',
  city: '',
  address: '',
  postalCode: '',
  deliveryProvider: 'CDEK',
  deliveryServiceName: '',
  deliveryApiUrl: '',
  deliveryAccountId: '',
  deliveryApiKey: '',
  deliveryApiSecret: '',
  isActive: true,
};

export function DbsPanel({ session }: { session: AuthSession }) {
  const [marketplace, setMarketplace] = useState<DbsMarketplace | null>(null);
  const selected = dbsMarketplaces.find((item) => item.id === marketplace);

  if (selected) {
    return (
      <DbsMarketplaceWorkspace
        session={session}
        marketplace={selected}
        onBack={() => setMarketplace(null)}
      />
    );
  }

  return (
    <section className="dbs-panel dbs-panel--entry" aria-label="Выбор DBS-маркетплейса">
      <header className="dbs-panel__hero">
        <div className="dbs-panel__hero-icon"><Store size={24} aria-hidden="true" /></div>
        <div>
          <p className="eyebrow">DBS</p>
          <h2>Выберите маркетплейс</h2>
          <p>Заказы с доставкой силами продавца разделены по маркетплейсам и не смешиваются с FBS.</p>
        </div>
        <span className="dbs-panel__scope">3 рабочих контура</span>
      </header>

      <div className="dbs-marketplace-grid">
        {dbsMarketplaces.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`dbs-marketplace-card dbs-marketplace-card--${item.accent}`}
            onClick={() => setMarketplace(item.id)}
          >
            <span className="dbs-marketplace-card__index">{index + 1}</span>
            <span className="dbs-marketplace-card__brand">{item.brand}</span>
            <span className="dbs-marketplace-card__content">
              <small>{item.eyebrow}</small>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </span>
            <ChevronRight size={26} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function DbsMarketplaceWorkspace({
  session,
  marketplace,
  onBack,
}: {
  session: AuthSession;
  marketplace: (typeof dbsMarketplaces)[number];
  onBack: () => void;
}) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [integrations, setIntegrations] = useState<DbsIntegrationSummary[]>([]);
  const [form, setForm] = useState<DbsForm>(emptyForm);
  const [rememberedClientId, setRememberedClientId] = useRememberedClientId(session.user.id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const canWrite = session.user.permissionCodes.includes('clients:write');
  const selectedClient = useMemo(
    () => clients.find((client) => client.id === form.clientId) ?? null,
    [clients, form.clientId],
  );
  const currentIntegration = useMemo(
    () => integrations.find((item) => item.clientId === form.clientId) ?? null,
    [integrations, form.clientId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      fetchClients(session.accessToken),
      fetchDbsIntegrations(session.accessToken, { marketplace: marketplace.apiValue }),
    ])
      .then(([loadedClients, loadedIntegrations]) => {
        if (!active) return;
        const activeClients = loadedClients.filter((client) => client.status !== 'ARCHIVED');
        setClients(activeClients);
        setIntegrations(loadedIntegrations);
        const firstClientId = validRememberedClientId(
          rememberedClientId,
          activeClients,
          loadedIntegrations[0]?.clientId,
        );
        setForm(formForClient(firstClientId, activeClients, loadedIntegrations));
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить настройки DBS.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [marketplace.apiValue, session.accessToken]);

  function selectClient(clientId: string) {
    setRememberedClientId(clientId);
    setForm(formForClient(clientId, clients, integrations));
    setError('');
    setMessage('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload: UpsertDbsIntegrationPayload = {
        clientId: form.clientId,
        marketplace: marketplace.apiValue,
        senderName: form.senderName.trim(),
        contactName: form.contactName?.trim(),
        phone: form.phone.trim(),
        email: form.email?.trim(),
        city: form.city.trim(),
        address: form.address.trim(),
        postalCode: form.postalCode?.trim(),
        deliveryProvider: form.deliveryProvider,
        deliveryServiceName: form.deliveryServiceName?.trim(),
        deliveryApiUrl: form.deliveryApiUrl?.trim(),
        deliveryAccountId: form.deliveryAccountId?.trim(),
        deliveryApiKey: form.deliveryApiKey.trim(),
        deliveryApiSecret: form.deliveryApiSecret.trim(),
        isActive: form.isActive,
      };

      let saved: DbsIntegrationSummary;
      if (form.id) {
        const updatePayload: Partial<UpsertDbsIntegrationPayload> = { ...payload };
        if (!form.deliveryApiKey.trim()) delete updatePayload.deliveryApiKey;
        if (!form.deliveryApiSecret.trim()) delete updatePayload.deliveryApiSecret;
        saved = await updateDbsIntegration(session.accessToken, form.id, updatePayload);
      } else {
        saved = await createDbsIntegration(session.accessToken, payload);
      }
      const checked = await checkDbsIntegration(session.accessToken, saved.id);
      setIntegrations((current) => [checked, ...current.filter((item) => item.id !== checked.id)]);
      setForm(formFromIntegration(checked));
      setMessage(checked.check.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить настройку DBS.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="dbs-panel" aria-label={marketplace.title}>
      <header className="dbs-panel__hero">
        <div className={`dbs-panel__hero-icon dbs-panel__hero-icon--${marketplace.accent}`}>
          <Truck size={24} aria-hidden="true" />
        </div>
        <div>
          <button className="dbs-panel__back" type="button" onClick={onBack}>
            <ArrowLeft size={18} aria-hidden="true" />Назад к DBS
          </button>
          <p className="eyebrow">{marketplace.eyebrow}</p>
          <h2>{marketplace.title}</h2>
          <p>Выберите клиента, проверьте данные отправителя и добавьте API службы доставки.</p>
        </div>
        <span className="dbs-panel__scope">{integrations.filter((item) => item.ready).length} готово</span>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="dbs-setup-layout">
        <form className="dbs-setup-form" onSubmit={submit}>
          <header className="dbs-setup-form__heading">
            <span><PlugZap size={20} aria-hidden="true" /></span>
            <div><p className="eyebrow">Быстрая настройка</p><h3>Клиент и доставка</h3></div>
          </header>

          <section className="dbs-form-section">
            <div className="dbs-form-section__title"><span>1</span><div><strong>Клиент</strong><small>Реквизиты подставятся автоматически</small></div></div>
            <div className="dbs-form-grid">
              <label className="dbs-form-field dbs-form-field--wide">
                <span>Клиент</span>
                <select value={form.clientId} onChange={(event) => selectClient(event.target.value)} required disabled={loading}>
                  {!clients.length ? <option value="">Нет доступных клиентов</option> : null}
                  {clients.map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name}</option>)}
                </select>
              </label>
              <label className="dbs-form-field"><span>Отправитель</span><input value={form.senderName} onChange={(event) => setForm({ ...form, senderName: event.target.value })} required /></label>
              <label className="dbs-form-field"><span>Контактное лицо</span><input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></label>
              <label className="dbs-form-field"><span>Телефон</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required /></label>
              <label className="dbs-form-field"><span>Email</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
              <label className="dbs-form-field"><span>Город отправки</span><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} required /></label>
              <label className="dbs-form-field"><span>Индекс</span><input value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} /></label>
              <label className="dbs-form-field dbs-form-field--wide"><span>Адрес забора заказов</span><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} required /></label>
            </div>
          </section>

          <section className="dbs-form-section">
            <div className="dbs-form-section__title"><span>2</span><div><strong>Служба доставки</strong><small>Доступ к API курьерской службы</small></div></div>
            <div className="dbs-form-grid">
              <label className="dbs-form-field"><span>Служба доставки</span><select value={form.deliveryProvider} onChange={(event) => setForm({ ...form, deliveryProvider: event.target.value })}>{deliveryProviders.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}</select></label>
              <label className="dbs-form-field"><span>ID аккаунта / логин</span><input value={form.deliveryAccountId} onChange={(event) => setForm({ ...form, deliveryAccountId: event.target.value })} /></label>
              {form.deliveryProvider === 'OTHER' ? <label className="dbs-form-field"><span>Название службы</span><input value={form.deliveryServiceName} onChange={(event) => setForm({ ...form, deliveryServiceName: event.target.value })} required /></label> : null}
              <label className="dbs-form-field"><span>Адрес API (если свой)</span><input value={form.deliveryApiUrl} onChange={(event) => setForm({ ...form, deliveryApiUrl: event.target.value })} placeholder="https://api.delivery.ru" /></label>
              <label className="dbs-form-field"><span>{form.id ? 'Новый API-ключ' : 'API-ключ'}</span><input type="password" autoComplete="new-password" value={form.deliveryApiKey} onChange={(event) => setForm({ ...form, deliveryApiKey: event.target.value })} placeholder={currentIntegration?.deliveryApiKeyMask || ''} required={!form.id} /></label>
              <label className="dbs-form-field"><span>{form.id ? 'Новый секрет' : 'Секрет API'}</span><input type="password" autoComplete="new-password" value={form.deliveryApiSecret} onChange={(event) => setForm({ ...form, deliveryApiSecret: event.target.value })} placeholder={currentIntegration?.hasDeliveryApiSecret ? 'Секрет сохранён' : 'Если требуется службой'} /></label>
            </div>
          </section>

          <div className="dbs-form-readiness">
            <StatusLine ok={Boolean(selectedClient)} label="Клиент выбран" />
            <StatusLine ok={currentIntegration?.hasMarketplaceApi ?? false} label={`API ${marketplace.eyebrow} в карточке клиента`} />
            <StatusLine ok={Boolean(form.deliveryApiKey || currentIntegration?.hasDeliveryApiKey)} label="API службы доставки" />
          </div>

          <footer className="dbs-setup-form__footer">
            <label className="dbs-active-toggle"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /><span>Подключение активно</span></label>
            <button className="primary-button" type="submit" disabled={!canWrite || saving || loading || !form.clientId || (!form.id && form.deliveryApiKey.trim().length < 8)}>
              <Save size={17} aria-hidden="true" />{saving ? 'Сохраняю…' : 'Сохранить и проверить'}
            </button>
          </footer>
          {!canWrite ? <p className="dbs-form-note">Для изменения настроек требуется право редактирования клиентов.</p> : null}
        </form>

        <aside className="dbs-configured" aria-label="Настроенные клиенты DBS">
          <header><div><p className="eyebrow">Подключения</p><h3>Настроенные клиенты</h3></div><strong>{integrations.length}</strong></header>
          <div className="dbs-configured__list">
            {integrations.map((integration) => (
              <button key={integration.id} type="button" className={integration.id === form.id ? 'is-selected' : ''} onClick={() => setForm(formFromIntegration(integration))}>
                <span className={`dbs-configured__status ${integration.ready ? 'is-ready' : 'is-warning'}`}>{integration.ready ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}</span>
                <span><strong>{integration.client.name}</strong><small>{deliveryProviderLabel(integration)} · {integration.city}</small><em>{integration.ready ? 'Готово к работе' : integration.lastCheckMessage || 'Требуется проверка'}</em></span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ))}
            {!integrations.length && !loading ? <div className="dbs-configured__empty"><KeyRound size={25} /><strong>Подключений пока нет</strong><span>Выберите клиента и заполните форму.</span></div> : null}
          </div>
          <div className="dbs-workspace-shell__steps">
            <span><ShoppingBag size={18} />Заказы</span><span><PackageCheck size={18} />Сборка</span><span><Truck size={18} />Доставка</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? 'is-ok' : 'is-missing'}>{ok ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}{label}</span>;
}

function formForClient(clientId: string, clients: ClientSummary[], integrations: DbsIntegrationSummary[]) {
  const integration = integrations.find((item) => item.clientId === clientId);
  if (integration) return formFromIntegration(integration);
  const client = clients.find((item) => item.id === clientId);
  return {
    ...emptyForm,
    clientId,
    senderName: client?.legalName || client?.name || '',
    contactName: client?.fulfillmentManager?.name || '',
    phone: client?.phone || '',
    email: client?.email || '',
    address: client?.actualAddress || client?.legalAddress || '',
  };
}

function formFromIntegration(integration: DbsIntegrationSummary): DbsForm {
  return {
    id: integration.id,
    clientId: integration.clientId,
    senderName: integration.senderName,
    contactName: integration.contactName || '',
    phone: integration.phone,
    email: integration.email || '',
    city: integration.city,
    address: integration.address,
    postalCode: integration.postalCode || '',
    deliveryProvider: integration.deliveryProvider,
    deliveryServiceName: integration.deliveryServiceName || '',
    deliveryApiUrl: integration.deliveryApiUrl || '',
    deliveryAccountId: integration.deliveryAccountId || '',
    deliveryApiKey: '',
    deliveryApiSecret: '',
    isActive: integration.isActive,
  };
}

function deliveryProviderLabel(integration: DbsIntegrationSummary) {
  if (integration.deliveryProvider === 'OTHER') return integration.deliveryServiceName || 'Другая служба';
  return deliveryProviders.find((item) => item.value === integration.deliveryProvider)?.label || integration.deliveryProvider;
}
