import { Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createArticleMapping,
  deleteArticleMapping,
  fetchArticleMappings,
  fetchClients,
  fetchSkus,
  importArticleMappingsXlsx,
  type ArticleMappingSummary,
  type AuthSession,
  type ClientSummary,
  type SkuSummary,
} from '../../lib/api';
import { RelabelReconciliationPanel } from './RelabelReconciliationPanel';
import { useRememberedClientId } from '../../lib/rememberedClient';

type ArticleMappingPanelProps = {
  session: AuthSession;
  enabledClientsOnly?: boolean;
  standalone?: boolean;
};

const emptyForm = {
  sourceArticle: '',
  targetArticle: '',
  comment: '',
};

export function ArticleMappingPanel({
  session,
  enabledClientsOnly = false,
  standalone = false,
}: ArticleMappingPanelProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useRememberedClientId(session.user.id);
  const [mappings, setMappings] = useState<ArticleMappingSummary[]>([]);
  const [availableSkus, setAvailableSkus] = useState<SkuSummary[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [areProductsLoading, setProductsLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
  const canEdit =
    session.user.permissionCodes.includes('system:admin') ||
    session.user.permissionCodes.includes('skus:write') ||
    session.user.writableClientIds.includes(clientId);
  const selectedSourceSku = useMemo(
    () => findSkuByReference(availableSkus, form.sourceArticle),
    [availableSkus, form.sourceArticle],
  );
  const selectedTargetSku = useMemo(
    () => findSkuByReference(availableSkus, form.targetArticle),
    [availableSkus, form.targetArticle],
  );

  useEffect(() => {
    let isActive = true;

    async function loadClients() {
      try {
        const loadedClients = await fetchClients(session.accessToken);
        const nextClients = enabledClientsOnly
          ? loadedClients.filter((client) => client.relabelingEnabled)
          : loadedClients;
        if (!isActive) {
          return;
        }
        setClients(nextClients);
        setClientId((current) => (nextClients.some((client) => client.id === current) ? current : nextClients[0]?.id ?? ''));
      } catch (caught) {
        if (isActive) {
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
        }
      }
    }

    void loadClients();

    return () => {
      isActive = false;
    };
  }, [enabledClientsOnly, session.accessToken]);

  useEffect(() => {
    if (!clientId) {
      setMappings([]);
      setAvailableSkus([]);
      return;
    }

    setForm(emptyForm);
    void Promise.all([loadMappings(clientId), loadProducts(clientId)]);
  }, [clientId]);

  async function loadMappings(nextClientId = clientId) {
    if (!nextClientId) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const list = await fetchArticleMappings(session.accessToken, nextClientId);
      setMappings(list);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить соответствия.');
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts(nextClientId = clientId) {
    if (!nextClientId) {
      return;
    }

    setProductsLoading(true);
    try {
      setAvailableSkus(
        await fetchSkus(session.accessToken, { clientId: nextClientId }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить товары клиента.');
    } finally {
      setProductsLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) {
      return;
    }
    if (
      normalizeProductReference(form.sourceArticle) ===
      normalizeProductReference(form.targetArticle)
    ) {
      setError('Исходный товар и товар после переклейки должны отличаться.');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      await createArticleMapping(session.accessToken, {
        clientId,
        sourceArticle: form.sourceArticle,
        targetArticle: form.targetArticle,
        comment: form.comment || undefined,
      });
      setForm(emptyForm);
      setMessage('Товар добавлен в таблицу переклейки.');
      await loadMappings(clientId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить соответствие.');
    } finally {
      setSubmitting(false);
    }
  }

  async function importFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId || !file) {
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const result = await importArticleMappingsXlsx(session.accessToken, { clientId, file });
      setFile(null);
      setMessage(`Импортировано: создано ${result.summary.created}, обновлено ${result.summary.updated}, ошибок ${result.summary.errors}.`);
      await loadMappings(clientId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось импортировать соответствия.');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMapping(mapping: ArticleMappingSummary) {
    if (!canEdit || !window.confirm(`Удалить соответствие «${mapping.sourceArticle} → ${mapping.targetArticle}»?`)) {
      return;
    }
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      await deleteArticleMapping(session.accessToken, mapping.id);
      setMessage('Соответствие удалено.');
      await loadMappings(clientId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить соответствие.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="directory-stack">
      <div className="directory-form">
        <div className="directory-subheading">
          <div>
            <h3>{standalone ? 'Соответствие' : 'Соответствия артикулов'}</h3>
            <span>
              Сотрудник берет физический товар «Где лежит», переклеивает его и сканирует новый ШК товара «Должно уехать».
            </span>
          </div>
          <button className="icon-text-button" type="button" onClick={() => void loadMappings()} disabled={isLoading || !clientId}>
            <RefreshCw size={15} aria-hidden="true" />
            <span>{isLoading ? 'Обновляю' : 'Обновить'}</span>
          </button>
        </div>

        {clients.length > 0 ? (
          <label className="directory-select-row">
            <span>Клиент</span>
            <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} - {client.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="form-info">
            Переклейка пока не включена ни для одного доступного клиента. Включите флаг «Возможна переклейка» в карточке клиента.
          </p>
        )}

        {canEdit && selectedClient ? (
          <div className="relabel-product-entry">
            <div className="relabel-product-entry__heading">
              <div>
                <strong>Добавить товар в переклейку</strong>
                <span>
                  Выберите товары из каталога клиента или введите артикул/ШК вручную.
                </span>
              </div>
              <em>
                {areProductsLoading
                  ? 'Загружаю товары…'
                  : `Доступно товаров: ${availableSkus.length}`}
              </em>
            </div>
            <form className="directory-fields relabel-product-form" onSubmit={submit}>
              <label>
                <span>Где лежит — исходный товар</span>
                <input
                  list="relabel-source-products"
                  placeholder="Артикул, SKU или ШК"
                  value={form.sourceArticle}
                  onChange={(event) => setForm({ ...form, sourceArticle: event.target.value })}
                  required
                />
                <small>{selectedSourceSku ? skuDescription(selectedSourceSku) : 'Физический товар на остатках WMS'}</small>
              </label>
              <label>
                <span>Должно уехать — товар после переклейки</span>
                <input
                  list="relabel-target-products"
                  placeholder="Артикул, SKU или ШК"
                  value={form.targetArticle}
                  onChange={(event) => setForm({ ...form, targetArticle: event.target.value })}
                  required
                />
                <small>{selectedTargetSku ? skuDescription(selectedTargetSku) : 'Товар, который указан в заказе WB'}</small>
              </label>
              <label>
                <span>Комментарий</span>
                <input
                  placeholder="Необязательно"
                  value={form.comment}
                  onChange={(event) => setForm({ ...form, comment: event.target.value })}
                />
              </label>
              <button className="primary-button directory-submit" type="submit" disabled={isSubmitting || !selectedClient}>
                <Plus size={16} aria-hidden="true" />
                <span>{isSubmitting ? 'Добавляю…' : 'Добавить товар'}</span>
              </button>
              <ProductOptions id="relabel-source-products" skus={availableSkus} />
              <ProductOptions id="relabel-target-products" skus={availableSkus} />
            </form>
          </div>
        ) : null}

        {canEdit && selectedClient ? <form className="directory-import-row" onSubmit={importFile}>
          <label className="directory-file-input">
            <Upload size={16} aria-hidden="true" />
            <span>{file ? file.name : 'Excel соответствий'}</span>
            <input accept=".xlsx,.xls" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <button className="directory-submit" disabled={isSubmitting || !file || !selectedClient} type="submit">
            Загрузить
          </button>
        </form> : null}

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <div className="client-table-scroll">
          <table className="client-directory-table">
            <thead>
              <tr>
                <th>Где лежит</th>
                <th>Должно уехать</th>
                <th>Комментарий</th>
                {canEdit ? <th aria-label="Действия" /> : null}
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => {
                const sourceSku = findSkuByReference(availableSkus, mapping.sourceArticle);
                const targetSku = findSkuByReference(availableSkus, mapping.targetArticle);
                return (
                <tr key={mapping.id}>
                  <td>
                    <strong>{mapping.sourceArticle}</strong>
                    {sourceSku ? <small className="relabel-product-summary">{skuDescription(sourceSku)}</small> : null}
                  </td>
                  <td>
                    <strong>{mapping.targetArticle}</strong>
                    {targetSku ? <small className="relabel-product-summary">{skuDescription(targetSku)}</small> : null}
                  </td>
                  <td>{mapping.comment || '-'}</td>
                  {canEdit ? (
                    <td>
                      <button
                        className="icon-button"
                        disabled={isSubmitting}
                        onClick={() => void removeMapping(mapping)}
                        title="Удалить соответствие"
                        type="button"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </td>
                  ) : null}
                </tr>
                );
              })}
              {mappings.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 4 : 3}>{isLoading ? 'Загрузка...' : 'Соответствия не найдены'}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {standalone && selectedClient ? (
          <RelabelReconciliationPanel
            session={session}
            clientId={selectedClient.id}
            canEdit={canEdit}
          />
        ) : null}
      </div>
    </div>
  );
}

function ProductOptions({ id, skus }: { id: string; skus: SkuSummary[] }) {
  return (
    <datalist id={id}>
      {skus.map((sku) => (
        <option
          key={sku.id}
          value={preferredSkuReference(sku)}
          label={skuDescription(sku)}
        />
      ))}
    </datalist>
  );
}

function preferredSkuReference(sku: SkuSummary) {
  return sku.article?.trim() || sku.clientSku?.trim() || sku.internalSku.trim();
}

function findSkuByReference(skus: SkuSummary[], value: string) {
  const normalized = normalizeProductReference(value);
  if (!normalized) {
    return null;
  }
  return skus.find((sku) =>
    [
      sku.article,
      sku.clientSku,
      sku.internalSku,
      ...sku.barcodes.map((barcode) => barcode.value),
    ].some((candidate) => normalizeProductReference(candidate ?? '') === normalized),
  ) ?? null;
}

function normalizeProductReference(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function skuDescription(sku: SkuSummary) {
  const barcode = sku.barcodes.find((item) => item.isPrimary)?.value
    ?? sku.barcodes[0]?.value;
  return [
    sku.name,
    sku.color,
    sku.size ? `размер ${sku.size}` : null,
    barcode ? `ШК ${barcode}` : null,
  ].filter(Boolean).join(' · ');
}
