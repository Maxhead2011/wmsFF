import { useEffect, useState } from 'react';
import type { AuthSession } from '../../lib/api';
import { fetchFboProducts, fetchFboRegistry, fboPreview, saveFboTariff, type FboClient, type FboDefinition, type FboPart, type FboProduct, type FboRegistry } from '../../lib/fbo-processing-pricing-api';
import './fbo-processing-pricing.css';
const money = (value: string | null) => value === null ? 'Цена не задана' : `${Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
// FIX: existing compositions are visible and read-only; variants are never added together.
export function FboProcessingPricingPanel({ session }: {
    session: AuthSession;
}) {
    const [registry, setRegistry] = useState<FboRegistry | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0), [disabled, setDisabled] = useState(false), [selected, setSelected] = useState<FboClient | null>(null), [filter, setFilter] = useState('');
    useEffect(() => { const abort = new AbortController(); setLoading(true); setError(''); void fetchFboRegistry(session, abort.signal).then(data => { if (abort.signal.aborted)
        return; if (data.enabled) {
        setRegistry(data);
        setDisabled(false);
    }
    else
        setDisabled(true); }).catch(e => { if (!abort.signal.aborted)
        setError(e.message); }).finally(() => { if (!abort.signal.aborted)
        setLoading(false); }); return () => abort.abort(); }, [session.accessToken, revision]);
    const canWrite = session.user.permissionCodes.some(p => ['billing:write', 'system:admin'].includes(p));
    return <section className="fbo-pricing" aria-label="Первоначальная обработка FBO"><h2>Первоначальная обработка FBO</h2><p>Выберите выполняемые услуги — их стоимость составит цену обработки одной единицы. Отрезы и другие товары с разной ценой показываются отдельными вариантами.</p>
 {loading ? <p role="status">Загружаем условия клиентов…</p> : null}{error ? <p role="alert">{error} <button type="button" onClick={() => setRevision(n => n + 1)}>Повторить загрузку</button></p> : null}{disabled ? <p>Настройка первоначальной обработки пока не включена.</p> : null}
 {registry && !disabled ? <><label>Найти клиента<input value={filter} onChange={e => setFilter(e.target.value)}/></label><div className="fbo-pricing__scroll"><table><thead><tr><th>Клиент</th><th>Услуги и варианты</th><th>Стоимость за 1 ед.</th><th>Условия</th></tr></thead><tbody>{registry.clients.filter(c => `${c.name} ${c.code}`.toLocaleLowerCase('ru').includes(filter.toLocaleLowerCase('ru'))).map(client => <tr key={client.id}><td><strong>{client.name}</strong><br />{client.code}{client.status === 'ARCHIVED' ? <small> · Архивный</small> : null}</td><td>{client.tariff ? <><Composition parts={client.tariff.definition.common} services={registry.services}/>{client.tariff.definition.variants.map((v, i) => <p key={i}><strong>{v.name}</strong> · {v.skuIds.length} товаров<Composition parts={v.services} services={registry.services}/></p>)}</> : client.legacy.protected ? <><span>Действующие индивидуальные условия</span>{client.legacy.services.map(part => <p key={part.serviceId}><strong>{part.name}</strong>{part.matchKeywords ? <small> · товары: {part.matchKeywords}</small> : null}<br />{money(part.priceRub)} × {part.multiplier}{part.taxMode === 'ADD_6_PERCENT' ? ' · удержание 6%' : null}{!part.isActive ? ' · услуга выключена' : null}</p>)}{client.legacy.primaryFbs ? <small>Прежние цены FBS: белый {money(client.legacy.primaryFbs.white)}, серый {money(client.legacy.primaryFbs.gray)}, возврат {money(client.legacy.primaryFbs.returned)}</small> : null}</> : <span>Услуги не выбраны</span>}</td><td>{client.tariff ? <><p>Обычный товар: {client.tariff.definition.common.length ? money(fboPreview(client.tariff.definition.common)) : 'Только выбранные варианты'}</p>{client.tariff.definition.variants.map((v, i) => <p key={i}>{v.name}: <strong>{money(fboPreview([...client.tariff!.definition.common, ...v.services]))}</strong></p>)}</> : client.legacy.protected ? <>{client.legacy.services.map(part => <p key={part.serviceId}>{part.name}: {part.priceRub !== null && part.taxMode ? money(fboPreview([{ serviceId: part.serviceId, priceRub: part.priceRub, multiplier: part.multiplier, taxMode: part.taxMode }])) : 'Цена не задана'}</p>)}<small>Цены отдельных услуг; варианты отрезов не складываются между собой.</small></> : 'Не задана'}</td><td>{client.tariff || client.legacy.protected ? <span>Сохранены · просмотр</span> : canWrite && client.status !== 'ARCHIVED' ? <button type="button" onClick={() => setSelected(client)}>Настроить</button> : <span>Не настроены</span>}</td></tr>)}</tbody></table></div></> : null}
 {selected && registry ? <FboPricingForm key={selected.id} client={selected} registry={registry} session={session} onCancel={() => setSelected(null)} onSaved={tariff => { setRegistry(current => current ? { ...current, clients: current.clients.map(c => c.id === selected.id ? { ...c, tariff } : c) } : current); setSelected(null); }}/> : null}
 </section>;
}
function Composition({ parts, services }: {
    parts: FboPart[];
    services: FboRegistry['services'];
}) { return <ul>{parts.map(part => <li key={part.serviceId}>{services.find(s => s.id === part.serviceId)?.name ?? 'Услуга'}: {money(part.priceRub)} × {part.multiplier}{part.taxMode === 'ADD_6_PERCENT' ? ' · удержание 6%' : null}</li>)}</ul>; }
function FboPricingForm({ client, registry, session, onCancel, onSaved }: {
    client: FboClient;
    registry: FboRegistry;
    session: AuthSession;
    onCancel: () => void;
    onSaved: (tariff: NonNullable<FboClient['tariff']>) => void;
}) {
    const [definition, setDefinition] = useState<FboDefinition>({ common: [], variants: [] }), [error, setError] = useState(''), [saving, setSaving] = useState(false), [operationKey] = useState(() => crypto.randomUUID());
    const updateParts = (index: number, parts: FboPart[]) => setDefinition(d => index < 0 ? { ...d, common: parts } : { ...d, variants: d.variants.map((v, i) => i === index ? { ...v, services: parts } : v) });
    return <form className="fbo-pricing__form" onSubmit={e => { e.preventDefault(); setSaving(true); setError(''); void saveFboTariff(session, client.id, definition, operationKey).then(onSaved).catch(e => setError(e.message)).finally(() => setSaving(false)); }}><h3>Настройка: {client.name}</h3><p>Общие услуги выполняются для каждого товара. Вариант добавляет услуги только для выбранных товаров. Сохранённые условия применяются к будущей обработке; прежние начисления остаются прежними.</p><fieldset disabled={saving}><legend>Общие услуги на одну единицу</legend><ServicesEditor services={registry.services.filter(s => !definition.variants.some(v => v.services.some(p => p.serviceId === s.id)))} parts={definition.common} onChange={parts => updateParts(-1, parts)}/><p>Обычный товар: <strong>{money(fboPreview(definition.common))}</strong></p></fieldset>
 {definition.variants.map((variant, index) => <fieldset key={index} disabled={saving}><legend>Вариант {index + 1}</legend><label>Название, например «Отрез 3 м»<input required maxLength={120} value={variant.name} onChange={e => setDefinition(d => ({ ...d, variants: d.variants.map((v, i) => i === index ? { ...v, name: e.target.value } : v) }))}/></label><ProductPicker session={session} clientId={client.id} ids={variant.skuIds} unavailable={definition.variants.filter((_, i) => i !== index).flatMap(v => v.skuIds)} onChange={skuIds => setDefinition(d => ({ ...d, variants: d.variants.map((v, i) => i === index ? { ...v, skuIds } : v) }))}/><ServicesEditor services={registry.services.filter(s => !definition.common.some(p => p.serviceId === s.id))} parts={variant.services} onChange={parts => updateParts(index, parts)}/><p>{variant.name || 'Вариант'}: <strong>{money(fboPreview([...definition.common, ...variant.services]))} / ед.</strong></p><button type="button" onClick={() => setDefinition(d => ({ ...d, variants: d.variants.filter((_, i) => i !== index) }))}>Убрать вариант</button></fieldset>)}
 <button type="button" disabled={saving || definition.variants.length >= 50} onClick={() => setDefinition(d => ({ ...d, variants: [...d.variants, { name: '', skuIds: [], services: [] }] }))}>Добавить вариант товара / отреза</button><p>После сохранения условия доступны для просмотра. Проверьте выбранные услуги и товары перед сохранением.</p>{error ? <p role="alert">{error}</p> : null}<button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить условия клиента'}</button> <button type="button" disabled={saving} onClick={onCancel}>Отмена</button></form>;
}
function ServicesEditor({ services, parts, onChange }: {
    services: FboRegistry['services'];
    parts: FboPart[];
    onChange: (parts: FboPart[]) => void;
}) {
    const [search, setSearch] = useState('');
    const patch = (id: string, patch: Partial<FboPart>) => onChange(parts.map(p => p.serviceId === id ? { ...p, ...patch } : p));
    return <><label>Найти услугу<input value={search} onChange={e => setSearch(e.target.value)}/></label>{services.filter(s => s.name.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')) || parts.some(p => p.serviceId === s.id)).map(service => { const part = parts.find(p => p.serviceId === service.id); return <div className="fbo-pricing__service" key={service.id}><label><input type="checkbox" checked={Boolean(part)} onChange={e => onChange(e.target.checked ? [...parts, { serviceId: service.id, priceRub: service.defaultPriceRub ?? '', multiplier: '1', taxMode: 'INCLUDED' }] : parts.filter(p => p.serviceId !== service.id))}/>{service.name}</label>{part ? <div className="fbo-pricing__fields"><label>Стоимость услуги, ₽<input required inputMode="decimal" value={part.priceRub} onChange={e => patch(service.id, { priceRub: e.target.value })}/></label><label>Раз на 1 ед.<input required inputMode="decimal" value={part.multiplier} onChange={e => patch(service.id, { multiplier: e.target.value })}/></label><label>Налог<select value={part.taxMode} onChange={e => patch(service.id, { taxMode: e.target.value as FboPart['taxMode'] })}><option value="INCLUDED">Уже учтён</option><option value="ADD_6_PERCENT">Учесть удержание 6%</option></select></label></div> : null}</div>; })}</>;
}
function ProductPicker({ session, clientId, ids, unavailable, onChange }: {
    session: AuthSession;
    clientId: string;
    ids: string[];
    unavailable: string[];
    onChange: (ids: string[]) => void;
}) {
    const [search, setSearch] = useState(''), [products, setProducts] = useState<FboProduct[]>([]), [known, setKnown] = useState<Record<string, FboProduct>>({}), [error, setError] = useState(''), [loading, setLoading] = useState(false);
    useEffect(() => { const abort = new AbortController(); setLoading(true); setError(''); const timer = setTimeout(() => { void fetchFboProducts(session, clientId, search, abort.signal).then(data => { if (abort.signal.aborted)
        return; setProducts(data); setKnown(k => ({ ...k, ...Object.fromEntries(data.map(p => [p.id, p])) })); }).catch(e => { if (!abort.signal.aborted)
        setError(e.message); }).finally(() => { if (!abort.signal.aborted)
        setLoading(false); }); }, 250); return () => { clearTimeout(timer); abort.abort(); }; }, [session.accessToken, clientId, search]);
    return <div><label>Товары варианта — поиск по названию, артикулу или баркоду<input maxLength={120} value={search} onChange={e => setSearch(e.target.value)}/></label>{loading ? <p role="status">Ищем товары…</p> : null}{error ? <p role="alert">{error}</p> : null}<p>Выбрано товаров: {ids.length}</p>{ids.map(id => <p key={id}>{known[id]?.name ?? id} <button type="button" onClick={() => onChange(ids.filter(value => value !== id))}>Убрать товар</button></p>)}<div className="fbo-pricing__products">{products.map(product => <label key={product.id}><input type="checkbox" checked={ids.includes(product.id)} disabled={unavailable.includes(product.id)} onChange={e => onChange(e.target.checked ? [...ids, product.id] : ids.filter(id => id !== product.id))}/>{product.name} · {product.size} · {product.barcodes.map(b => b.value).join(', ')}{unavailable.includes(product.id) ? ' · выбран в другом варианте' : ''}</label>)}</div><small>Показаны первые 30 результатов. Уточните поиск, чтобы найти остальные товары.</small></div>;
}
