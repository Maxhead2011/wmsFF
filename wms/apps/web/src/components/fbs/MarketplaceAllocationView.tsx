import { useEffect, useRef, useState } from 'react';
import { MarketplaceAllocationBindings } from './MarketplaceAllocationBindings';
import { fetchMarketplaceAllocation, previewMarketplaceAllocation, saveMarketplaceAllocation,
  type AuthSession, type MarketplaceAllocationDraft, type MarketplaceAllocationPreview, type MarketplaceAllocationSettings } from '../../lib/api';

export function MarketplaceAllocationView({ session, clientId }: { session: AuthSession; clientId: string }) {
  const [data, setData] = useState<MarketplaceAllocationSettings | null>(null);
  const [draft, setDraft] = useState<MarketplaceAllocationDraft>({ wbConnectionId: '', ozonConnectionId: '', wbPercent: 50 });
  const [preview, setPreview] = useState<MarketplaceAllocationPreview | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current;
    setData(null); setPreview(null); setError(''); setMessage(''); setBusy(true);
    void fetchMarketplaceAllocation(session.accessToken, clientId).then(result => {
      if (id !== generation.current) return;
      setData(result);
      const wb = result.connections.filter(c => c.marketplace === 'WILDBERRIES');
      const ozon = result.connections.filter(c => c.marketplace === 'OZON');
      setDraft(result.draft ?? { wbConnectionId: wb.length === 1 ? wb[0].id : '', ozonConnectionId: ozon.length === 1 ? ozon[0].id : '', wbPercent: 50 });
    }).catch(e => { if (id === generation.current) setError(e.message); })
      .finally(() => { if (id === generation.current) setBusy(false); });
    return () => { ++generation.current; };
  }, [session.accessToken, clientId, reload]);
  function change(patch: Partial<MarketplaceAllocationDraft>) { setDraft(current => ({ ...current, ...patch })); setPreview(null); setMessage(''); }
  async function run(kind: 'save' | 'preview', page = 1) {
    if (busy || !data) return;
    const id = generation.current;
    setBusy(true); setError(''); setMessage('');
    if (kind === 'preview') setPreview(null);
    try {
      if (kind === 'save') {
        const saved = await saveMarketplaceAllocation(session.accessToken, clientId, draft, data.revision);
        if (id !== generation.current) return;
        setData(current => current && { ...current, revision: saved.revision, draft: saved.draft });
        setMessage('Доли сохранены как настройки. Остатки на маркетплейсы не отправлялись.');
      } else {
        const result = await previewMarketplaceAllocation(session.accessToken, clientId, draft, search, page);
        if (id === generation.current) setPreview(result);
      }
    } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : 'Ошибка операции.'); }
    finally { if (id === generation.current) setBusy(false); }
  }
  const valid = Number.isInteger(draft.wbPercent) && draft.wbPercent >= 0 && draft.wbPercent <= 100 && draft.wbConnectionId && draft.ozonConnectionId;
  return <section className="fbs-allocation">
    <h3>Между Wildberries и Ozon</h3>
    {error && <p role="alert">{error} <button type="button" onClick={() => setReload(v => v + 1)} disabled={busy}>Обновить настройки</button></p>}
    {!data ? <p>{busy ? 'Загрузка подключений…' : 'Настройки не загружены.'}</p> : !data.available ? <p>{data.message}</p> : <>
      <p>Настройка долей и предпросмотр. Автоматическая отправка между площадками ещё не включена.</p>
      {data.invalidated && <p role="alert">Сохранённый кабинет отключён. Выберите актуальные подключения.</p>}
      <fieldset disabled={busy} style={{ display: 'grid', gap: 12 }}>
        <legend>Кабинеты и доли</legend>
        {(['WILDBERRIES', 'OZON'] as const).map(marketplace => {
          const field = marketplace === 'WILDBERRIES' ? 'wbConnectionId' : 'ozonConnectionId';
          return <label key={marketplace}>Кабинет {marketplace === 'WILDBERRIES' ? 'Wildberries' : 'Ozon'} <select value={draft[field]} onChange={e => change({ [field]: e.target.value })}>
            <option value="">Выберите кабинет</option>{data.connections.filter(c => c.marketplace === marketplace).map((c, i) => <option key={c.id} value={c.id}>{c.accountName || `Кабинет ${i + 1}`}</option>)}
          </select></label>;
        })}
        <label>Доля Wildberries, % <input type="number" min={0} max={100} step={1} value={Number.isNaN(draft.wbPercent) ? '' : draft.wbPercent}
          onChange={e => change({ wbPercent: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
        <p>Доля Ozon: {Number.isFinite(draft.wbPercent) ? 100 - draft.wbPercent : '—'}%</p>
        <button type="button" onClick={() => change({ wbPercent: 50 })}>Поровну — 50/50</button>
        <small>Распределяется свободный остаток после резервов. При равном дробном остатке лишняя единица относится к WB.</small>
        <button type="button" disabled={!valid} onClick={() => void run('save')}>Сохранить доли</button>
        <label>Поиск ШК для предпросмотра <input value={search} onChange={e => { setSearch(e.target.value); setPreview(null); }} /></label>
        <button type="button" disabled={!valid} onClick={() => void run('preview')}>Рассчитать предпросмотр</button>
      </fieldset>
      {valid && <MarketplaceAllocationBindings token={session.accessToken} clientId={clientId} draft={draft} />}
      {preview && <><p>Расчёт на {new Date(preview.generatedAt).toLocaleString('ru-RU')}. Строк: {preview.totalRows}. Это расчёт долей, не подтверждение сопоставления карточек и отправки.</p>
        {preview.missingBarcodeCount > 0 && <p>Без основного ШК: {preview.missingBarcodeCount}. Эти позиции не включены.</p>}
        <div className="fbs-allocation__table-wrap"><table><thead><tr><th>ШК</th><th>Остаток</th><th>Резерв</th><th>Доступно</th><th>WB</th><th>Ozon</th></tr></thead>
          <tbody>{preview.rows.map(row => <tr key={row.barcode}><td>{row.barcode}</td><td>{row.total}</td><td>{row.reserved}</td><td>{row.available}</td><td>{row.wb}</td><td>{row.ozon}</td></tr>)}</tbody></table></div>
        <button disabled={busy || preview.page <= 1} onClick={() => void run('preview', preview.page - 1)}>Назад</button>
        <span> Страница {preview.page} </span><button disabled={busy || preview.page * preview.pageSize >= preview.totalRows} onClick={() => void run('preview', preview.page + 1)}>Далее</button>
      </>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
