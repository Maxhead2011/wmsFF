import { ArrowRightLeft, PackagePlus, RefreshCw, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchClients, fetchSkus, type AuthSession, type AuthUser, type ClientSummary, type SkuSummary } from '../../lib/api';
import { BoxTransferForm } from './BoxTransferForm';
import { PickWavePanel } from './PickWavePanel';
import { StoragePanel } from './StoragePanel';
import './warehouse.css';

type WarehouseOpsPanelProps = {
  session: AuthSession;
  onOpenCatalog?: () => void;
};

export function WarehouseOpsPanel({ onOpenCatalog, session }: WarehouseOpsPanelProps) {
  if (!canUse(session.user, 'stock:write')) {
    return null;
  }

  return (
    <div className="warehouse-workspace" aria-label="Склад и операции">
      <section className="warehouse-panel warehouse-panel--operations" aria-label="Складские операции">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Операции склада</p>
            <h2>Перемещения и сборка</h2>
          </div>
          <ArrowRightLeft size={20} aria-hidden="true" />
        </div>

        <BoxTransferForm session={session} />
        <PickWavePanel session={session} />
      </section>

      <section className="warehouse-panel warehouse-panel--drafts" aria-label="Новый товар">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Новый товар</p>
            <h2>Черновики после приемки</h2>
          </div>
          <PackagePlus size={20} aria-hidden="true" />
        </div>

        <NewProductsPanel session={session} onOpenCatalog={onOpenCatalog} />
      </section>

      <section className="warehouse-panel warehouse-panel--storage" aria-label="Хранение">
        <div className="section-heading warehouse-panel__heading">
          <div>
            <p className="eyebrow">Хранение</p>
            <h2>Литраж, тарифы и начисления</h2>
          </div>
          <Warehouse size={20} aria-hidden="true" />
        </div>

        <StoragePanel session={session} />
      </section>
    </div>
  );
}

function NewProductsPanel({ onOpenCatalog, session }: { session: AuthSession; onOpenCatalog?: () => void }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [drafts, setDrafts] = useState<SkuSummary[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let isActive = true;
    fetchClients(session.accessToken)
      .then((items) => {
        if (!isActive) {
          return;
        }
        setClients(items);
        setSelectedClientId((current) => current || items[0]?.id || '');
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
      setDrafts(await fetchSkus(session.accessToken, { clientId: selectedClientId, draftsOnly: true }));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Не удалось загрузить новые товары.');
    } finally {
      setLoading(false);
    }
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
      </div>

      {message ? <p className="form-error">{message}</p> : null}

      {drafts.length > 0 ? (
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
