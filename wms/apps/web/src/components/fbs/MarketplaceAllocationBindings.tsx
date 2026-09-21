import { useEffect, useRef, useState } from 'react';
import { fetchAllocationCatalog, confirmAllocationBinding, type MarketplaceAllocationDraft,
  type MarketplaceAllocationProduct, type MarketplaceAllocationBinding } from '../../lib/api';

// FIX: exact suggestions never bypass explicit confirmation.
export function suggestAllocationPairs(sourceBarcode: string, wb: MarketplaceAllocationProduct[], ozon: MarketplaceAllocationProduct[]) {
  const w = wb.filter(row => row.barcodes.includes(sourceBarcode));
  const o = ozon.filter(row => row.barcodes.includes(sourceBarcode));
  return { wb: w, ozon: o, unique: w.length === 1 && o.length === 1, confirmed: false };
}

export function allocationProductChoices(rows: MarketplaceAllocationProduct[], query: string, selected: string) {
  const current = rows.filter(p => p.productId === selected);
  const matches = rows.filter(p => p.productId !== selected
    && `${p.name} ${p.article ?? ''} ${p.offerId} ${p.size} ${p.barcodes.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return [...current, ...matches.slice(0, Math.max(0, 100 - current.length))];
}

// FIX: exact barcode suggestions do not bypass the client's explicit product/size confirmation.
export function MarketplaceAllocationBindings({ token, clientId, draft }: { token: string; clientId: string; draft: MarketplaceAllocationDraft }) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof fetchAllocationCatalog>> | null>(null);
  const [source, setSource] = useState('');
  const [wb, setWb] = useState(''), [ozon, setOzon] = useState('');
  const [wbSearch, setWbSearch] = useState(''), [ozonSearch, setOzonSearch] = useState('');
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    ++generation.current; setCatalog(null); setSource(''); setWb(''); setOzon(''); setConfirmed(false); setMessage(''); setError(''); setBusy(false);
    return () => { ++generation.current; };
  }, [token, clientId, draft.wbConnectionId, draft.ozonConnectionId]);
  async function load() {
    const id = ++generation.current; setBusy(true); setError(''); setConfirmed(false); setMessage('');
    try { const result = await fetchAllocationCatalog(token, clientId, draft); if (id === generation.current) { setCatalog(result); setSource(''); setWb(''); setOzon(''); } }
    catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : 'Не удалось прочитать каталоги.'); }
    finally { if (id === generation.current) setBusy(false); }
  }
  const existing = catalog?.bindings.find(b => b.sourceBarcode === source.trim());
  function chooseSource(text: string) {
    setSource(text); setConfirmed(false); setMessage('');
    const binding = catalog?.bindings.find(b => b.sourceBarcode === text.trim() && b.wbConnectionId === draft.wbConnectionId && b.ozonConnectionId === draft.ozonConnectionId);
    const { wb: w, ozon: o } = suggestAllocationPairs(text.trim(), catalog?.wb ?? [], catalog?.ozon ?? []);
    setWb(binding?.wb.productId ?? (w.length === 1 ? w[0].productId : ''));
    setOzon(binding?.ozon.productId ?? (o.length === 1 ? o[0].productId : ''));
  }
  async function save() {
    if (!confirmed || busy) return;
    const id = generation.current; setBusy(true); setError(''); setMessage('');
    try {
      const binding = await confirmAllocationBinding(token, clientId, { draft, sourceBarcode: source.trim(), wbProductId: wb,
        ozonProductId: ozon, confirmed: true, revision: existing?.revision ?? null });
      if (id !== generation.current) return;
      setCatalog(current => current && { ...current, bindings: [...current.bindings.filter(b => b.sourceBarcode !== binding.sourceBarcode), binding] });
      setConfirmed(false); setMessage('Соответствие сохранено. Остатки на площадки не отправлялись.');
    } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : 'Не удалось сохранить соответствие.'); }
    finally { if (id === generation.current) setBusy(false); }
  }
  const select = (label: string, rows: MarketplaceAllocationProduct[], query: string, setQuery: (q: string) => void, value: string, setValue: (v: string) => void) => <label>
    {label}<input placeholder="Поиск по названию, артикулу, ШК" value={query} onChange={e => setQuery(e.target.value)} />
    <select value={value} onChange={e => { setValue(e.target.value); setConfirmed(false); setMessage(''); }}>
      <option value="">Выберите карточку</option>{allocationProductChoices(rows, query, value).map(p => <option key={p.productId} value={p.productId}>{p.name} · {p.article || p.offerId} · {p.size} · {p.color} · {p.barcodes.join(', ')}</option>)}
    </select>
  </label>;
  return <section><h4>Соответствия товаров WB/Ozon</h4>
    <p>Предложения по точному ШК нужно подтвердить. Если совпадения нет или карточек несколько, выберите их вручную и проверьте размер.</p>
    <button type="button" disabled={busy || !draft.wbConnectionId || !draft.ozonConnectionId} onClick={() => void load()}>{busy ? 'Обработка…' : 'Прочитать каталоги WB и Ozon'}</button>
    {catalog && <fieldset disabled={busy} style={{ display: 'grid', gap: 12 }}><legend>Пара карточек</legend>
      <label>Исходный ШК на складе<input value={source} onChange={e => chooseSource(e.target.value)} /></label>
      {select('Карточка WB', catalog.wb, wbSearch, setWbSearch, wb, setWb)}
      {select('Карточка Ozon', catalog.ozon, ozonSearch, setOzonSearch, ozon, setOzon)}
      <small>В списках показано до 100 совпадений. Уточните поиск для остальных.</small>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Подтверждаю соответствие исходного товара обеим карточкам, включая размер и цвет</label>
      <button type="button" disabled={!source.trim() || !wb || !ozon || !confirmed} onClick={() => void save()}>Сохранить соответствие</button>
      <p>Сохранённых соответствий: {catalog.bindings.filter((b: MarketplaceAllocationBinding) => b.wbConnectionId === draft.wbConnectionId && b.ozonConnectionId === draft.ozonConnectionId).length}</p>
    </fieldset>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
