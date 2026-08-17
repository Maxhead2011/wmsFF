import { Check, CheckCircle2, Download, Factory, PackagePlus, RefreshCw, Send, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createFactoryShipment,
  createUser,
  fetchClients,
  fetchFactoryShipments,
  fetchSkus,
  fetchUsers,
  reconcileFactoryShipment,
  shipFactoryShipment,
  updateClient,
  updateUserClientScopes,
  updateUserRoles,
  type AuthSession,
  type ClientSummary,
  type FactoryShipment as FactoryShipmentType,
  type SkuSummary,
  type UserSummary,
} from '../../lib/api';
import './factory.css';

type UserMode = 'existing' | 'create';

export function FactoryPanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [clientId, setClientId] = useState('');
  const [factoryChoice, setFactoryChoice] = useState('new');
  const [factoryName, setFactoryName] = useState('Бишкек');
  const [factoryCode, setFactoryCode] = useState('');
  const [userMode, setUserMode] = useState<UserMode>('existing');
  const [userId, setUserId] = useState('');
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [isSavingSetup, setSavingSetup] = useState(false);
  const [isFactorySaved, setFactorySaved] = useState(false);
  const [shipments, setShipments] = useState<FactoryShipmentType[]>([]);
  const [skus, setSkus] = useState<SkuSummary[]>([]);
  const [title, setTitle] = useState('Отправка с фабрики');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Array<{ sku: SkuSummary; qty: number }>>([]);
  const [message, setMessage] = useState('');

  const enabledClients = useMemo(() => clients.filter((item) => item.factoryEnabled), [clients]);
  const selectedClient = clients.find((item) => item.id === clientId) ?? null;
  const factoryReady = Boolean(factoryName.trim() && factoryCode.trim() && clientId);
  const userReady = Boolean(isFactorySaved && (userMode === 'existing' ? userId : newUser.name.trim() && newUser.email.trim() && newUser.password));

  async function loadSetup() {
    const [nextClients, nextUsers] = await Promise.all([fetchClients(session.accessToken), fetchUsers(session.accessToken)]);
    setClients(nextClients);
    setUsers(nextUsers);
    setUserId((current) => current || nextUsers[0]?.id || '');
    const first = nextClients.find((item) => item.factoryEnabled) ?? nextClients[0];
    if (first) selectClient(first.id, nextClients);
  }

  async function reload(nextClientId = clientId) {
    setShipments(await fetchFactoryShipments(session.accessToken, nextClientId || undefined));
  }

  function selectClient(nextClientId: string, source = clients) {
    const client = source.find((item) => item.id === nextClientId);
    setClientId(nextClientId);
    setRows([]);
    if (client?.factoryEnabled) {
      setFactoryChoice(client.id);
      setFactoryName(client.factoryName || 'Бишкек');
      setFactoryCode(client.factoryCode || '');
      setFactorySaved(true);
    } else {
      setFactorySaved(false);
    }
    void reload(nextClientId);
  }

  function selectFactory(value: string) {
    setFactoryChoice(value);
    if (value === 'new') {
      setFactoryName('');
      setFactoryCode('');
      setFactorySaved(false);
      return;
    }
    const client = enabledClients.find((item) => item.id === value);
    if (client) selectClient(client.id);
  }

  async function saveFactory() {
    if (!factoryReady) return;
    setSavingSetup(true);
    setMessage('');
    try {
      await updateClient(session.accessToken, clientId, {
        factoryEnabled: true,
        factoryName: factoryName.trim(),
        factoryCode: factoryCode.trim(),
      });
      setFactorySaved(true);
      await loadSetup();
      setMessage(`Фабрика «${factoryName.trim()}» создана. Теперь назначьте пользователя.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось создать фабрику.');
    } finally {
      setSavingSetup(false);
    }
  }

  async function saveUser() {
    if (!userReady) return;
    setSavingSetup(true);
    setMessage('');
    try {
      let assignedUserId = userId;
      if (userMode === 'create') {
        const created = await createUser(session.accessToken, {
          name: newUser.name.trim(),
          email: newUser.email.trim(),
          password: newUser.password,
          roleCodes: ['FACTORY_OPERATOR'],
          clientIds: [clientId],
          writableClientIds: [clientId],
        });
        assignedUserId = created.id;
        setUserId(created.id);
      } else {
        const selectedUser = users.find((item) => item.id === assignedUserId);
        const roleCodes = [...new Set([...(selectedUser?.roles.map((item) => item.role.code) ?? []), 'FACTORY_OPERATOR'])];
        await updateUserRoles(session.accessToken, assignedUserId, { roleCodes });
        await updateUserClientScopes(session.accessToken, assignedUserId, {
          scopes: [{ clientId, canRead: true, canWrite: true }],
        });
      }
      await loadSetup();
      await reload(clientId);
      setMessage('Пользователь фабрики назначен. Можно скачать приложение и войти под его логином.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось назначить пользователя фабрики.');
    } finally {
      setSavingSetup(false);
    }
  }

  useEffect(() => { void loadSetup().catch((error) => setMessage(String(error))); }, []);
  useEffect(() => {
    if (!clientId) return;
    void fetchSkus(session.accessToken, { clientId, search }).then(setSkus).catch(() => setSkus([]));
  }, [clientId, search]);

  async function create() {
    if (!clientId || !rows.length) return;
    await createFactoryShipment(session.accessToken, { clientId, title, items: rows.map((row) => ({ skuId: row.sku.id, plannedQty: row.qty })) });
    setRows([]);
    setMessage('Предварительная отправка создана. Товар в остатки не зачислен.');
    await reload();
  }

  return <div className="factory-panel">
    <section className="factory-hero"><div><small>ПРОИЗВОДСТВО → ФУЛФИЛМЕНТ</small><h2>Фабрика</h2><p>Подключите фабрику за три шага, затем создавайте и контролируйте отправки.</p></div><Factory size={34}/></section>

    <section className="factory-setup" aria-label="Подключение фабрики">
      <header><div><small>БЫСТРЫЙ СТАРТ</small><h3>Настройка фабрики</h3></div><span>3 шага</span></header>
      <div className="factory-setup__steps">
        <article className="factory-step">
          <span className="factory-step__number">1</span>
          <div className="factory-step__content"><h4>Выберите фабрику</h4><p>Выберите подключённую или создайте новую.</p>
            <label>Фабрика<select value={factoryChoice} onChange={(event) => selectFactory(event.target.value)}><option value="new">＋ Создать новую фабрику</option>{enabledClients.map((client) => <option key={client.id} value={client.id}>{client.factoryName || 'Фабрика'} · {client.name}</option>)}</select></label>
            {factoryChoice === 'new' ? <div className="factory-step__fields"><label>Название<input value={factoryName} onChange={(event) => { setFactoryName(event.target.value); setFactorySaved(false); }} placeholder="Например, Бишкек" /></label><label>Код подключения<input value={factoryCode} onChange={(event) => { setFactoryCode(event.target.value); setFactorySaved(false); }} placeholder="Например, LUKIN-BISHKEK" /></label><button className="factory-primary factory-setup__save" type="button" disabled={!factoryReady || isSavingSetup} onClick={() => void saveFactory()}>{isSavingSetup ? 'Создаю…' : 'Создать фабрику'}</button></div> : <div className="factory-step__selected"><Check size={16}/><span>{factoryName}<small>{factoryCode}</small></span></div>}
          </div>
        </article>

        <article className="factory-step">
          <span className="factory-step__number">2</span>
          <div className="factory-step__content"><h4>Клиент и сотрудник</h4><p>Укажите владельца товара и кто будет пикать отправку.</p>
            <label>Клиент<select value={clientId} onChange={(event) => selectClient(event.target.value)}><option value="">Выберите клиента</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name}</option>)}</select></label>
            <div className="factory-user-switch"><button className={userMode === 'existing' ? 'is-active' : ''} type="button" onClick={() => setUserMode('existing')}>Выбрать пользователя</button><button className={userMode === 'create' ? 'is-active' : ''} type="button" onClick={() => setUserMode('create')}><UserPlus size={15}/> Создать</button></div>
            {userMode === 'existing' ? <label>Пользователь<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Выберите пользователя</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label> : <div className="factory-step__fields"><label>Имя<input value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} /></label><label>Логин<input value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} /></label><label>Пароль<input type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} /></label></div>}
            {!isFactorySaved ? <small className="factory-step__notice">Сначала создайте фабрику на шаге 1.</small> : null}<button className="factory-primary factory-setup__save" type="button" disabled={!userReady || isSavingSetup} onClick={() => void saveUser()}>{isSavingSetup ? 'Сохраняю…' : 'Назначить пользователя'}</button>
          </div>
        </article>

        <article className="factory-step factory-step--download">
          <span className="factory-step__number">3</span>
          <div className="factory-step__content"><h4>Скачайте приложение</h4><p>Установите «Отправка ТСД» на устройство фабрики и войдите созданным логином.</p><div className="factory-app-card"><div className="factory-app-card__icon">ОТ</div><span><b>Отправка ТСД</b><small>Android · отдельное приложение</small></span></div><a className="factory-download" href="/downloads/factory-dispatch-tsd.apk" download><Download size={18}/> Скачать APK</a><small className="factory-download__hint">После установки откройте приложение, введите адрес WMS, логин и пароль сотрудника фабрики.</small></div>
        </article>
      </div>
    </section>

    {message && <p className="factory-message">{message}</p>}
    {selectedClient?.factoryEnabled ? <>
      <div className="factory-toolbar"><label>Текущий клиент<select value={clientId} onChange={(event) => selectClient(event.target.value)}>{enabledClients.map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name} · {client.factoryName || 'Фабрика'}</option>)}</select></label><button onClick={() => void reload()}><RefreshCw size={16}/> Обновить</button></div>
      <section className="factory-create"><h3><PackagePlus size={19}/> Новая предварительная отправка</h3><div className="factory-create__grid"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название отправки"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти товар, артикул или ШК"/><select onChange={(event) => { const sku = skus.find((item) => item.id === event.target.value); if (sku && !rows.some((row) => row.sku.id === sku.id)) setRows([...rows, { sku, qty: 1 }]); event.currentTarget.value=''; }} defaultValue=""><option value="">Добавить товар…</option>{skus.map((sku) => <option key={sku.id} value={sku.id}>{sku.article || sku.internalSku} · {sku.name} · {sku.size || '—'}</option>)}</select></div>
        {rows.map((row) => <div className="factory-line" key={row.sku.id}><span><b>{row.sku.name}</b><small>{row.sku.article || row.sku.internalSku} · {row.sku.size || 'без размера'}</small></span><input type="number" min="1" value={row.qty} onChange={(event) => setRows(rows.map((item) => item.sku.id === row.sku.id ? { ...item, qty: Math.max(1, Number(event.target.value)) } : item))}/><button onClick={() => setRows(rows.filter((item) => item.sku.id !== row.sku.id))}>Убрать</button></div>)}
        <button className="factory-primary" disabled={!rows.length} onClick={() => void create().catch((error) => setMessage(String(error)))}><PackagePlus size={17}/> Создать отправку</button></section>
      <div className="factory-list">{shipments.map((shipment) => { const plan=shipment.items.reduce((sum,item)=>sum+item.plannedQty,0), scan=shipment.items.reduce((sum,item)=>sum+item.scannedQty,0), received=shipment.items.reduce((sum,item)=>sum+item.receivedQty,0); return <details className="factory-card" key={shipment.id}><summary><div><small>№{String(shipment.number).padStart(6,'0')} · {shipment.factoryName}</small><b>{shipment.title}</b><span>{shipment.client.name}</span></div><div className="factory-metrics"><span>План <b>{plan}</b></span><span>Пропикано <b>{scan}</b></span><span>Принято <b>{received}</b></span><em>{shipment.status}</em></div></summary><div className="factory-card__body"><table><thead><tr><th>Товар</th><th>Размер</th><th>План</th><th>Фабрика</th><th>Приёмка</th><th>Разница</th></tr></thead><tbody>{shipment.items.map((item)=><tr key={item.id}><td>{item.name}<small>{item.article}</small></td><td>{item.size||'—'}</td><td>{item.plannedQty}</td><td>{item.scannedQty}</td><td>{item.receivedQty}</td><td className={item.receivedQty && item.receivedQty!==item.scannedQty?'is-error':''}>{item.receivedQty-item.scannedQty}</td></tr>)}</tbody></table><div className="factory-actions">{['DRAFT','PICKING'].includes(shipment.status)&&<button onClick={()=>void shipFactoryShipment(session.accessToken,shipment.id).then(()=>reload())}><Send size={16}/> Отправлено</button>}<button onClick={()=>{const id=prompt('ID фактической заявки приёмки'); if(id) void reconcileFactoryShipment(session.accessToken,shipment.id,id).then(()=>reload()).catch(error=>setMessage(String(error)));}}><CheckCircle2 size={16}/> Сверить с приёмкой</button></div></div></details>; })}</div>
    </> : null}
  </div>;
}
