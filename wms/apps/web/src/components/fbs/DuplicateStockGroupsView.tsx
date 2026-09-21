import { useEffect, useRef, useState } from 'react';
import './DuplicateStockGroupsView.css';
import { DuplicateArticlePicker } from './DuplicateArticlePicker';
import { applyDuplicateGroup, fetchDuplicateGroups, fetchDuplicateCatalog, saveDuplicateGroup, previewDuplicateGroup, type AuthSession } from '../../lib/api';
import { duplicateGroupReady, effectiveDuplicateShares, matchesRelabelArticle, suggestDuplicateTarget, withDuplicateException, type DuplicateCard, type DuplicateGroup, type DuplicateMapping, type DuplicatePreview, type DuplicateSettings } from '../../lib/duplicateStockGroups';

const label = (card?: DuplicateCard) => card ? [card.article || card.name, card.size, card.color, card.barcodes[0]?.value].filter(Boolean).join(' · ') : 'Карточка недоступна';
export function DuplicateStockGroupsView({ session, clientId }: { session: AuthSession; clientId: string }) {
  const [data, setData] = useState<DuplicateSettings | null>(null), [group, setGroup] = useState<DuplicateGroup | null>(null);
  const [cards, setCards] = useState<DuplicateCard[]>([]), [preview, setPreview] = useState<DuplicatePreview | null>(null);
  const [sourceArticle, setSourceArticle] = useState(''), [targetArticle, setTargetArticle] = useState('');
  const [mappingId, setMappingId] = useState(''), [search, setSearch] = useState(''), [individual, setIndividual] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const generation = useRef(0), [reload, setReload] = useState(0);
  useEffect(() => {
    const id = ++generation.current; setData(null); setGroup(null); setPreview(null); setCards([]); setSourceArticle(''); setTargetArticle(''); setMappingId(''); setBusy(true); setError(''); setMessage('');
    fetchDuplicateGroups(session.accessToken, clientId).then(r => { if (id === generation.current) setData(r); })
      .catch(e => { if (id === generation.current) setError(e instanceof Error ? e.message : 'Не удалось загрузить группы.'); })
      .finally(() => { if (id === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [clientId, session.accessToken, reload]);
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    const id = generation.current;
    try { await action(); } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.'); }
    finally { if (id === generation.current) setBusy(false); }
  }
  function change(next: DuplicateGroup) { setGroup(next); setPreview(null); setMessage(''); }
  async function articleCards(article: string, source = false) {
    const rows: DuplicateCard[] = [];
    for (let page = 1; page <= 12; page++) {
      const r = await fetchDuplicateCatalog(session.accessToken, clientId, { search: article, page }); rows.push(...r.rows);
      if (!r.hasMore) return rows.filter(c => matchesRelabelArticle(c, article, source));
    }
    throw new Error('Слишком много совпадений. Уточните артикул в меню «Переклейка».');
  }
  async function addMapping(mapping: DuplicateMapping, append = false) {
    const id = generation.current;
    const [sources, targets] = await Promise.all([articleCards(mapping.sourceArticle, true), articleCards(mapping.targetArticle)]);
    if (id !== generation.current) return;
    if (!sources.length || sources.length > 100 || !targets.length) throw new Error('Не найдены карточки обоих артикулов либо исходных вариантов больше 100. Проверьте синхронизацию карточек.');
    if (append && group && !group.variants.every(v => sources.some(s => s.id === v.sourceSkuId))) throw new Error('Дополнительный дубль должен использовать те же исходные товары.');
    const key = 'duplicate-' + mapping.id;
    if (append && group?.shares.some(s => s.targetKey === key)) throw new Error('Этот дубль уже добавлен.');
    setCards(old => [...new Map([...old, ...sources, ...targets].map(c => [c.id, c])).values()]);
    if (append && group) {
      change({ ...group, shares: [...group.shares, { targetKey: key, label: mapping.targetArticle, percent: 0 }],
        variants: group.variants.map(v => ({ ...v, targets: [...v.targets, { targetKey: key, ...suggestDuplicateTarget(sources.find(s => s.id === v.sourceSkuId)!, targets) }] })),
        overrides: group.overrides.map(o => ({ ...o, shares: [...o.shares, { targetKey: key, percent: 0 }] })) });
    } else {
      setIndividual(false);
      change({ id: crypto.randomUUID(), name: mapping.sourceArticle, connectionId: data?.connections[0]?.id ?? '', reserve: { mode: 'COMMON', value: 0 },
        shares: [{ targetKey: 'original', label: mapping.sourceArticle, percent: 50 }, { targetKey: key, label: mapping.targetArticle, percent: 50 }],
        variants: sources.map(s => ({ sourceSkuId: s.id, targets: [{ targetKey: 'original', targetId: s.id, confirmed: true, requiresRelabel: false },
          { targetKey: key, ...suggestDuplicateTarget(s, targets) }] })), overrides: [] });
    }
  }
  async function edit(selected: DuplicateGroup) {
    const id = generation.current;
    const ids = [...new Set(selected.variants.flatMap(v => [v.sourceSkuId, ...v.targets.map(t => t.targetId)]))];
    const result = await fetchDuplicateCatalog(session.accessToken, clientId, { ids });
    const alternatives = await Promise.all(selected.shares.filter(s => s.targetKey !== 'original').map(s => articleCards(s.label)));
    if (id !== generation.current) return;
    setCards([...new Map([...result.rows, ...alternatives.flat()].map(c => [c.id, c])).values()]); setIndividual(selected.overrides.length > 0); change(structuredClone(selected));
  }
  async function persist(deleteId?: string) {
    if (!data || (!group && !deleteId)) return;
    const id = generation.current;
    const result = await saveDuplicateGroup(session.accessToken, clientId, { ...(deleteId ? { deleteId } : { group: group! }), revision: data.revision });
    if (id !== generation.current) return;
    setData({ ...data, groups: result.groups, revision: result.revision });
    if (deleteId) { setGroup(null); setPreview(null); }
    setMessage(deleteId ? 'Группа удалена.' : 'Правило сохранено. Отправка остатков не включена.');
  }
  const active = Boolean(group && data?.activeGroupIds.includes(group.id));
  async function apply() {
    if (!data || !group || !preview) return;
    const id = generation.current;
    const result = await applyDuplicateGroup(session.accessToken, clientId, { group, revision: data.revision, previewKey: preview.previewKey });
    if (id !== generation.current) return;
    setData({ ...data, groups: result.groups, revision: result.revision, activeGroupIds: result.activeGroupIds });
    setPreview(null);
    setMessage('Правило применено. Остатки поставлены в очередь пересчёта и проверки WB. Подтверждение отправки смотрите в разделе «Подтверждение WB».');
  }
  const selectedMapping = data?.mappings.find(m => m.id === mappingId);
  return <section className="fbs-allocation duplicate-stock">
    <h3>Между артикулами</h3>
    <p>Выберите исходный артикул и дубль, задайте доли и проверьте расчёт. Соответствие для сборки появится в «Переклейке» при применении. Резерв вычитается один раз до распределения.</p>
    <p><strong>Настройка и предпросмотр.</strong> {data?.activeGroupIds.length ? 'Отмеченные группы участвуют в автоматической отправке WB. Остальные группы — черновики.' : 'Автоматическая отправка групп ещё не включена.'}</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button disabled={busy} onClick={() => { if (!group || window.confirm('Обновить список? Несохранённые изменения будут потеряны.')) setReload(n => n + 1); }}>Обновить список</button>
    {!data ? <p>{busy ? 'Загрузка групп…' : 'Не удалось загрузить группы.'}</p> : <>
      {!data.relabelingEnabled && <p role="alert">У клиента выключена переклейка. Включите её перед настройкой групп.</p>}
      <label>Поиск групп <input value={search} onChange={e => setSearch(e.target.value)} /></label>
      <ul>{data.groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase())).map(g => <li key={g.id}>
        <button disabled={busy} onClick={() => { if (!group || window.confirm('Открыть другую группу без сохранения текущих изменений?')) void run(() => edit(g)); }}>{g.name} · Настроить</button>
        {' — '}{g.variants.length} размеров/вариантов · {g.shares.map(s => `${s.percent}%`).join(' / ')}
        {data.activeGroupIds.includes(g.id) && <strong> · Автораспределение включено</strong>}
      </li>)}</ul>
      {!data.groups.length && <p>Сохранённых групп пока нет.</p>}
      {data.selfServiceEnabled && <section className="duplicate-stock__new"><h4>Новое распределение</h4><p>1. Выберите два артикула клиента. На следующем шаге подтвердите соответствия размеров.</p>
        <div className="duplicate-stock__pair">
          <DuplicateArticlePicker title="Исходный артикул" accessToken={session.accessToken} clientId={clientId} value={sourceArticle} onChange={setSourceArticle} disabled={busy || !data.relabelingEnabled} />
          <DuplicateArticlePicker title="Артикул дубля" accessToken={session.accessToken} clientId={clientId} value={targetArticle} onChange={setTargetArticle} disabled={busy || !data.relabelingEnabled} />
        </div>
        <button disabled={busy || !data.relabelingEnabled || !sourceArticle || !targetArticle || sourceArticle === targetArticle} onClick={() => {
          if (!group || window.confirm('Перейти к новой паре? Несохранённые изменения текущей группы будут потеряны.')) void run(() => addMapping({ id: 'selected', sourceArticle, targetArticle }));
        }}>Настроить доли и размеры</button>
      </section>}
      <details><summary>Использовать готовое соответствие из «Переклейки»</summary>
      <fieldset disabled={busy || !data.relabelingEnabled}><legend>Соответствия из «Переклейки»</legend>
        <select aria-label="Соответствие переклейки" value={mappingId} onChange={e => setMappingId(e.target.value)}><option value="">Выберите исходный артикул → дубль</option>
          {data.mappings.map(m => <option key={m.id} value={m.id}>{m.sourceArticle} → {m.targetArticle}</option>)}
        </select>
        <button disabled={!selectedMapping} onClick={() => { if (selectedMapping && (!group || window.confirm('Создать новую группу без сохранения текущих изменений?'))) void run(() => addMapping(selectedMapping)); }}>Создать группу</button>
        {group && <button disabled={active || !selectedMapping || group.shares.length >= 6} onClick={() => selectedMapping && void run(() => addMapping(selectedMapping, true))}>Добавить ещё дубль</button>}
        {!data.mappings.length && <p>Сначала добавьте соответствия артикулов в меню «Переклейка».</p>}
      </fieldset></details>
    </>}
    {group && <fieldset disabled={busy}><legend>2. Доли и соответствия размеров</legend>
      <label>Название группы <input value={group.name} onChange={e => change({ ...group, name: e.target.value })} /></label>
      <label>Кабинет WB <select disabled={active} value={group.connectionId} onChange={e => change({ ...group, connectionId: e.target.value })}><option value="">Выберите кабинет</option>
        {data?.connections.map(c => <option key={c.id} value={c.id}>{c.accountName || c.id}{!c.fbsExecutionWarehouseId ? ' — склад не задан' : ''}</option>)}</select></label>
      <h4>Общие доли для каждого размера</h4>
      {group.shares.map(s => <label key={s.targetKey}>{s.label}, % <input type="number" min="0" max="100" step="1" value={Number.isFinite(s.percent) ? s.percent : ''}
        onChange={e => change({ ...group, shares: group.shares.map(x => x.targetKey === s.targetKey ? { ...x, percent: e.target.value === '' ? NaN : Number(e.target.value) } : x) })} /></label>)}
      <p>Сумма долей: {group.shares.reduce((sum, s) => sum + (s.percent || 0), 0)}%. Должно быть 100%.</p>
      <button onClick={() => change({ ...group, shares: group.shares.map((s, i) => ({ ...s, percent: Math.floor(100 / group.shares.length) + (i < 100 % group.shares.length ? 1 : 0) })) })}>Поровну</button>
      <label>Страховой резерв <select value={group.reserve.mode} onChange={e => change({ ...group, reserve: { mode: e.target.value as 'COMMON' | 'UNITS' | 'PERCENT', value: 0 } })}><option value="COMMON">Из общих настроек клиента</option><option value="UNITS">В штуках</option><option value="PERCENT">В процентах</option></select>
        <input disabled={group.reserve.mode === 'COMMON'} aria-label="Величина страхового резерва" type="number" min="0" max={group.reserve.mode === 'PERCENT' ? 100 : 1_000_000} step="1" value={Number.isFinite(group.reserve.value) ? group.reserve.value : ''}
          onChange={e => change({ ...group, reserve: { ...group.reserve, value: e.target.value === '' ? NaN : Number(e.target.value) } })} /></label>
      <p>Один резерв на исходный размер/цвет, до долей WB/Ozon и дублей. Процент округляется вверх.</p>
      {group.reserve.mode === 'COMMON' && data && <p>Общий резерв: {data.commonReserve.value}{data.commonReserve.mode === 'PERCENT' ? '%' : ' шт.'}{data.commonReserve.lowStock && `; при остатке меньше ${data.commonReserve.lowStock.threshold} — ${data.commonReserve.lowStock.reserveUnits} шт.`}. Изменения общих настроек применяются автоматически.</p>}
      <label><input type="checkbox" checked={individual} onChange={e => { const on = e.target.checked; if (!on && group.overrides.length && !window.confirm('Удалить исключения и вернуть общие доли всем размерам?')) return; setIndividual(on); if (!on) change({ ...group, overrides: [] }); }} /> Индивидуальное распределение по размерам</label>
      {group.variants.map(v => {
        const source = cards.find(c => c.id === v.sourceSkuId), override = group.overrides.find(o => o.sourceSkuId === v.sourceSkuId);
        return <fieldset key={v.sourceSkuId}><legend>{label(source)}</legend>
          {v.targets.filter(t => t.targetId !== v.sourceSkuId).map(t => {
            const selected = cards.find(c => c.id === t.targetId), slot = group.shares.find(s => s.targetKey === t.targetKey)!;
            const options = cards.filter(c => c.id === t.targetId || (matchesRelabelArticle(c, slot.label) && c.size?.trim().toLowerCase() === source?.size?.trim().toLowerCase()));
            return <div key={t.targetKey}><label>Целевая карточка: {slot.label} <select disabled={active} value={t.targetId} onChange={e => change({ ...group, variants: group.variants.map(x => x.sourceSkuId === v.sourceSkuId ? { ...x, targets: x.targets.map(y => y.targetKey === t.targetKey ? { ...y, targetId: e.target.value, confirmed: false } : y) } : x) })}>
              <option value="">Укажите соответствие</option>{options.map(c => <option value={c.id} key={c.id}>{label(c)}</option>)}</select></label>
              <label><input type="checkbox" checked={t.confirmed} disabled={active || !selected} onChange={e => change({ ...group, variants: group.variants.map(x => x.sourceSkuId === v.sourceSkuId ? { ...x, targets: x.targets.map(y => y.targetKey === t.targetKey ? { ...y, confirmed: e.target.checked } : y) } : x) })} /> Подтверждаю соответствие и переклейку на {selected?.barcodes[0]?.value || 'целевой ШК'}</label>
            </div>;
          })}
          {individual && <label><input type="checkbox" checked={Boolean(override)} onChange={e => change(withDuplicateException(group, v.sourceSkuId, e.target.checked))} /> Отдельные доли для этого размера</label>}
          {override ? override.shares.map(s => <label key={s.targetKey}>{group.shares.find(x => x.targetKey === s.targetKey)?.label}, % <input type="number" min="0" max="100" value={Number.isFinite(s.percent) ? s.percent : ''} onChange={e => change({ ...group, overrides: group.overrides.map(o => o.sourceSkuId === v.sourceSkuId ? { ...o, shares: o.shares.map(x => x.targetKey === s.targetKey ? { ...x, percent: e.target.value === '' ? NaN : Number(e.target.value) } : x) } : o) })} /></label>)
            : <small>Общие доли: {effectiveDuplicateShares(group, v.sourceSkuId).map(s => s.percent + '%').join(' / ')}</small>}
          <button disabled={active} onClick={() => change({ ...group, variants: group.variants.filter(x => x.sourceSkuId !== v.sourceSkuId), overrides: group.overrides.filter(o => o.sourceSkuId !== v.sourceSkuId) })}>Исключить размер из группы</button>
        </fieldset>;
      })}
      <button disabled={!duplicateGroupReady(group) || data?.activeGroupIds.includes(group.id)} onClick={() => void run(() => persist())}>Сохранить черновик</button>
      <button disabled={!duplicateGroupReady(group)} onClick={() => void run(async () => { const id = generation.current; const result = await previewDuplicateGroup(session.accessToken, clientId, group); if (id === generation.current) setPreview(result); })}>Рассчитать предпросмотр</button>
      {data?.groups.some(g => g.id === group.id) && <button disabled={data.activeGroupIds.includes(group.id)} onClick={() => { if (window.confirm('Удалить сохранённую группу? Действующие настройки WB не изменятся.')) void run(() => persist(group.id)); }}>Удалить группу</button>}
      {active && <p>Группа действует: можно менять общие проценты и исключения по размерам. Состав пары закреплён за текущими сборками.</p>}
      {data?.selfServiceEnabled && <button className="duplicate-stock__apply" disabled={!duplicateGroupReady(group) || !preview} onClick={() => {
        if (window.confirm('Применить показанное правило? Система сохранит соответствия переклейки и пересчитает остатки WB.')) void run(apply);
      }}>Сохранить и применить в WB</button>}
      {!preview && data?.selfServiceEnabled && <p>Перед применением нажмите «Рассчитать предпросмотр». После изменения настроек расчёт нужно повторить.</p>}
      {!duplicateGroupReady(group) && <p>Проверьте доли, резерв и подтвердите все соответствия размеров.</p>}
    </fieldset>}
    {preview && <section><h4>3. Предпросмотр на {new Date(preview.generatedAt).toLocaleString('ru-RU')}</h4>
      {preview.pickingWarnings.map(w => <p role="alert" key={w.sourceSkuId + ':' + w.targetSkuId}>{w.message}</p>)}
      <p>Доля WB: {preview.wbPercent}%. Из общего пула: {preview.totalAllocated} шт., из них с переклейкой: {preview.totalRelabel} шт.</p>
      {preview.publications.some(p => !p.enabled || p.saleLimit !== null || p.relabelManualAmount !== null) && <p role="alert">Есть действующие настройки публикации WB. Перед включением процентных правил потребуется согласовать их с новым распределением.</p>}
      {preview.missingMappings?.length > 0 && <p>При применении добавим в «Переклейку»: {preview.missingMappings.map(m => `${m.sourceArticle} → ${m.targetArticle}`).join("; ")}.</p>}
      <div className="fbs-allocation__table-wrap"><table><thead><tr><th>Исходный товар</th><th>Остаток AVAILABLE</th><th>Резерв заказов</th><th>Страховой резерв</th><th>К распределению</th><th>Карточка</th><th>Доля</th><th>Из общего пула</th><th>Свой остаток дубля</th></tr></thead>
        <tbody>{preview.rows.flatMap(r => r.targets.map(t => <tr key={r.sourceSkuId + t.targetKey}><td>{label(r.source)}</td><td>{r.total}</td><td>{r.reserved}</td><td>{r.safetyReserve}</td><td>{r.marketplaceBudget}</td><td>{label(t.card)}{t.requiresRelabel && ' · переклейка'}</td><td>{t.percent}%{r.individual && ' · исключение'}</td><td>{t.quantity}</td><td>{t.targetId === r.sourceSkuId ? '—' : t.ownStock ?? 'Нет данных'}</td></tr>))}</tbody></table></div>
      <p>Свой уже переклеенный остаток показан отдельно и не включён повторно в исходный пул. Это расчёт, а не отправленные на WB количества.</p>
    </section>}
  </section>;
}
