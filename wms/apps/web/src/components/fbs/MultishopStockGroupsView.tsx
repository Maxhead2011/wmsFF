import { useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../../lib/api';

type Member = { connectionId: string; percent: number; priority: number };
type Group = { id: string; name: string; warehouseId: string; lowStockThreshold: number; members: Member[] };
type Config = { groups: Group[]; assignments: { skuId: string; groupId: string }[] };
type Connection = { id: string; accountName: string | null; marketplace: string; fbsExecutionWarehouseId: string | null };
type State = { config: Config; revision: string | null; connections: Connection[]; invalidReason: string | null };
type Product = { id: string; name: string; article: string | null; size: string | null; color: string | null; barcodes: { value: string }[] };
type ProductPage = { items: Product[]; total: number; page: number; pageSize: number };

async function call<T>(token: string, path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const base = import.meta.env.VITE_API_URL ?? '/api/v1';
  const response = await fetch(`${base}/marketplace-connections/multishop/${path}`, {
    method: body === undefined ? 'GET' : 'PUT', signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join('. ') : data.message || 'Не удалось загрузить группы магазинов.');
  return data;
}

// FIX: remount per client and cancel stale requests; configuration remains a draft until activation.
export function MultishopStockGroupsView(props: { session: AuthSession; clientId: string }) {
  return <Editor key={`${props.clientId}:${props.session.user.id}`} {...props} />;
}

function Editor({ session, clientId }: { session: AuthSession; clientId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<ProductPage | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const alive = useRef(true);
  const client = encodeURIComponent(clientId);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setState(null);
    call<State>(session.accessToken, client, controller.signal).then(value => { setState(value); setDirty(false); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [client, session.accessToken, reload]);
  useEffect(() => {
    const controller = new AbortController();
    setProducts(null); setSelected([]);
    call<ProductPage>(session.accessToken, `${client}/products?q=${encodeURIComponent(search)}&page=${page}`, controller.signal)
      .then(setProducts).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [client, session.accessToken, search, page]);
  function edit(config: Config) { setState(value => value ? { ...value, config } : value); setDirty(true); setMessage(''); }
  function groupEdit(id: string, patch: Partial<Group>) {
    if (state) edit({ ...state.config, groups: state.config.groups.map(g => g.id === id ? { ...g, ...patch } : g) });
  }
  async function save() {
    if (!state || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await call<{ revision: string; config: Config }>(session.accessToken, client, undefined, { revision: state.revision, config: state.config });
      if (alive.current) { setState({ ...state, ...result }); setDirty(false); setMessage('Группы и назначения сохранены. Отправка остатков не включена.'); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Не удалось сохранить.'); }
    finally { if (alive.current) setBusy(false); }
  }
  const canEdit = session.user.permissionCodes.includes('system:admin') || session.user.writableClientIds.includes(clientId);
  return <section className="multishop-groups">
    <h3>Между магазинами</h3>
    <p>Назначьте товары группам магазинов: например, первой или второй паре WB/Ozon. Для каждой группы задайте доли общего остатка.</p>
    <p className="multishop-groups__notice">Сейчас сохраняется только схема распределения. Эти настройки пока не меняют действующую отправку остатков в магазины.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!state ? <p role="status">{error ? 'Раздел не загружен.' : 'Загрузка групп…'} <button type="button" onClick={() => setReload(v => v + 1)}>Повторить</button></p> : <>
      {state.invalidReason && <p role="alert">Проверьте сохранённые группы: {state.invalidReason}</p>}
      <fieldset disabled={busy || !canEdit}>
        <div className="multishop-groups__actions"><button type="button" onClick={() => edit({ ...state.config, groups: [...state.config.groups, { id: crypto.randomUUID(), name: `Группа ${state.config.groups.length + 1}`, warehouseId: '', lowStockThreshold: 2, members: [] }] })}>Добавить группу</button>
          <button type="button" disabled={!dirty} onClick={() => void save()}>{busy ? 'Сохранение…' : 'Сохранить изменения'}</button><span>{dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}</span></div>
        {state.config.groups.map(group => <article className="multishop-groups__card" key={group.id}>
          <div className="multishop-groups__actions"><label>Название группы<input value={group.name} maxLength={200} onChange={e => groupEdit(group.id, { name: e.target.value })} /></label>
            <label>Малый остаток, шт.<input type="number" min={0} step={1} value={group.lowStockThreshold} onChange={e => groupEdit(group.id, { lowStockThreshold: Number(e.target.value) })} /></label>
            <button type="button" disabled={state.config.assignments.some(a => a.groupId === group.id)} onClick={() => edit({ ...state.config, groups: state.config.groups.filter(g => g.id !== group.id) })}>Удалить пустую группу</button></div>
          <p>При малом остатке все единицы получает магазин с наименьшим номером приоритета и ненулевой долей.</p>
          <div className="multishop-groups__shops">{state.connections.map(connection => {
            const member = group.members.find(m => m.connectionId === connection.id);
            return <div key={connection.id} className="multishop-groups__shop"><label><input type="checkbox" checked={Boolean(member)} disabled={!connection.fbsExecutionWarehouseId || (!member && Boolean(group.warehouseId) && connection.fbsExecutionWarehouseId !== group.warehouseId)} onChange={e => {
              const members = e.target.checked ? [...group.members, { connectionId: connection.id, percent: group.members.length ? 0 : 100, priority: Math.max(-1, ...group.members.map(m => m.priority)) + 1 }] : group.members.filter(m => m.connectionId !== connection.id);
              groupEdit(group.id, { members, warehouseId: members.length ? group.warehouseId || connection.fbsExecutionWarehouseId! : '' });
            }} />{connection.marketplace === 'WILDBERRIES' ? 'WB' : 'Ozon'} · {connection.accountName || connection.id}</label>
              {!connection.fbsExecutionWarehouseId && <span>Не задан склад исполнения</span>}
              {member && <><label>Доля, %<input type="number" min={0} max={100} step={1} value={member.percent} onChange={e => groupEdit(group.id, { members: group.members.map(m => m === member ? { ...m, percent: Number(e.target.value) } : m) })} /></label>
                <label>Приоритет<input type="number" min={0} step={1} value={member.priority} onChange={e => groupEdit(group.id, { members: group.members.map(m => m === member ? { ...m, priority: Number(e.target.value) } : m) })} /></label></>}
            </div>;
          })}</div><p>Сумма долей: <strong>{group.members.reduce((sum, m) => sum + m.percent, 0)}%</strong> · Назначено товаров: {state.config.assignments.filter(a => a.groupId === group.id).length}</p>
        </article>)}
      </fieldset>
      <h4>Товары и группы магазинов</h4>
      <form className="multishop-groups__actions" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}><input aria-label="Артикул, товар или штрихкод" placeholder="Артикул, товар или штрихкод" value={query} onChange={e => setQuery(e.target.value)} /><button type="submit">Найти</button></form>
      <fieldset disabled={busy || !canEdit}><div className="multishop-groups__actions"><select aria-label="Группа для выбранных товаров" value={target} onChange={e => setTarget(e.target.value)}><option value="">Без группы</option>{state.config.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select><button type="button" disabled={!selected.length} onClick={() => {
        edit({ ...state.config, assignments: [...state.config.assignments.filter(a => !selected.includes(a.skuId)), ...selected.flatMap(skuId => target ? [{ skuId, groupId: target }] : [])] }); setSelected([]);
      }}>Назначить выбранным ({selected.length})</button></div>
        <div className="multishop-groups__table"><table><thead><tr><th><input aria-label="Выбрать товары на странице" type="checkbox" checked={Boolean(products?.items.length) && products!.items.every(p => selected.includes(p.id))} onChange={e => setSelected(e.target.checked ? products?.items.map(p => p.id) ?? [] : [])} /></th><th>Товар / размер / цвет</th><th>Штрихкоды</th><th>Группа</th></tr></thead><tbody>{products?.items.map(p => <tr key={p.id}><td><input aria-label={`Выбрать ${p.name}`} type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} /></td><td><strong>{p.name}</strong><br />{[p.article, p.size, p.color].filter(Boolean).join(' · ')}</td><td>{p.barcodes.map(b => b.value).join(', ')}</td><td>{state.config.groups.find(g => g.id === state.config.assignments.find(a => a.skuId === p.id)?.groupId)?.name ?? 'Без группы'}</td></tr>)}</tbody></table></div>
      </fieldset>
      {!products ? <p role="status">Загрузка товаров…</p> : <div className="multishop-groups__actions"><button type="button" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Назад</button><span>Страница {page} · Всего {products.total}</span><button type="button" disabled={page * products.pageSize >= products.total} onClick={() => setPage(v => v + 1)}>Далее</button></div>}
    </>}
  </section>;
}
