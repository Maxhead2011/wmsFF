import { useEffect, useRef, useState } from 'react';
import { fetchClients, request, type AuthSession, type ClientSummary } from '../../lib/api';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
import './fabric-warehouse.css';
import { FabricColorLabel } from './FabricColorLabel';

type Color = { id: string; material: string; name: string };
type Roll = { id: string; code: string; material: string; color: string; remainingMm: number; warehouseId: string };
type Group = { key: string; material: string; colorName: string; whole: number; open: number; rawMeters: number; rawLiters: number; rolls: Roll[]; ready: { pieces: number; meters: number }[]; fbs: { pieces: number; meters: number }; fbo: { pieces: number; meters: number } };
type Rolls = { enabled: boolean; version: string | null; groups?: Group[]; history?: { createdAt: string; action: string; payload?: { reason?: string } }[] };
type Catalog = { version: string | null; colors: Color[]; baseColors: Record<string, string>; skus: { id: string; name: string; internalSku: string; marketplace: string | null; productId: string | null; offerId: string | null; barcodes: string[]; binding: { material: string; color: string; lengthMm: number } | null }[] };
const MATERIALS: Record<string, string> = { SATIN: 'Атлас', GABARDINE: 'Габардин' };
export function FabricWarehousePanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [rolls, setRolls] = useState<Rolls | null>(null), [catalog, setCatalog] = useState<Catalog | null>(null);
  const [material, setMaterial] = useState('SATIN'), [color, setColor] = useState('black'), [name, setName] = useState('');
  const [count, setCount] = useState(1), [skuId, setSkuId] = useState(''), [meters, setMeters] = useState(5);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [rollId, setRollId] = useState(''), [operation, setOperation] = useState('ADJUST'), [delta, setDelta] = useState(0), [reason, setReason] = useState('');
  const [barcode, setBarcode] = useState(''), [boxCode, setBoxCode] = useState(''), [kiz, setKiz] = useState(''), [pieces, setPieces] = useState(1);
  const generation = useRef(0), pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const token = session.accessToken, path = '/warehouse/fabric-rolls/' + encodeURIComponent(clientId);
  const canManage = !session.user.roleCodes.includes('CLIENT') && session.user.permissionCodes.some(p => ['stock:write', 'system:admin'].includes(p));
  const canConfigure = !session.user.roleCodes.includes('CLIENT') && session.user.permissionCodes.some(p => ['clients:write', 'system:admin'].includes(p));
  useEffect(() => { let active = true; fetchClients(token).then(items => { if (active) { setClients(items); setClientId(id => validRememberedClientId(id, items)); } }).catch(e => { if (active) setError(String(e.message)); }); return () => { active = false; }; }, [token]);
  async function load() {
    const g = ++generation.current; setError('');
    try { const [r, c] = await Promise.all([request<Rolls>(path, { accessToken: token }), request<Catalog>('/warehouse/fabric-catalog/' + encodeURIComponent(clientId), { accessToken: token })]); if (g === generation.current) { setRolls(r); setCatalog(c); } }
    catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { setRolls(null); setCatalog(null); setSkuId(''); setColor('black'); setMessage(''); pending.current = null; if (clientId) void load(); return () => { generation.current++; }; }, [clientId, token, session.user.activeWarehouseId]);
  async function saveCatalog(action: string) {
    if (!catalog || busy) return; setBusy(true); setError(''); const g = generation.current;
    try { const result = await request<{ result: { color?: Color; reused?: boolean }; catalog: Catalog }>('/warehouse/fabric-catalog/' + encodeURIComponent(clientId), { accessToken: token, method: 'POST', body: { action, material, name, skuId, colorId: color, lengthMm: Math.round(meters * 1000), version: catalog.version } });
      if (g !== generation.current) return; setCatalog(result.catalog); if (result.result.color) { setColor(result.result.color.id); setName(''); } setMessage(result.result.reused ? 'Такой цвет уже есть — он выбран.' : action === 'CREATE_COLOR' ? 'Цвет добавлен и выбран для приёмки.' : 'Привязка товара сохранена.'); await load();
    } catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function saveRoll(body: Record<string, unknown>) {
    if (busy || !rolls) return; setBusy(true); setError(''); const g = generation.current;
    const fingerprint = JSON.stringify({ clientId, body });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try { const result = await request<Rolls>(path, { method: 'POST', accessToken: token, body: { ...body, version: rolls.version, operationKey: pending.current.key } }); if (g === generation.current) { setRolls(result); pending.current = null; setMessage(body.action === 'RECEIVE' ? 'Рулоны приняты.' : 'Операция с рулоном сохранена.'); } }
    catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function enableRolls() {
    if (busy) return; setBusy(true); setError(''); const g = generation.current;
    try { const result = await request<Rolls>(path, { method: 'PUT', accessToken: token, body: { enabled: true } }); if (g === generation.current) setRolls(result); }
    catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const colors = [...Object.entries(catalog?.baseColors ?? {}).map(([id, label]) => ({ id, name: label })), ...(catalog?.colors.filter(c => c.material === material) ?? [])];
  return <section className="warehouse-panel fabric-warehouse" aria-label="Ткани: хранение и учёт">
    {/* FIX: scoped visual layout, existing stock and write handlers preserved. */}
    <header className="fabric-heading"><div><span className="fabric-eyebrow">Склад · ткани</span><h2>Ткани: хранение и учёт</h2><p>Рулоны, готовые отрезы и движение ткани</p></div></header>
    <div className="fabric-toolbar">
    <label>Клиент<select value={clientId} disabled={busy} onChange={e => setClientId(e.target.value)}><option value="">Выберите клиента</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>

    {clientId ? <button type="button" disabled={busy} onClick={() => void load()}>Обновить</button> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    {rolls && !rolls.enabled ? <div><p>Рулонный учёт у клиента выключен.</p>{canConfigure ? <button disabled={busy} onClick={() => void enableRolls()}>Включить «Товар в рулонах»</button> : <p>Для включения обратитесь к администратору.</p>}</div> : null}
    {rolls?.enabled && catalog ? <>
      <p>Рулон — 100 м. Остатки рулонов и готовые отрезы учитываются отдельно.</p>
      <div className="warehouse-topic-grid">{rolls.groups?.map(g => <article className="warehouse-panel" key={g.key}>
        <h3 className="fabric-card-title"><span className="fabric-material">{MATERIALS[g.material]}</span><FabricColorLabel name={g.colorName} /></h3><p>Целых: {g.whole} · открытых: {g.open} · в рулонах: {g.rawMeters.toLocaleString('ru-RU')} м</p><p>Объём хранения: {g.rawLiters.toLocaleString('ru-RU')} л</p>
        <p>Готовые отрезы: {g.ready.reduce((n, r) => n + r.pieces, 0)} шт.</p><p>FBS: {g.fbs.pieces} отрезов / {g.fbs.meters} м · FBO: {g.fbo.pieces} отрезов / {g.fbo.meters} м</p>
        <details><summary>Остаток каждого рулона</summary>{g.rolls.map(r => <p key={r.id}>{r.code}: {(r.remainingMm / 1000).toLocaleString('ru-RU')} м</p>)}</details>
      </article>)}</div>
      {canManage ? <>
        <section className="fabric-intake"><div className="fabric-section-heading"><h3>Приёмка новых рулонов</h3><span>1 рулон = 100 м</span></div><div className="fabric-intake-selects">
        <label>Ткань<select disabled={busy} value={material} onChange={e => { setMaterial(e.target.value); setColor('black'); }}>{Object.entries(MATERIALS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Цвет<select disabled={busy} value={color} onChange={e => setColor(e.target.value)}>{colors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <span className="fabric-selected-color"><FabricColorLabel name={colors.find(c => c.id === color)?.name ?? color} /></span></div>
        <form onSubmit={e => { e.preventDefault(); void saveCatalog('CREATE_COLOR'); }}><label>Новый цвет<input value={name} maxLength={80} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Например, Пудровый" /></label><button disabled={busy || !name.trim()}>Добавить цвет</button></form>
        <form onSubmit={e => { e.preventDefault(); void saveRoll({ action: 'RECEIVE', material, color, count }); }}><label>Количество рулонов<input type="number" min={1} max={500} step={1} value={count} disabled={busy} onChange={e => setCount(Number(e.target.value))} /></label><button disabled={busy || !Number.isInteger(count) || count < 1 || count > 500}>Принять рулоны</button></form>
        </section>
        <details><summary>Операции с рулоном</summary>
          <form onSubmit={e => { e.preventDefault(); void saveRoll(operation === 'CUT' ? { action: operation, rollId, barcode, boxCode, kiz, count: pieces } : operation === 'ADJUST' ? { action: operation, rollId, deltaMm: Math.round(delta * 1000), reason } : { action: operation, rollId, reason }); }}>
            <label>Рулон<select value={rollId} disabled={busy} onChange={e => setRollId(e.target.value)}><option value="">Выберите рулон</option>{rolls.groups?.flatMap(g => g.rolls).filter(r => r.warehouseId === session.user.activeWarehouseId && r.remainingMm > 0).map(r => <option key={r.id} value={r.id}>{r.code} · {r.remainingMm / 1000} м</option>)}</select></label>
            <label>Действие<select value={operation} disabled={busy} onChange={e => setOperation(e.target.value)}><option value="ADJUST">Фактическая корректировка ±2 м</option><option value="CUT">Нарезать готовые отрезы</option><option value="WRITE_OFF">Списать остаток рулона</option></select></label>
            {operation === 'CUT' ? <><label>Штрихкод отреза<input value={barcode} disabled={busy} onChange={e => setBarcode(e.target.value)} /></label><label>Короб готовых отрезов<input value={boxCode} disabled={busy} onChange={e => setBoxCode(e.target.value)} /></label><label>Количество отрезов<input type="number" min={1} max={500} step={1} value={pieces} disabled={busy} onChange={e => setPieces(Number(e.target.value))} /></label><label>КИЗ, по одному на строку<textarea value={kiz} disabled={busy} onChange={e => setKiz(e.target.value)} /></label></> : <>
              {operation === 'ADJUST' ? <label>Изменение, м<input type="number" min={-2} max={2} step={0.001} value={delta} disabled={busy} onChange={e => setDelta(Number(e.target.value))} /></label> : <p>Будет списан весь остаток выбранного рулона.</p>}
              <label>Причина<input value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label></>}
            <button disabled={busy || !rollId || (operation !== 'CUT' && reason.trim().length < 5)}>Сохранить операцию с рулоном</button>
          </form>
        </details>
        <details><summary>Привязка к товару маркетплейса</summary><p>Выберите ткань и цвет выше. Для каждой длины отреза привяжите соответствующую карточку товара WMS.</p>
          <form onSubmit={e => { e.preventDefault(); void saveCatalog('BIND_SKU'); }}><label>Товар<select value={skuId} disabled={busy} onChange={e => setSkuId(e.target.value)}><option value="">Выберите товар клиента</option>{catalog.skus.map(s => <option key={s.id} value={s.id}>{s.marketplace ?? 'WMS'} · {s.name} · {s.offerId ?? s.internalSku}{s.binding ? ' · привязан' : ''}</option>)}</select></label>
            <label>Длина отреза, м<input type="number" min={0.001} max={100} step={0.001} value={meters} disabled={busy} onChange={e => setMeters(Number(e.target.value))} /></label><button disabled={busy || !skuId || !Number.isFinite(meters) || meters <= 0 || meters > 100}>Сохранить привязку</button></form>
        </details>
      </> : null}
      <details><summary>История рулонного учёта</summary>{rolls.history?.map((h, i) => <p key={i}>{new Date(h.createdAt).toLocaleString('ru-RU')} · {h.action} {h.payload?.reason ?? ''}</p>)}</details>
    </> : null}
  </section>;
}
