import {
  ArrowLeftRight,
  Boxes,
  ChevronDown,
  ChevronRight,
  Eraser,
  MapPin,
  PackagePlus,
  Search,
  Trash2,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  addStoragePalletBox,
  createStoragePallet,
  createStorageZone,
  clearStoragePallet,
  deleteStoragePallet,
  deleteStoragePallets,
  fetchClients,
  fetchStorageLayout,
  removeStoragePalletBox,
  relocateStoragePalletBox,
  updateStoragePallet,
  type AuthSession,
  type ClientSummary,
  type StorageLayout,
} from '../../lib/api';
import './warehouse.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
import {
  allVisiblePalletsSelected,
  prunePalletSelection,
  selectVisiblePallets,
  togglePalletSelection,
} from './storagePalletBulkSelection';

type LoadState = {
  loading: boolean;
  data: StorageLayout | null;
  error: string;
};

type RelocateBoxState = {
  placementId: string;
  boxCode: string;
  sourcePalletId: string;
  sourcePalletCode: string;
  clientId: string;
  targetPalletId: string;
  swapBoxCode: string;
};

export function StorageZonesPanel({ session }: { session: AuthSession }) {
  const [state, setState] = useState<LoadState>({ loading: true, data: null, error: '' });
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [query, setQuery] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [palletCode, setPalletCode] = useState('');
  const [palletZoneId, setPalletZoneId] = useState('');
  const [boxDrafts, setBoxDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [relocateBox, setRelocateBox] = useState<RelocateBoxState | null>(null);
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [selectedPalletIds, setSelectedPalletIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  async function load(sync = true) {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const data = await fetchStorageLayout(session.accessToken, {
        warehouseId: session.user.activeWarehouseId || undefined,
        sync,
      });
      setState({ loading: false, data, error: '' });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: errorText(error) }));
    }
  }

  useEffect(() => {
    void Promise.all([load(), fetchClients(session.accessToken)])
      .then(([, loadedClients]) => {
        const active = loadedClients.filter((client) => client.status === 'ACTIVE');
        setClients(active);
        const lukin = active.find((client) => /лукин/i.test(`${client.name} ${client.legalName ?? ''}`));
        setClientId((current) => validRememberedClientId(current, active, lukin?.id));
      })
      .catch((error) => setState((current) => ({ ...current, error: errorText(error), loading: false })));
  }, [session.accessToken, session.user.activeWarehouseId]);

  useEffect(() => {
    setBulkDeleteMode(false);
    setSelectedPalletIds(new Set());
    setBulkDeleteConfirmOpen(false);
  }, [session.accessToken, session.user.activeWarehouseId]);

  useEffect(() => {
    if (!state.data) return;
    setSelectedPalletIds((current) => prunePalletSelection(current, state.data?.pallets ?? []));
  }, [state.data?.pallets]);

  const visiblePallets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    const pallets = state.data?.pallets ?? [];
    if (!normalized) {
      return pallets;
    }
    return pallets.filter(
      (pallet) =>
        pallet.code.toLocaleLowerCase('ru-RU').includes(normalized) ||
        pallet.client.name.toLocaleLowerCase('ru-RU').includes(normalized) ||
        pallet.zone?.name.toLocaleLowerCase('ru-RU').includes(normalized) ||
        pallet.boxes.some((box) => box.boxCode.toLocaleLowerCase('ru-RU').includes(normalized)),
    );
  }, [query, state.data?.pallets]);

  const allVisibleSelected = allVisiblePalletsSelected(selectedPalletIds, visiblePallets);
  const selectedPallets = useMemo(
    () => (state.data?.pallets ?? []).filter((pallet) => selectedPalletIds.has(pallet.id)),
    [selectedPalletIds, state.data?.pallets],
  );
  const selectedBoxCount = useMemo(
    () => selectedPallets.reduce((total, pallet) => total + pallet.boxes.length, 0),
    [selectedPallets],
  );

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    setNotice('');
    try {
      await action();
      setNotice(success);
      await load(false);
    } catch (error) {
      setState((current) => ({ ...current, error: errorText(error) }));
    } finally {
      setBusy('');
    }
  }

  async function submitZone(event: FormEvent) {
    event.preventDefault();
    const warehouseId = state.data?.warehouse.id;
    if (!warehouseId || !zoneName.trim()) return;
    await run(
      'zone',
      () => createStorageZone(session.accessToken, { warehouseId, name: zoneName.trim() }),
      `Зона «${zoneName.trim()}» создана.`,
    );
    setZoneName('');
  }

  async function submitPallet(event: FormEvent) {
    event.preventDefault();
    const warehouseId = state.data?.warehouse.id;
    if (!warehouseId || !clientId || !palletCode.trim()) return;
    const code = palletCode.trim();
    await run(
      'pallet',
      () =>
        createStoragePallet(session.accessToken, {
          warehouseId,
          clientId,
          code,
          zoneId: palletZoneId || undefined,
        }),
      `Паллета ${code} добавлена.`,
    );
    setPalletCode('');
  }

  async function submitBox(palletId: string) {
    const code = boxDrafts[palletId]?.trim();
    if (!code) return;
    await run(
      `box:${palletId}`,
      () => addStoragePalletBox(session.accessToken, palletId, code),
      `Короб ${code.toUpperCase()} размещён.`,
    );
    setBoxDrafts((current) => ({ ...current, [palletId]: '' }));
  }

  async function deletePallet(pallet: StorageLayout['pallets'][number]) {
    const placementNotice = pallet.boxes.length > 0
      ? ` С паллеты будет снято коробов: ${pallet.boxes.length}.`
      : '';
    if (!window.confirm(
      `Удалить паллет-сорт ${pallet.code}?${placementNotice} Короба, товары и складские остатки останутся в WMS.`,
    )) {
      return;
    }
    setBusy(`delete-pallet:${pallet.id}`);
    setNotice('');
    try {
      const result = await deleteStoragePallet(session.accessToken, pallet.id);
      setNotice(
        result.detachedBoxCount > 0
          ? `Паллет-сорт ${pallet.code} удалён. Коробов отвязано: ${result.detachedBoxCount}.`
          : `Паллет-сорт ${pallet.code} удалён.`,
      );
      await load(false);
    } catch (error) {
      setState((current) => ({ ...current, error: errorText(error) }));
    } finally {
      setBusy('');
    }
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(pallet.id);
      return next;
    });
  }

  async function clearPallet(pallet: StorageLayout['pallets'][number]) {
    if (pallet.boxes.length === 0) return;
    if (!window.confirm(
      `Очистить паллет-сорт ${pallet.code}? Все ${pallet.boxes.length} коробов будут отвязаны от паллеты, но останутся в WMS вместе с товарами и остатками.`,
    )) {
      return;
    }
    setBusy(`clear-pallet:${pallet.id}`);
    setNotice('');
    try {
      const result = await clearStoragePallet(session.accessToken, pallet.id);
      setNotice(`Паллет-сорт ${pallet.code} очищен. Коробов отвязано: ${result.clearedCount}.`);
      await load(false);
    } catch (error) {
      setState((current) => ({ ...current, error: errorText(error) }));
    } finally {
      setBusy('');
    }
  }

  function closeBulkDeleteMode() {
    setBulkDeleteMode(false);
    setSelectedPalletIds(new Set());
    setBulkDeleteConfirmOpen(false);
  }

  async function confirmBulkDelete() {
    if (!selectedPalletIds.size) return;
    const ids = [...selectedPalletIds];
    setBusy('bulk-delete');
    setNotice('');
    setState((current) => ({ ...current, error: '' }));
    try {
      const result = await deleteStoragePallets(session.accessToken, ids);
      setNotice(
        `Удалено паллет-сортов: ${result.deletedCount}. Коробов отвязано: ${result.detachedBoxCount}. Товары и остатки сохранены.`,
      );
      closeBulkDeleteMode();
      await load(false);
    } catch (error) {
      setBulkDeleteConfirmOpen(false);
      setState((current) => ({ ...current, error: errorText(error) }));
    } finally {
      setBusy('');
    }
  }

  function togglePallet(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitRelocateBox(event: FormEvent) {
    event.preventDefault();
    if (!relocateBox?.targetPalletId) return;
    const busyKey = `relocate:${relocateBox.placementId}`;
    setBusy(busyKey);
    setNotice('');
    try {
      const result = await relocateStoragePalletBox(session.accessToken, {
        boxCode: relocateBox.boxCode,
        targetPalletId: relocateBox.targetPalletId,
        swapBoxCode: relocateBox.swapBoxCode || undefined,
      });
      setNotice(result.message);
      setRelocateBox(null);
      await load(false);
    } catch (error) {
      setState((current) => ({ ...current, error: errorText(error) }));
    } finally {
      setBusy('');
    }
  }

  const data = state.data;
  const sourceLabel = (source: string) =>
    source === 'TSD' ? 'ТСД' : source === 'GOOGLE_SHEETS' ? 'Google' : 'Вручную';

  return (
    <div className="storage-zones">
      <header className="storage-zones__hero">
        <div>
          <p className="eyebrow">Склад и операции</p>
          <h2>Зоны хранения</h2>
          <p>Зона → паллета клиента → короба. Текущее место короба используется в поиске и сборке FBS/FBO.</p>
        </div>
        <div className="storage-zones__hero-icon"><MapPin size={30} aria-hidden="true" /></div>
      </header>

      {data ? (
        <div className="storage-zones__metrics">
          <Metric icon={<Warehouse size={18} />} label="Зон" value={data.summary.zones} />
          <Metric icon={<PackagePlus size={18} />} label="Паллет" value={data.summary.pallets} />
          <Metric icon={<Boxes size={18} />} label="Коробов" value={data.summary.boxes} />
          <Metric icon={<MapPin size={18} />} label="Без зоны" value={data.summary.unassignedPallets} />
        </div>
      ) : null}

      {data ? (
        <section className="storage-zones__zone-statistics">
          <header>
            <div>
              <strong>Заполнение по зонам</strong>
              <span>Фактическое количество паллетов и коробов в каждой зоне выбранного склада</span>
            </div>
            <small>{data.warehouse.name}</small>
          </header>
          <div className="storage-zones__zone-statistics-grid">
            {data.zones.map((zone) => (
              <article key={zone.id}>
                <span className="storage-zones__zone-marker"><MapPin size={16} /></span>
                <div>
                  <strong>{zone.name}</strong>
                  <small>{zone.code}</small>
                </div>
                <dl>
                  <div><dt>Паллеты</dt><dd>{zone.palletCount.toLocaleString('ru-RU')}</dd></div>
                  <div><dt>Короба</dt><dd>{zone.boxCount.toLocaleString('ru-RU')}</dd></div>
                </dl>
              </article>
            ))}
            {data.summary.unassignedPallets > 0 ? (
              <article className="is-unassigned">
                <span className="storage-zones__zone-marker"><MapPin size={16} /></span>
                <div><strong>Без зоны</strong><small>Требует распределения</small></div>
                <dl>
                  <div><dt>Паллеты</dt><dd>{data.summary.unassignedPallets.toLocaleString('ru-RU')}</dd></div>
                  <div>
                    <dt>Короба</dt>
                    <dd>{data.pallets.filter((pallet) => !pallet.zoneId).reduce((sum, pallet) => sum + pallet.boxes.length, 0).toLocaleString('ru-RU')}</dd>
                  </div>
                </dl>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      {data ? (
        <div className="storage-zones__prefixes" aria-label="Префиксы складских кодов">
          <strong>Префиксы кодов:</strong>
          <span>паллета <b>{data.codePrefixes.pallet}</b></span>
          <span>ячейка <b>{data.codePrefixes.storageCell}</b></span>
          <span>место <b>{data.codePrefixes.rackSlot}</b></span>
          <span>стеллаж <b>{data.codePrefixes.rack}</b></span>
          <span>бокс хранения <b>{data.codePrefixes.storageBox}</b></span>
        </div>
      ) : null}

      <section className="storage-zones__toolbar">
        <label className="storage-zones__search">
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Паллета, короб, клиент или зона" />
        </label>
        <label>
          <span>Клиент паллет-сорта</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Выберите клиента</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        {/* FIX: Google was a one-time migration; current placement is managed only in WMS. */}
      </section>

      {state.error ? <p className="form-error">{state.error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}
      {data?.googleSync.error ? <p className="form-warning">Google: {data.googleSync.error}. Сохранённые размещения доступны.</p> : null}

      {data && data.zones.length === 0 ? (
        <section className="storage-zones__empty-zones">
          <MapPin size={22} />
          <div>
            <strong>Размещение коробов</strong>
            <p>Зоны ещё не созданы. Паллеты из файла ИП Лукина уже можно искать и раскрывать; затем распределите их по созданным зонам.</p>
          </div>
        </section>
      ) : null}

      {data ? (
        <div className="storage-zones__forms">
          <form onSubmit={submitZone}>
            <div><strong>Новая зона</strong><span>Название может быть любым</span></div>
            <input value={zoneName} onChange={(event) => setZoneName(event.target.value)} placeholder="Например: 2 этаж, сектор B" />
            <button className="primary-button" disabled={!zoneName.trim() || busy === 'zone'}>Добавить зону</button>
          </form>
          <form onSubmit={submitPallet}>
            <div><strong>Новая паллета</strong><span>Обязательно выберите клиента</span></div>
            <input
              value={palletCode}
              onChange={(event) => setPalletCode(event.target.value)}
              placeholder={`Например: ${data.codePrefixes.pallet}001`}
            />
            <select value={palletZoneId} onChange={(event) => setPalletZoneId(event.target.value)}>
              <option value="">Пока без зоны</option>
              {data.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </select>
            <button className="primary-button" disabled={!palletCode.trim() || !clientId || busy === 'pallet'}>Создать</button>
          </form>
        </div>
      ) : null}

      {state.loading && !data ? <p className="warehouse-inline">Загружаю размещение…</p> : null}
      {data ? (
        <section className="storage-zones__list">
          <header>
            <div>
              <p className="eyebrow">Фактическое размещение</p>
              <h3>Паллеты и короба</h3>
            </div>
            <div className="storage-zones__list-meta">
              <span>{visiblePallets.length} паллет</span>
              {!bulkDeleteMode ? (
                <button
                  className="storage-pallet-bulk-trigger"
                  type="button"
                  disabled={visiblePallets.length === 0}
                  onClick={() => {
                    setState((current) => ({ ...current, error: '' }));
                    setNotice('');
                    setBulkDeleteMode(true);
                  }}
                >
                  <Trash2 size={16} />
                  Удалить несколько
                </button>
              ) : null}
            </div>
          </header>
          {bulkDeleteMode ? (
            <div className="storage-pallet-bulkbar" role="toolbar" aria-label="Массовое удаление паллет-сортов">
              <label className="storage-pallet-bulkbar__select-all">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={visiblePallets.length === 0 || busy === 'bulk-delete'}
                  onChange={(event) =>
                    setSelectedPalletIds((current) => selectVisiblePallets(current, visiblePallets, event.target.checked))
                  }
                />
                <span>
                  <strong>Выбрать все</strong>
                  <small>{visiblePallets.length} паллет среди найденных</small>
                </span>
              </label>
              <div className="storage-pallet-bulkbar__count" aria-live="polite">
                <strong>{selectedPalletIds.size}</strong>
                <span>выбрано</span>
              </div>
              <div className="storage-pallet-bulkbar__actions">
                <button className="secondary-button" type="button" disabled={busy === 'bulk-delete'} onClick={closeBulkDeleteMode}>
                  Отмена
                </button>
                <button
                  className="storage-pallet-bulkbar__delete"
                  type="button"
                  disabled={selectedPalletIds.size === 0 || busy === 'bulk-delete'}
                  onClick={() => setBulkDeleteConfirmOpen(true)}
                >
                  <Trash2 size={16} />
                  Удалить выбранные
                </button>
              </div>
            </div>
          ) : null}
          {visiblePallets.length === 0 ? <p className="storage-zones__empty">По запросу ничего не найдено.</p> : null}
          {visiblePallets.map((pallet) => {
            const isOpen = expanded.has(pallet.id) || Boolean(query.trim());
            const isSelected = selectedPalletIds.has(pallet.id);
            return (
              <article
                key={pallet.id}
                className={`storage-pallet${isSelected ? ' is-selected' : ''}`}
              >
                <div className="storage-pallet__row">
                  {bulkDeleteMode ? (
                    <label
                      className="storage-pallet__select"
                      title={`Выбрать ${pallet.code}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={busy === 'bulk-delete'}
                        aria-label={`Выбрать паллет-сорт ${pallet.code}`}
                        onChange={() => setSelectedPalletIds((current) => togglePalletSelection(current, pallet))}
                      />
                    </label>
                  ) : null}
                  <button className="storage-pallet__summary" type="button" onClick={() => togglePallet(pallet.id)}>
                    {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <span>
                      <strong>{pallet.code}</strong>
                      <small>{pallet.client.name} · {pallet.zone?.name ?? 'Без зоны'}</small>
                    </span>
                    <em>{pallet.boxes.length} коробов</em>
                    <i data-source={pallet.source}>{sourceLabel(pallet.source)}</i>
                  </button>
                </div>
                {isOpen ? (
                  <div className="storage-pallet__body">
                    <div className="storage-pallet__controls">
                      <label>
                        <span>Зона хранения</span>
                        <select
                          value={pallet.zoneId ?? ''}
                          disabled={busy === `zone:${pallet.id}`}
                          onChange={(event) =>
                            void run(
                              `zone:${pallet.id}`,
                              () => updateStoragePallet(session.accessToken, pallet.id, { zoneId: event.target.value || null }),
                              `Паллета ${pallet.code} перемещена.`,
                            )
                          }
                        >
                          <option value="">Без зоны</option>
                          {data.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Добавить короб</span>
                        <div>
                          <input
                            value={boxDrafts[pallet.id] ?? ''}
                            onChange={(event) => setBoxDrafts((current) => ({ ...current, [pallet.id]: event.target.value }))}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void submitBox(pallet.id);
                              }
                            }}
                            placeholder="FFL_..."
                          />
                          <button type="button" onClick={() => void submitBox(pallet.id)} disabled={!boxDrafts[pallet.id]?.trim()}>
                            <PackagePlus size={16} /> Добавить
                          </button>
                        </div>
                      </label>
                    </div>
                    {!bulkDeleteMode ? <div className="storage-pallet__pallet-actions">
                      <button
                        className="storage-pallet__clear-button"
                        type="button"
                        disabled={pallet.boxes.length === 0 || busy === `clear-pallet:${pallet.id}`}
                        title={pallet.boxes.length === 0 ? 'Паллет-сорт уже пуст' : 'Отвязать все короба, сохранив их в WMS'}
                        onClick={() => void clearPallet(pallet)}
                      >
                        <Eraser size={15} />
                        {busy === `clear-pallet:${pallet.id}` ? 'Очищаю…' : 'Очистить паллет'}
                      </button>
                      <button
                        className="storage-pallet__delete-button"
                        type="button"
                        disabled={busy === `delete-pallet:${pallet.id}`}
                        title="Удалить паллет-сорт; находящиеся на нём короба останутся в WMS"
                        onClick={() => void deletePallet(pallet)}
                      >
                        <Trash2 size={15} />
                        {busy === `delete-pallet:${pallet.id}` ? 'Удаляю…' : 'Удалить паллету'}
                      </button>
                    </div> : null}
                    <div className="storage-pallet__boxes">
                      {pallet.boxes.length === 0 ? <p>На паллете пока нет коробов.</p> : null}
                      {pallet.boxes.map((placement) => (
                        <div key={placement.id}>
                          <span>
                            <strong>{placement.boxCode}</strong>
                            <small>
                              {placement.box?.client.name ?? 'Короб пока не найден в WMS'} · {sourceLabel(placement.source)}
                            </small>
                          </span>
                          <div className="storage-pallet__box-actions">
                            <button
                              className="is-move"
                              type="button"
                              title="Перенести или поменять короб местами"
                              onClick={() => {
                                setState((current) => ({ ...current, error: '' }));
                                setRelocateBox({
                                  placementId: placement.id,
                                  boxCode: placement.boxCode,
                                  sourcePalletId: pallet.id,
                                  sourcePalletCode: pallet.code,
                                  clientId: pallet.clientId,
                                  targetPalletId: '',
                                  swapBoxCode: '',
                                });
                              }}
                            >
                              <ArrowLeftRight size={15} />
                            </button>
                            <button
                              type="button"
                              title="Убрать короб с паллеты"
                              onClick={() =>
                                void run(
                                  `remove:${placement.id}`,
                                  () => removeStoragePalletBox(session.accessToken, pallet.id, placement.boxCode),
                                  `Короб ${placement.boxCode} убран с паллеты.`,
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {relocateBox && data ? (
        <div className="storage-pallet-move-backdrop" role="presentation" onMouseDown={() => busy !== `relocate:${relocateBox.placementId}` && setRelocateBox(null)}>
          <form
            className="storage-pallet-move-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Исправление паллетсорта"
            onSubmit={submitRelocateBox}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>Исправление сканирования</span>
                <h3>{relocateBox.boxCode}</h3>
                <small>Сейчас находится на паллете {relocateBox.sourcePalletCode}</small>
              </div>
              <button className="icon-button" type="button" onClick={() => setRelocateBox(null)} aria-label="Закрыть">
                <X size={18} />
              </button>
            </header>
            <label>
              <span>Правильная паллета</span>
              <select
                value={relocateBox.targetPalletId}
                onChange={(event) =>
                  setRelocateBox((current) =>
                    current ? { ...current, targetPalletId: event.target.value, swapBoxCode: '' } : current,
                  )
                }
                required
              >
                <option value="">Выберите паллету</option>
                {data.pallets
                  .filter((pallet) => pallet.clientId === relocateBox.clientId && pallet.id !== relocateBox.sourcePalletId)
                  .map((pallet) => (
                    <option key={pallet.id} value={pallet.id}>
                      {pallet.code} · {pallet.zone?.name ?? 'без зоны'} · {pallet.boxes.length} коробов
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Короб для обмена местами — необязательно</span>
              <select
                value={relocateBox.swapBoxCode}
                disabled={!relocateBox.targetPalletId}
                onChange={(event) =>
                  setRelocateBox((current) => (current ? { ...current, swapBoxCode: event.target.value } : current))
                }
              >
                <option value="">Просто перенести на выбранную паллету</option>
                {(data.pallets.find((pallet) => pallet.id === relocateBox.targetPalletId)?.boxes ?? []).map((placement) => (
                  <option key={placement.id} value={placement.boxCode}>
                    Поменять местами с {placement.boxCode}
                  </option>
                ))}
              </select>
              <small>
                Если выбрать второй короб, он одновременно перейдёт на паллету {relocateBox.sourcePalletCode}.
              </small>
            </label>
            <div className="storage-pallet-move-dialog__preview">
              <ArrowLeftRight size={19} />
              <span>
                {relocateBox.swapBoxCode
                  ? `${relocateBox.boxCode} ↔ ${relocateBox.swapBoxCode}`
                  : relocateBox.targetPalletId
                    ? `${relocateBox.boxCode} будет перенесён без обмена`
                    : 'Выберите правильную паллету'}
              </span>
            </div>
            <footer>
              <button className="secondary-button" type="button" onClick={() => setRelocateBox(null)}>
                Отмена
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={!relocateBox.targetPalletId || busy === `relocate:${relocateBox.placementId}`}
              >
                <ArrowLeftRight size={16} />
                {busy === `relocate:${relocateBox.placementId}`
                  ? 'Исправляю'
                  : relocateBox.swapBoxCode
                    ? 'Поменять местами'
                    : 'Перенести короб'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {bulkDeleteConfirmOpen ? (
        <div
          className="storage-pallet-move-backdrop"
          role="presentation"
          onMouseDown={() => busy !== 'bulk-delete' && setBulkDeleteConfirmOpen(false)}
        >
          <section
            className="storage-pallet-bulk-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-delete-pallets-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <span className="storage-pallet-bulk-dialog__icon"><Trash2 size={22} /></span>
              <div>
                <p>Подтверждение удаления</p>
                <h3 id="bulk-delete-pallets-title">Удалить {selectedPalletIds.size} паллет-сортов?</h3>
              </div>
            </header>
            <p>
              Паллет-сорты исчезнут из зон хранения. С них будет отвязано коробов: <strong>{selectedBoxCount}</strong>.
              {' '}Сами короба, товары и складские остатки останутся в WMS и будут отображаться без паллет-сорта.
            </p>
            <div className="storage-pallet-bulk-dialog__codes" aria-label="Выбранные паллет-сорты">
              {selectedPallets.slice(0, 8).map((pallet) => <span key={pallet.id}>{pallet.code}</span>)}
              {selectedPallets.length > 8 ? <span>+ ещё {selectedPallets.length - 8}</span> : null}
            </div>
            <footer>
              <button
                className="secondary-button"
                type="button"
                autoFocus
                disabled={busy === 'bulk-delete'}
                onClick={() => setBulkDeleteConfirmOpen(false)}
              >
                Оставить паллеты
              </button>
              <button
                className="storage-pallet-bulkbar__delete"
                type="button"
                disabled={busy === 'bulk-delete'}
                onClick={() => void confirmBulkDelete()}
              >
                <Trash2 size={16} />
                {busy === 'bulk-delete' ? `Удаляю ${selectedPalletIds.size}…` : 'Да, удалить выбранные'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div>{icon}<span><strong>{value.toLocaleString('ru-RU')}</strong><small>{label}</small></span></div>;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие.';
}
