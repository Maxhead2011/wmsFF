import { ArrowLeft, ArrowRightLeft, ChevronRight, ClipboardCheck, History, PackageCheck, PackagePlus, PackageSearch, RefreshCw, Truck, Warehouse } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { deleteSku, fetchClients, fetchSkus, type AuthSession, type AuthUser, type ClientSummary, type SkuSummary } from '../../lib/api';
import { BoxTransferForm } from './BoxTransferForm';
import { BoxManagementPanel } from './BoxManagementPanel';
import { OnlineReceiptPanel } from './OnlineReceiptPanel';
import { GoodsArrivalPanel } from './GoodsArrivalPanel';
import { ReceiptBatchesPanel } from './ReceiptBatchesPanel';
import { PickWavePanel } from './PickWavePanel';
import { StoragePanel } from './StoragePanel';
import { BoxIntegrityPanel } from './BoxIntegrityPanel';
import { ShipmentHistoryPanel } from './ShipmentHistoryPanel';
import './warehouse.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';

type WarehouseOpsPanelProps = {
  session: AuthSession;
  onOpenCatalog?: () => void;
};

type WarehouseTopic =
  | 'online-receipts'
  | 'arrivals'
  | 'receipt-batches'
  | 'boxes'
  | 'integrity'
  | 'shipment-history'
  | 'operations'
  | 'drafts'
  | 'storage';

export function WarehouseOpsPanel({ onOpenCatalog, session }: WarehouseOpsPanelProps) {
  const [activeTopic, setActiveTopic] = useState<WarehouseTopic | null>(null);

  if (!canUse(session.user, 'stock:write')) {
    return null;
  }

  return (
    <div className="warehouse-workspace" aria-label="Склад и операции">
      {!activeTopic ? <WarehouseTopicPicker onOpen={setActiveTopic} /> : null}

      {activeTopic ? (
        <button className="warehouse-topic-back" type="button" onClick={() => setActiveTopic(null)}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Разделы склада</span>
        </button>
      ) : null}

      {activeTopic === 'online-receipts' ? <section className="warehouse-panel warehouse-panel--online-receipts" aria-label="Онлайн приемка">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">ТСД и приемка</p>
            <h2>Онлайн приемка</h2>
          </div>
          <PackageCheck size={20} aria-hidden="true" />
        </div>

        <OnlineReceiptPanel session={session} />
      </section> : null}

      {activeTopic === 'arrivals' ? <section className="warehouse-panel warehouse-panel--arrivals" aria-label="Приход товара">
        <div className="section-heading warehouse-panel__heading">
          <div><p className="eyebrow">Приход и ППР</p><h2>Приход товара</h2></div>
          <Truck size={20} aria-hidden="true" />
        </div>
        <GoodsArrivalPanel session={session} />
      </section> : null}

      {activeTopic === 'receipt-batches' ? <section className="warehouse-panel warehouse-panel--receipt-batches" aria-label="Файлы приемки">
        <div className="section-heading warehouse-panel__heading">
          <div><p className="eyebrow">Документы приемки</p><h2>Файлы приемки</h2></div>
          <PackageCheck size={20} aria-hidden="true" />
        </div>
        <ReceiptBatchesPanel session={session} />
      </section> : null}

      {activeTopic === 'boxes' ? <section className="warehouse-panel warehouse-panel--boxes" aria-label="Короба на складе">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Хранение и остатки</p>
            <h2>Короба</h2>
          </div>
          <PackageSearch size={20} aria-hidden="true" />
        </div>

        <BoxManagementPanel session={session} />
      </section> : null}

      {activeTopic === 'integrity' ? <section className="warehouse-panel warehouse-panel--integrity" aria-label="Проверка коробов">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Контроль остатков</p>
            <h2>Проверка коробов</h2>
          </div>
          <ClipboardCheck size={20} aria-hidden="true" />
        </div>
        <BoxIntegrityPanel session={session} />
      </section> : null}

      {activeTopic === 'shipment-history' ? <section className="warehouse-panel warehouse-panel--shipment-history" aria-label="История отгруженных КИЗ">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">История</p>
            <h2>Отгруженные товары с КИЗ</h2>
          </div>
          <History size={20} aria-hidden="true" />
        </div>
        <ShipmentHistoryPanel session={session} />
      </section> : null}

      {activeTopic === 'operations' ? <section className="warehouse-panel warehouse-panel--operations" aria-label="Складские операции">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Операции склада</p>
            <h2>Перемещения и сборка</h2>
          </div>
          <ArrowRightLeft size={20} aria-hidden="true" />
        </div>

        <BoxTransferForm session={session} />
        <PickWavePanel session={session} />
      </section> : null}

      {activeTopic === 'drafts' ? <section className="warehouse-panel warehouse-panel--drafts" aria-label="Новый товар">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Новый товар</p>
            <h2>Черновики после приемки</h2>
          </div>
          <PackagePlus size={20} aria-hidden="true" />
        </div>

        <NewProductsPanel session={session} onOpenCatalog={onOpenCatalog} />
      </section> : null}

      {activeTopic === 'storage' ? <section className="warehouse-panel warehouse-panel--storage" aria-label="Хранение">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Хранение</p>
            <h2>Литраж, тарифы и начисления</h2>
          </div>
          <Warehouse size={20} aria-hidden="true" />
        </div>

        <StoragePanel session={session} />
      </section> : null}
    </div>
  );
}

function WarehouseTopicPicker({ onOpen }: { onOpen: (topic: WarehouseTopic) => void }) {
  const topics: Array<{ id: WarehouseTopic; eyebrow: string; title: string; description: string; icon: ReactNode }> = [
    { id: 'online-receipts', eyebrow: 'ТСД и приемка', title: 'Онлайн-приёмка', description: 'Проверяйте приёмку, которую ведут сотрудники на ТСД.', icon: <PackageCheck size={23} /> },
    { id: 'arrivals', eyebrow: 'Приход и ППР', title: 'Приход товара', description: 'Создайте и ведите приход товаров на склад.', icon: <Truck size={23} /> },
    { id: 'receipt-batches', eyebrow: 'Документы', title: 'Файлы приёмки', description: 'Загрузки и документы, связанные с поставками.', icon: <PackagePlus size={23} /> },
    { id: 'boxes', eyebrow: 'Хранение', title: 'Короба', description: 'Найдите короб, его состав, ячейку и паллет-сорт.', icon: <PackageSearch size={23} /> },
    { id: 'integrity', eyebrow: 'Контроль остатков', title: 'Проверка коробов', description: 'Найдите фантомные остатки и исправьте расхождения.', icon: <ClipboardCheck size={23} /> },
    { id: 'shipment-history', eyebrow: 'История', title: 'Отгруженные КИЗ', description: 'Проверка отгруженных товаров, коробов и кодов маркировки.', icon: <History size={23} /> },
    { id: 'operations', eyebrow: 'Операции склада', title: 'Перемещения и сборка', description: 'Перемещайте короба и формируйте задания на сборку.', icon: <ArrowRightLeft size={23} /> },
    { id: 'drafts', eyebrow: 'Новый товар', title: 'Черновики приёмки', description: 'Заполните карточки новых товаров после приёмки.', icon: <PackagePlus size={23} /> },
    { id: 'storage', eyebrow: 'Тарифы', title: 'Хранение', description: 'Литраж, тарифы и начисления за хранение.', icon: <Warehouse size={23} /> },
  ];

  return (
    <section className="warehouse-topic-picker" aria-label="Разделы склада">
      <div className="warehouse-topic-picker__heading">
        <div><p className="eyebrow">Склад и операции</p><h2>Выберите задачу</h2></div>
        <span>Операции открываются отдельно — список не мешает работе.</span>
      </div>
      <div className="warehouse-topic-grid">
        {topics.map((topic) => (
          <button className={`warehouse-topic-tile warehouse-topic-tile--${topic.id}`} key={topic.id} type="button" onClick={() => onOpen(topic.id)}>
            <span className="warehouse-topic-tile__icon">{topic.icon}</span>
            <span className="warehouse-topic-tile__content"><small>{topic.eyebrow}</small><strong>{topic.title}</strong><span>{topic.description}</span></span>
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function NewProductsPanel({ onOpenCatalog, session }: { session: AuthSession; onOpenCatalog?: () => void }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
  const [drafts, setDrafts] = useState<SkuSummary[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let isActive = true;
    fetchClients(session.accessToken)
      .then((items) => {
        if (!isActive) {
          return;
        }
        setClients(items);
        setSelectedClientId((current) => validRememberedClientId(current, items));
      })
      .catch((caught: unknown) => {
        if (isActive) {
          setMessage(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
        }
      });
    return () => {
      isActive = false;
    };
  }, [session.accessToken]);

  useEffect(() => {
    if (!selectedClientId) {
      setDrafts([]);
      setSelectedDraftIds([]);
      return;
    }
    void loadDrafts();
  }, [selectedClientId]);

  async function loadDrafts() {
    if (!selectedClientId) {
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const nextDrafts = await fetchSkus(session.accessToken, { clientId: selectedClientId, draftsOnly: true });
      setDrafts(nextDrafts);
      setSelectedDraftIds((current) => current.filter((id) => nextDrafts.some((draft) => draft.id === id)));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Не удалось загрузить новые товары.');
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelectedDrafts() {
    if (selectedDraftIds.length === 0) {
      return;
    }
    setDeleting(true);
    setMessage('');
    const errors: string[] = [];
    for (const id of selectedDraftIds) {
      try {
        await deleteSku(session.accessToken, id);
      } catch (caught) {
        const draft = drafts.find((item) => item.id === id);
        errors.push(`${draft?.name ?? id}: ${caught instanceof Error ? caught.message : 'не удалено'}`);
      }
    }
    setSelectedDraftIds([]);
    await loadDrafts();
    setMessage(errors.length ? `Удалены не все черновики: ${errors.slice(0, 3).join('; ')}` : 'Выбранные черновики удалены.');
    setDeleting(false);
  }

  return (
    <div className="warehouse-drafts">
      <div className="warehouse-drafts__toolbar">
        <label>
          <span>Клиент</span>
          <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
            <option value="">Выберите клиента</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" type="button" onClick={() => void loadDrafts()} disabled={!selectedClientId || isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{isLoading ? 'Обновляю' : 'Обновить'}</span>
        </button>
        {onOpenCatalog ? (
          <button className="primary-button" type="button" onClick={onOpenCatalog}>
            <PackagePlus size={16} aria-hidden="true" />
            <span>Заполнить в каталоге</span>
          </button>
        ) : null}
        <button
          className="danger-button"
          type="button"
          onClick={() => void deleteSelectedDrafts()}
          disabled={selectedDraftIds.length === 0 || isDeleting}
        >
          Удалить выбранные ({selectedDraftIds.length})
        </button>
      </div>

      {message ? <p className="form-error">{message}</p> : null}

      {drafts.length > 0 ? (
        <>
          <label className="warehouse-comment">
            <span>Выбрать черновики для удаления</span>
            <select
              multiple
              size={Math.min(8, Math.max(3, drafts.length))}
              value={selectedDraftIds}
              onChange={(event) => setSelectedDraftIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
            >
              {drafts.map((sku) => (
                <option key={sku.id} value={sku.id}>
                  {primaryBarcode(sku) || sku.internalSku} - {sku.name}
                </option>
              ))}
            </select>
          </label>
          <div className="warehouse-drafts__table-wrap">
            <table className="warehouse-drafts__table">
            <thead>
              <tr>
                <th>ШК</th>
                <th>Название</th>
                <th>Артикул</th>
                <th>Цвет / размер</th>
                <th>Источник</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((sku) => (
                <tr key={sku.id}>
                  <td>{primaryBarcode(sku) || '-'}</td>
                  <td>
                    <strong>{sku.name}</strong>
                    <span>{sku.internalSku}</span>
                  </td>
                  <td>{sku.article || '-'}</td>
                  <td>{[sku.color, sku.size].filter(Boolean).join(' / ') || '-'}</td>
                  <td>{sku.draftSource || 'приемка'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <p className="warehouse-inline">{selectedClientId ? 'Новых товаров без карточки у клиента нет.' : 'Выберите клиента.'}</p>
      )}
    </div>
  );
}

function canUse(user: AuthUser, permission: string) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}

function primaryBarcode(sku: SkuSummary) {
  return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? '';
}
