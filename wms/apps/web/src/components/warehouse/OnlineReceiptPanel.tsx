import { CheckCircle2, Edit3, PackageOpen, RefreshCw, RotateCcw, Search, Trash2, Unlock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  addOnlineReceiptItem,
  closeAllOnlineReceiptBoxes,
  closeOnlineReceiptBox,
  deleteOnlineReceiptBox,
  deleteOnlineReceiptItem,
  fetchClients,
  fetchOnlineReceipts,
  fetchSkus,
  finishOnlineReceipt,
  openOnlineReceiptBox,
  restoreOnlineReceiptBox,
  updateOnlineReceiptItem,
  type AuthSession,
  type ClientSummary,
  type OnlineReceiptBoxSummary,
  type OnlineReceiptOverview,
  type OnlineReceiptItemSummary,
  type SkuSummary,
} from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';

type OnlineReceiptPanelProps = {
  session: AuthSession;
  fixedClientId?: string;
  readOnly?: boolean;
};

type PendingConfirm = {
  title: string;
  message: string;
  details?: string[];
  confirmLabel: string;
  action: () => Promise<unknown>;
  success: string;
};

export function OnlineReceiptPanel({ fixedClientId, readOnly = false, session }: OnlineReceiptPanelProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useState(fixedClientId ?? '');
  const [overview, setOverview] = useState<OnlineReceiptOverview | null>(null);
  const [selectedBoxKey, setSelectedBoxKey] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isConfirming, setConfirming] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [boxCode, setBoxCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [kiz, setKiz] = useState('');
  const [skuOptions, setSkuOptions] = useState<SkuSummary[]>([]);
  const [editingId, setEditingId] = useState('');
  const [editQuantity, setEditQuantity] = useState('1');
  const [editKiz, setEditKiz] = useState('');

  const canManage = !readOnly && canUse(session.user, 'warehouse:write');
  const deletedBoxes = overview?.deletedBoxes ?? [];
  const openBoxes = overview?.boxes.filter((box) => box.status === 'receiving') ?? [];

  useEffect(() => {
    if (fixedClientId) {
      setClientId(fixedClientId);
      return;
    }

    let active = true;
    fetchClients(session.accessToken)
      .then((items) => {
        if (!active) {
          return;
        }
        setClients(items);
        setClientId((current) => current || items[0]?.id || '');
      })
      .catch((caught: unknown) => {
        if (active) {
          setMessage(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
        }
      });
    return () => {
      active = false;
    };
  }, [fixedClientId, session.accessToken]);

  useEffect(() => {
    if (!clientId) {
      setOverview(null);
      return;
    }
    void loadOverview();
    const timer = window.setInterval(() => void loadOverview(false), 15000);
    return () => window.clearInterval(timer);
  }, [clientId]);

  useEffect(() => {
    if (!clientId || barcode.trim().length < 3) {
      setSkuOptions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      fetchSkus(session.accessToken, { clientId, search: barcode.trim() })
        .then((items) => {
          if (active) {
            setSkuOptions(items.slice(0, 20));
          }
        })
        .catch(() => {
          if (active) {
            setSkuOptions([]);
          }
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [barcode, clientId, session.accessToken]);

  const selectedBox = useMemo(() => {
    if (!overview?.boxes.length) {
      return null;
    }
    return overview.boxes.find((box) => box.key === selectedBoxKey) ?? overview.boxes[0];
  }, [overview, selectedBoxKey]);

  useEffect(() => {
    if (!overview?.boxes.length) {
      setSelectedBoxKey('');
      return;
    }
    setSelectedBoxKey((current) => (overview.boxes.some((box) => box.key === current) ? current : overview.boxes[0].key));
  }, [overview]);

  async function loadOverview(showSpinner = true) {
    if (!clientId) {
      return;
    }
    if (showSpinner) {
      setLoading(true);
    }
    setMessage('');
    try {
      const result = await fetchOnlineReceipts(session.accessToken, { clientId });
      setOverview(result);
      if (showSpinner) {
        setSelectedBoxKey(result.boxes[0]?.key ?? '');
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Не удалось загрузить онлайн-приемку.');
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  async function runAction(action: () => Promise<unknown>, success: string) {
    setMessage('');
    try {
      await action();
      setMessage(success);
      await loadOverview(false);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Операция не выполнена.');
    }
  }

  async function runConfirmed() {
    if (!pendingConfirm) {
      return;
    }
    setConfirming(true);
    try {
      await runAction(pendingConfirm.action, pendingConfirm.success);
      setPendingConfirm(null);
    } finally {
      setConfirming(false);
    }
  }

  async function addItem() {
    const targetBox = selectedBox?.boxCode || boxCode.trim();
    if (!clientId || !targetBox || !barcode.trim()) {
      setMessage('Выберите клиента, короб и укажите ШК товара.');
      return;
    }
    await runAction(
      () =>
        addOnlineReceiptItem(session.accessToken, {
          clientId,
          boxCode: targetBox,
          sourceDocument: selectedBox?.sourceDocument,
          barcode: barcode.trim(),
          quantity: Number(quantity) || 1,
          kiz: kiz.trim() || undefined,
        }),
      'Товар добавлен в короб.',
    );
    setBarcode('');
    setQuantity('1');
    setKiz('');
  }

  function startEdit(item: OnlineReceiptItemSummary) {
    setEditingId(item.movementId);
    setEditQuantity(String(item.quantity));
    setEditKiz(item.kiz ?? '');
  }

  async function saveEdit(item: OnlineReceiptItemSummary) {
    await runAction(
      () =>
        updateOnlineReceiptItem(session.accessToken, item.movementId, {
          quantity: Number(editQuantity) || item.quantity,
          kiz: editKiz,
        }),
      'Строка приемки изменена.',
    );
    setEditingId('');
  }

  const totals =
    overview?.boxes.reduce(
      (sum, box) => ({
        boxes: sum.boxes + 1,
        quantity: sum.quantity + box.totalQuantity,
        kiz: sum.kiz + box.kizCount,
        receiving: sum.receiving + (box.status === 'receiving' ? 1 : 0),
      }),
      { boxes: 0, quantity: 0, kiz: 0, receiving: 0 },
    ) ?? { boxes: 0, quantity: 0, kiz: 0, receiving: 0 };

  return (
    <div className={`online-receipts ${readOnly ? 'online-receipts--readonly' : ''}`}>
      <div className="online-receipts__toolbar">
        {!fixedClientId ? (
          <label>
            <span>Клиент</span>
            <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">Выберите клиента</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button className="secondary-button" type="button" onClick={() => void loadOverview()} disabled={!clientId || isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{isLoading ? 'Обновляю' : 'Обновить'}</span>
        </button>
        {canManage ? (
          <button
            className="secondary-button"
            type="button"
            disabled={!clientId || openBoxes.length === 0}
            onClick={() =>
              setPendingConfirm({
                title: 'Закрыть все открытые короба?',
                message: `Будут закрыты все открытые короба выбранного клиента: ${openBoxes.length}.`,
                details: [
                  ...openBoxes.slice(0, 12).map((box) => `${box.boxCode} · ${box.totalQuantity} шт.`),
                  ...(openBoxes.length > 12 ? [`Еще ${openBoxes.length - 12} коробов`] : []),
                ],
                confirmLabel: 'Закрыть все',
                action: () =>
                  closeAllOnlineReceiptBoxes(session.accessToken, {
                    clientId,
                    batchDate: overview?.currentBatchDate ?? undefined,
                    comment: 'Массовое закрытие открытых коробов из онлайн-приемки WMS.',
                  }),
                success: `Открытые короба закрыты: ${openBoxes.length}.`,
              })
            }
          >
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Закрыть открытые</span>
          </button>
        ) : null}
        {canManage ? (
          <button
            className="primary-button"
            type="button"
            disabled={!clientId || totals.boxes === 0}
            onClick={() =>
              setPendingConfirm({
                title: 'Завершить приемку?',
                message:
                  'Система закроет открытые короба, проверит попадание данных в остатки и отправит клиенту уведомление о завершении приемки.',
                details: [
                  `Коробов в списке: ${totals.boxes}`,
                  `Открытых коробов: ${totals.receiving}`,
                  `Единиц в остатках: ${totals.quantity}`,
                  `КИЗ: ${totals.kiz}`,
                ],
                confirmLabel: 'Завершить приемку',
                action: () =>
                  finishOnlineReceipt(session.accessToken, {
                    clientId,
                    batchDate: overview?.currentBatchDate ?? undefined,
                    comment: 'Приемка завершена из онлайн-приемки WMS.',
                  }),
                success: 'Приемка завершена. Клиенту отправлено уведомление, если Telegram включен.',
              })
            }
          >
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Завершить приемку</span>
          </button>
        ) : null}
      </div>

      <div className="online-receipts__stats">
        <Stat label="Коробов" value={totals.boxes} />
        <Stat label="Единиц" value={totals.quantity} />
        <Stat label="КИЗ" value={totals.kiz} />
        <Stat label="Открыто" value={totals.receiving} />
      </div>

      {overview?.currentBatchDate ? (
        <p className="warehouse-inline">
          Текущая приемка: {formatBatchDate(overview.currentBatchDate)}. При появлении короба с другой датой
          счетчики и список начинаются заново, а предыдущая приемка остается в разделе «Файлы приемки».
        </p>
      ) : null}

      {message ? <p className="warehouse-inline">{message}</p> : null}

      <div className="online-receipts__grid">
        <div className="online-receipts__boxes">
          <div className="warehouse-subheading">
            <h3>Короба приемки</h3>
            <span>{overview?.generatedAt ? `обновлено ${formatDateTime(overview.generatedAt)}` : 'выберите клиента'}</span>
          </div>
          {canManage ? (
            <div className="online-receipts__new-box">
              <input value={boxCode} onChange={(event) => setBoxCode(event.target.value)} placeholder="Новый короб" />
              <button
                className="secondary-button"
                type="button"
                disabled={!clientId || !boxCode.trim()}
                onClick={() =>
                  void runAction(
                    () => openOnlineReceiptBox(session.accessToken, { clientId, boxCode: boxCode.trim() }),
                    'Короб открыт.',
                  )
                }
              >
                <PackageOpen size={15} aria-hidden="true" />
                <span>Открыть</span>
              </button>
            </div>
          ) : null}
          <div className="online-receipts__box-list">
            {overview?.boxes.length ? (
              overview.boxes.map((box) => (
                <button
                  key={box.key}
                  className={`online-receipts__box-row ${selectedBox?.key === box.key ? 'is-selected' : ''}`}
                  type="button"
                  onClick={() => setSelectedBoxKey(box.key)}
                >
                  <strong>{box.boxCode}</strong>
                  <span>
                    {statusLabel(box.status)} · {box.totalQuantity} шт · КИЗ {box.kizCount}
                  </span>
                  <small>
                    {box.operator || 'оператор не указан'} · {box.deviceCode || 'ТСД не указан'}
                  </small>
                </button>
              ))
            ) : (
              <p className="warehouse-inline">По клиенту пока нет онлайн-приемок.</p>
            )}
          </div>
          {canManage && deletedBoxes.length > 0 ? (
            <DeletedBoxesList
              boxes={deletedBoxes}
              onRestore={(box) =>
                setPendingConfirm({
                  title: 'Восстановить короб?',
                  message: `Короб ${box.boxCode} вернется в остатки клиента вместе с товарами из сохраненного состава.`,
                  details: [`Единиц: ${box.totalQuantity}`, `КИЗ: ${box.kizCount}`],
                  confirmLabel: 'Восстановить',
                  action: () =>
                    restoreOnlineReceiptBox(session.accessToken, {
                      clientId,
                      boxCode: box.boxCode,
                      sourceDocument: box.sourceDocument,
                    }),
                  success: `Короб ${box.boxCode} восстановлен.`,
                })
              }
            />
          ) : null}
        </div>

        <div className="online-receipts__details">
          {selectedBox ? (
            <BoxDetails
              box={selectedBox}
              barcode={barcode}
              quantity={quantity}
              kiz={kiz}
              skuOptions={skuOptions}
              editingId={editingId}
              editQuantity={editQuantity}
              editKiz={editKiz}
              canManage={canManage}
              onBarcodeChange={setBarcode}
              onQuantityChange={setQuantity}
              onKizChange={setKiz}
              onAddItem={() => void addItem()}
              onCloseBox={() =>
                void runAction(
                  () =>
                    closeOnlineReceiptBox(session.accessToken, {
                      clientId,
                      boxCode: selectedBox.boxCode,
                      sourceDocument: selectedBox.sourceDocument,
                    }),
                  'Короб закрыт.',
                )
              }
              onOpenBox={() =>
                void runAction(
                  () =>
                    openOnlineReceiptBox(session.accessToken, {
                      clientId,
                      boxCode: selectedBox.boxCode,
                      sourceDocument: selectedBox.sourceDocument,
                    }),
                  'Короб открыт для добавления.',
                )
              }
              onDeleteBox={() =>
                setPendingConfirm({
                  title: 'Удалить короб?',
                  message: `Короб ${selectedBox.boxCode} будет убран из текущих остатков. Его можно будет восстановить из блока удаленных.`,
                  details: [`Единиц: ${selectedBox.totalQuantity}`, `КИЗ: ${selectedBox.kizCount}`],
                  confirmLabel: 'Удалить',
                  action: () =>
                    deleteOnlineReceiptBox(session.accessToken, {
                      clientId,
                      boxCode: selectedBox.boxCode,
                      sourceDocument: selectedBox.sourceDocument,
                    }),
                  success: `Короб ${selectedBox.boxCode} удален из остатков.`,
                })
              }
              onStartEdit={startEdit}
              onCancelEdit={() => setEditingId('')}
              onEditQuantityChange={setEditQuantity}
              onEditKizChange={setEditKiz}
              onSaveEdit={(item) => void saveEdit(item)}
              onDeleteItem={(item) =>
                setPendingConfirm({
                  title: 'Удалить строку приемки?',
                  message: `Позиция ${item.name} будет вычтена из короба ${selectedBox.boxCode}.`,
                  details: [`ШК: ${item.barcode || '-'}`, `Количество: ${item.quantity}`, `КИЗ: ${item.kiz || '-'}`],
                  confirmLabel: 'Удалить строку',
                  action: () => deleteOnlineReceiptItem(session.accessToken, item.movementId),
                  success: 'Строка приемки удалена.',
                })
              }
            />
          ) : (
            <p className="warehouse-inline">Выберите короб слева.</p>
          )}
        </div>
      </div>

      {pendingConfirm ? (
        <ConfirmDialog
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          details={pendingConfirm.details}
          confirmLabel={pendingConfirm.confirmLabel}
          isBusy={isConfirming}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => void runConfirmed()}
        />
      ) : null}
    </div>
  );
}

function DeletedBoxesList({ boxes, onRestore }: { boxes: OnlineReceiptBoxSummary[]; onRestore: (box: OnlineReceiptBoxSummary) => void }) {
  return (
    <div className="online-receipts__deleted">
      <div className="warehouse-subheading">
        <h3>Удаленные короба</h3>
        <span>можно восстановить</span>
      </div>
      <div className="online-receipts__box-list">
        {boxes.map((box) => (
          <div className="online-receipts__box-row online-receipts__box-row--deleted" key={`deleted-${box.key}`}>
            <button type="button" onClick={() => onRestore(box)}>
              <strong>{box.boxCode}</strong>
              <span>
                удален · {box.totalQuantity} шт · КИЗ {box.kizCount}
              </span>
              <small>{box.deletedAt ? `удален ${formatDateTime(box.deletedAt)}` : 'дата удаления не указана'}</small>
            </button>
            <button className="icon-button" type="button" onClick={() => onRestore(box)} title="Восстановить короб">
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoxDetails({
  box,
  barcode,
  quantity,
  kiz,
  skuOptions,
  editingId,
  editQuantity,
  editKiz,
  canManage,
  onBarcodeChange,
  onQuantityChange,
  onKizChange,
  onAddItem,
  onCloseBox,
  onOpenBox,
  onDeleteBox,
  onStartEdit,
  onCancelEdit,
  onEditQuantityChange,
  onEditKizChange,
  onSaveEdit,
  onDeleteItem,
}: {
  box: OnlineReceiptBoxSummary;
  barcode: string;
  quantity: string;
  kiz: string;
  skuOptions: SkuSummary[];
  editingId: string;
  editQuantity: string;
  editKiz: string;
  canManage: boolean;
  onBarcodeChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onKizChange: (value: string) => void;
  onAddItem: () => void;
  onCloseBox: () => void;
  onOpenBox: () => void;
  onDeleteBox: () => void;
  onStartEdit: (item: OnlineReceiptItemSummary) => void;
  onCancelEdit: () => void;
  onEditQuantityChange: (value: string) => void;
  onEditKizChange: (value: string) => void;
  onSaveEdit: (item: OnlineReceiptItemSummary) => void;
  onDeleteItem: (item: OnlineReceiptItemSummary) => void;
}) {
  const displayedItems = onlineReceiptItemsForDisplay(box);

  return (
    <>
      <div className="online-receipts__detail-head">
        <div>
          <p className="eyebrow">Короб</p>
          <h3>{box.boxCode}</h3>
          <span>
            {statusLabel(box.status)} · {box.sourceDocuments?.length ? box.sourceDocuments.join(', ') : box.sourceDocument || 'документ не указан'}
          </span>
        </div>
        {canManage ? (
          <div className="online-receipts__box-actions">
            <button className="secondary-button" type="button" onClick={onOpenBox}>
              <Unlock size={15} aria-hidden="true" />
              <span>Открыть</span>
            </button>
            <button className="secondary-button" type="button" onClick={onCloseBox}>
              <CheckCircle2 size={15} aria-hidden="true" />
              <span>Закрыть</span>
            </button>
            <button className="danger-button" type="button" onClick={onDeleteBox}>
              <Trash2 size={15} aria-hidden="true" />
              <span>Удалить</span>
            </button>
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="online-receipts__add-row">
          <label>
            <span>ШК товара</span>
            <div className="online-receipts__search">
              <Search size={15} aria-hidden="true" />
              <input
                list="online-receipt-skus"
                value={barcode}
                onChange={(event) => onBarcodeChange(event.target.value)}
                placeholder="Начните вводить ШК или товар"
              />
            </div>
            <datalist id="online-receipt-skus">
              {skuOptions.map((sku) => (
                <option key={sku.id} value={primaryBarcode(sku)}>
                  {[sku.name, sku.article, sku.color, sku.size].filter(Boolean).join(' · ')}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            <span>Кол-во</span>
            <input type="number" min="1" value={quantity} onChange={(event) => onQuantityChange(event.target.value)} />
          </label>
          <label>
            <span>КИЗ</span>
            <input value={kiz} onChange={(event) => onKizChange(event.target.value)} placeholder="Если есть" />
          </label>
          <button className="primary-button" type="button" onClick={onAddItem}>
            Добавить
          </button>
        </div>
      ) : null}

      <div className="online-receipts__table-wrap">
        <table className="warehouse-drafts__table online-receipts__table">
          <thead>
            <tr>
              <th>ШК</th>
              <th>Товар</th>
              <th>КИЗ</th>
              <th>Кол-во</th>
              <th>Кто / ТСД</th>
              <th>Время</th>
              {canManage ? <th>Действия</th> : null}
            </tr>
          </thead>
          <tbody>
            {displayedItems.length ? (
              displayedItems.map((item) => (
                <tr className={item.hasError ? 'online-receipts__item-error' : undefined} key={item.movementId}>
                  <td>{item.barcode || '-'}</td>
                  <td>
                    <strong>{item.name}</strong>
                    <span>{[item.article, item.color, item.size].filter(Boolean).join(' · ') || '-'}</span>
                  </td>
                  <td>
                    {editingId === item.movementId ? (
                      <input value={editKiz} onChange={(event) => onEditKizChange(event.target.value)} />
                    ) : (
                      <>
                        {item.kiz || '-'}
                        {item.hasError ? (
                          <>
                            <span className="online-receipts__error-note">
                              Ошибка приемки{item.duplicateBoxCode ? ` · дубль в коробе ${item.duplicateBoxCode}` : ''}
                            </span>
                            {item.errorMessage ? <span className="online-receipts__error-detail">{item.errorMessage}</span> : null}
                          </>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td>
                    {editingId === item.movementId ? (
                      <input type="number" min="1" value={editQuantity} onChange={(event) => onEditQuantityChange(event.target.value)} />
                    ) : (
                      item.quantity
                    )}
                  </td>
                  <td>
                    <strong>{item.operatorName || box.operator || '-'}</strong>
                    <span>{item.deviceCode || box.deviceCode || '-'}</span>
                  </td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  {canManage ? (
                    <td>
                      {item.movementId.startsWith('balance:') ? (
                        <span>Фактический остаток</span>
                      ) : editingId === item.movementId ? (
                        <div className="online-receipts__row-actions">
                          <button className="secondary-button" type="button" onClick={() => onSaveEdit(item)}>
                            Сохранить
                          </button>
                          <button className="secondary-button" type="button" onClick={onCancelEdit}>
                            Отмена
                          </button>
                        </div>
                      ) : (
                        <div className="online-receipts__row-actions">
                          <button className="icon-button" type="button" onClick={() => onStartEdit(item)} title="Изменить строку">
                            <Edit3 size={15} aria-hidden="true" />
                          </button>
                          <button className="icon-button danger-icon" type="button" onClick={() => onDeleteItem(item)} title="Удалить строку">
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={canManage ? 7 : 6}>В коробе пока нет строк приемки.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function onlineReceiptItemsForDisplay(box: OnlineReceiptBoxSummary): OnlineReceiptItemSummary[] {
  const currentQuantity = box.currentBalances.reduce((sum, row) => sum + row.quantity, 0);
  const historyQuantity = box.items.reduce((sum, row) => sum + row.quantity, 0);
  if (box.currentBalances.length === 0 || (box.items.length > 0 && currentQuantity === historyQuantity)) {
    return box.items;
  }

  return box.currentBalances.flatMap((balance) => {
    const kizMarks = box.kizValues
      .filter((mark) => mark.skuId === balance.skuId && mark.status === balance.status)
      .sort((left, right) => left.value.localeCompare(right.value));
    const baseItem: OnlineReceiptItemSummary = {
      movementId: `balance:${balance.balanceId}`,
      skuId: balance.skuId,
      barcode: balance.barcode,
      name: balance.name,
      article: '',
      color: null,
      size: null,
      quantity: balance.quantity,
      kiz: null,
      kizId: null,
      hasError: false,
      errorMessage: null,
      duplicateBoxCode: null,
      status: balance.status,
      sourceDocument: box.sourceDocument,
      createdAt: box.lastSeenAt ?? box.firstSeenAt ?? new Date(0).toISOString(),
      operatorName: box.operator,
      deviceCode: box.deviceCode,
    };
    const markedItems = kizMarks.map((mark) => ({
      ...baseItem,
      movementId: `balance:${balance.balanceId}:kiz:${mark.id}`,
      quantity: 1,
      kiz: mark.value,
      kizId: mark.id,
    }));
    const quantityWithoutKiz = Math.max(0, balance.quantity - kizMarks.length);
    return quantityWithoutKiz > 0
      ? [...markedItems, { ...baseItem, quantity: quantityWithoutKiz }]
      : markedItems;
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value.toLocaleString('ru-RU')}</strong>
    </div>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    receiving: 'Открыт',
    active: 'Закрыт',
    deleted: 'Удален',
  };
  return labels[status] ?? status;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '-';
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBatchDate(value: string) {
  const [year, month, day] = value.split('-');
  return day && month && year ? `${day}.${month}.${year}` : value;
}

function primaryBarcode(sku: SkuSummary) {
  return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? '';
}

function canUse(user: AuthSession['user'], permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
