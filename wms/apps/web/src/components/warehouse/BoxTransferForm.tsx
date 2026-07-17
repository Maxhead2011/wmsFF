import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  RefreshCw,
  SendHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  commitBoxTransfersXlsx,
  downloadBoxTransferBatchFile,
  fetchBoxTransferBatches,
  fetchBoxes,
  fetchClients,
  fetchStockBalances,
  previewBoxTransfersXlsx,
  reverseBoxTransferBatch,
  transferBetweenBoxes,
  type AuthSession,
  type BoxTransferPreview,
  type BoxTransferPreviewRow,
  type ClientSummary,
  type StockBalance,
  type StockTransferBatch,
  type TransferBetweenBoxesResult,
  type WarehouseBoxSummary,
} from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { TransferPreview, TransferResult } from './TransferStatusBlocks';

type BoxTransferFormProps = {
  session: AuthSession;
};

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function BoxTransferForm({ session }: BoxTransferFormProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [boxes, setBoxes] = useState<WarehouseBoxSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedBalanceId, setSelectedBalanceId] = useState('');
  const [toBoxCode, setToBoxCode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [comment, setComment] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<TransferBetweenBoxesResult | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<BoxTransferPreview | null>(null);
  const [isPreviewing, setPreviewing] = useState(false);
  const [isCommitting, setCommitting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [batches, setBatches] = useState<StockTransferBatch[]>([]);
  const [isLoadingBatches, setLoadingBatches] = useState(false);
  const [expandedBatchIds, setExpandedBatchIds] = useState<string[]>([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingBatches, setDeletingBatches] = useState(false);

  const selectedBalance = useMemo(
    () => balances.find((balance) => balance.id === selectedBalanceId) ?? null,
    [balances, selectedBalanceId],
  );
  const sourceBalances = balances.filter((balance) => balance.box?.code && balance.quantity > 0);
  const canDeleteBatches =
    session.user.permissionCodes.includes('system:admin') ||
    session.user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');

  useEffect(() => {
    void loadClients();
  }, [session.accessToken]);

  useEffect(() => {
    if (selectedClientId) {
      void loadOperationalData(selectedClientId);
      void loadTransferBatches(selectedClientId);
    }
  }, [selectedClientId]);

  async function loadClients() {
    setLoadState('loading');
    setError('');

    try {
      const list = await fetchClients(session.accessToken);
      setClients(list);
      setSelectedClientId((current) => current || list[0]?.id || '');
      if (list.length === 0) {
        setLoadState('ready');
      }
    } catch (caught) {
      setLoadState('error');
      setError(errorMessage(caught));
    }
  }

  async function loadOperationalData(clientId = selectedClientId) {
    if (!clientId) {
      return;
    }

    setLoadState('loading');
    setError('');
    setResult(null);

    try {
      const [nextBalances, nextBoxes] = await Promise.all([
        fetchStockBalances(session.accessToken, { clientId }),
        fetchBoxes(session.accessToken, { clientId }),
      ]);
      setBalances(nextBalances);
      setBoxes(nextBoxes);
      setSelectedBalanceId((current) => keepSelectedBalance(current, nextBalances));
      setLoadState('ready');
    } catch (caught) {
      setLoadState('error');
      setError(errorMessage(caught));
    }
  }

  async function loadTransferBatches(clientId = selectedClientId) {
    if (!clientId) {
      setBatches([]);
      return;
    }

    setLoadingBatches(true);
    try {
      const nextBatches = await fetchBoxTransferBatches(session.accessToken, clientId);
      setBatches(nextBatches);
      setSelectedBatchIds((current) =>
        current.filter((id) => nextBatches.some((batch) => batch.id === id && batch.status !== 'REVERSED')),
      );
      setExpandedBatchIds((current) => current.filter((id) => nextBatches.some((batch) => batch.id === id)));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoadingBatches(false);
    }
  }

  function changeClient(clientId: string) {
    setSelectedClientId(clientId);
    setSelectedBalanceId('');
    setToBoxCode('');
    setQuantity('1');
    setComment('');
    setResult(null);
    setImportFile(null);
    setImportPreview(null);
    setImportMessage('');
    setBatches([]);
    setSelectedBatchIds([]);
    setExpandedBatchIds([]);
  }

  function changeBalance(balanceId: string) {
    const balance = balances.find((item) => item.id === balanceId);
    setSelectedBalanceId(balanceId);
    setQuantity(balance ? String(Math.min(balance.quantity, Number(quantity) || 1)) : '1');
    setResult(null);
  }

  async function submitTransfer() {
    if (!selectedBalance?.box?.code || !selectedClientId) {
      return;
    }

    setSubmitting(true);
    setError('');
    setResult(null);

    try {
      const parsedQuantity = Number(quantity);
      const transfer = await transferBetweenBoxes(session.accessToken, {
        clientId: selectedClientId,
        skuId: selectedBalance.skuId,
        fromBoxCode: selectedBalance.box.code,
        toBoxCode: toBoxCode.trim(),
        quantity: parsedQuantity,
        status: selectedBalance.status,
        idempotencyKey: buildIdempotencyKey(selectedBalance.id),
        comment: comment.trim() || undefined,
      });
      setResult(transfer);
      await loadOperationalData(selectedClientId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function previewTransfers(file: File | null) {
    if (!file || !selectedClientId) {
      return;
    }

    setPreviewing(true);
    setImportFile(file);
    setImportPreview(null);
    setImportMessage('');
    setError('');
    setResult(null);

    try {
      const preview = await previewBoxTransfersXlsx(session.accessToken, selectedClientId, file);
      setImportPreview(preview);
      setImportMessage(
        `Проверено ${preview.summary.rows} строк: можно выполнить ${preview.summary.readyRows}, с ошибками ${preview.summary.errorRows}.`,
      );
    } catch (caught) {
      setImportFile(null);
      setError(errorMessage(caught));
    } finally {
      setPreviewing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function commitTransfers() {
    if (!importFile || !selectedClientId || !importPreview?.summary.readyRows) {
      return;
    }

    setCommitting(true);
    setError('');
    try {
      const response = await commitBoxTransfersXlsx(session.accessToken, selectedClientId, importFile);
      setImportPreview(response.preview);
      setImportFile(null);
      setImportMessage(
        `Файл применен: строк ${response.rows}, перемещено ${response.quantity} шт.` +
          (response.preview.summary.errorRows ? ` Не выполнено строк: ${response.preview.summary.errorRows}.` : ''),
      );
      await Promise.all([loadOperationalData(selectedClientId), loadTransferBatches(selectedClientId)]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCommitting(false);
    }
  }

  async function downloadBatch(batch: StockTransferBatch) {
    setError('');
    try {
      const blob = await downloadBoxTransferBatchFile(session.accessToken, batch.id);
      downloadBlob(blob, batch.fileName);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function deleteSelectedBatches() {
    if (!selectedBatchIds.length) {
      return;
    }

    setDeletingBatches(true);
    setError('');
    const errors: string[] = [];
    for (const batchId of selectedBatchIds) {
      try {
        await reverseBoxTransferBatch(session.accessToken, batchId);
      } catch (caught) {
        const batch = batches.find((item) => item.id === batchId);
        errors.push(`${batch?.fileName ?? batchId}: ${errorMessage(caught)}`);
      }
    }

    setShowDeleteConfirm(false);
    setSelectedBatchIds([]);
    await Promise.all([loadOperationalData(selectedClientId), loadTransferBatches(selectedClientId)]);
    setDeletingBatches(false);
    setImportMessage(
      errors.length
        ? `Удалены не все файлы: ${errors.slice(0, 3).join('; ')}`
        : 'Выбранные перемещения отменены, остатки возвращены в исходные короба.',
    );
  }

  const parsedQuantity = Number(quantity);
  const hasValidQuantity =
    Number.isInteger(parsedQuantity) && parsedQuantity > 0 && (!selectedBalance || parsedQuantity <= selectedBalance.quantity);
  const canSubmit =
    Boolean(selectedBalance?.box?.code && toBoxCode.trim()) && hasValidQuantity && loadState !== 'loading' && !isSubmitting;

  return (
    <div className="box-transfer">
      <div className="warehouse-fields">
        <label>
          <span>Клиент</span>
          <select value={selectedClientId} onChange={(event) => changeClient(event.target.value)}>
            {clients.length === 0 ? <option value="">Клиенты не найдены</option> : null}
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code} - {client.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Исходный остаток</span>
          <select value={selectedBalanceId} onChange={(event) => changeBalance(event.target.value)}>
            {sourceBalances.length === 0 ? <option value="">Остатков в коробах нет</option> : null}
            {sourceBalances.map((balance) => (
              <option key={balance.id} value={balance.id}>
                {balance.box?.code} - {balance.sku.internalSku} - {balance.quantity} шт.
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Целевой короб</span>
          <input
            list="warehouse-boxes"
            placeholder="Например FFL_BOX_002"
            value={toBoxCode}
            onChange={(event) => setToBoxCode(event.target.value)}
          />
          <datalist id="warehouse-boxes">
            {boxes.map((box) => (
              <option key={box.id} value={box.code} />
            ))}
          </datalist>
        </label>

        <label>
          <span>Количество</span>
          <input
            min="1"
            max={selectedBalance?.quantity ?? undefined}
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
      </div>

      <label className="warehouse-comment">
        <span>Комментарий</span>
        <input value={comment} onChange={(event) => setComment(event.target.value)} />
      </label>

      {selectedBalance ? <TransferPreview balance={selectedBalance} toBoxCode={toBoxCode} /> : null}

      <div className="warehouse-import-strip">
        <div>
          <strong>Перемещения из Excel</strong>
          <span>Сначала файл проверяется. Остатки изменятся только после подтверждения допустимых строк.</span>
        </div>
        <input
          ref={fileInputRef}
          accept=".xlsx,.xls"
          hidden
          type="file"
          onChange={(event) => void previewTransfers(event.target.files?.[0] ?? null)}
        />
        <button
          className="secondary-button"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!selectedClientId || isPreviewing || isCommitting}
        >
          <FileSpreadsheet size={16} aria-hidden="true" />
          <span>{isPreviewing ? 'Проверяю Excel' : 'Выбрать и проверить'}</span>
        </button>
      </div>

      {importPreview ? (
        <TransferImportPreviewPanel
          preview={importPreview}
          canCommit={Boolean(importFile && importPreview.summary.readyRows > 0)}
          isCommitting={isCommitting}
          onCommit={() => void commitTransfers()}
        />
      ) : null}

      {importMessage ? <p className="warehouse-inline">{importMessage}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {loadState === 'loading' ? <p className="warehouse-inline">Обновляю складские данные.</p> : null}

      <div className="warehouse-actions">
        <button className="primary-button" type="button" onClick={() => void submitTransfer()} disabled={!canSubmit}>
          <SendHorizontal size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Перенос' : 'Перенести вручную'}</span>
        </button>
        <button
          className="primary-button warehouse-secondary"
          type="button"
          onClick={() => void Promise.all([loadOperationalData(), loadTransferBatches()])}
          disabled={!selectedClientId || loadState === 'loading' || isLoadingBatches}
        >
          <RefreshCw size={16} aria-hidden="true" />
          <span>Обновить</span>
        </button>
      </div>

      {result ? <TransferResult result={result} /> : null}

      <TransferBatchHistory
        batches={batches}
        canDelete={canDeleteBatches}
        expandedIds={expandedBatchIds}
        isLoading={isLoadingBatches}
        selectedIds={selectedBatchIds}
        onDelete={() => setShowDeleteConfirm(true)}
        onDownload={(batch) => void downloadBatch(batch)}
        onRefresh={() => void loadTransferBatches()}
        onToggleExpanded={(id) =>
          setExpandedBatchIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
          )
        }
        onToggleSelected={(id) =>
          setSelectedBatchIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
          )
        }
        onToggleAll={(ids) => setSelectedBatchIds(ids)}
      />

      {showDeleteConfirm ? (
        <ConfirmDialog
          title="Удалить выбранные перемещения?"
          message="Система выполнит обратные перемещения и вернет товар в исходные короба. Если товар уже перемещен дальше или списан, удаление будет остановлено."
          details={selectedBatchIds.map((id) => batches.find((batch) => batch.id === id)?.fileName ?? id)}
          confirmLabel="Удалить и вернуть остатки"
          isBusy={isDeletingBatches}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={() => void deleteSelectedBatches()}
        />
      ) : null}
    </div>
  );
}

function TransferImportPreviewPanel({
  canCommit,
  isCommitting,
  onCommit,
  preview,
}: {
  canCommit: boolean;
  isCommitting: boolean;
  onCommit: () => void;
  preview: BoxTransferPreview;
}) {
  return (
    <section className="transfer-file-preview" aria-label="Проверка файла перемещений">
      <header className="transfer-file-preview__header">
        <div>
          <strong>{preview.fileName}</strong>
          <span>
            Строк: {preview.summary.rows} · можно: {preview.summary.readyRows} · ошибки: {preview.summary.errorRows} · количество:{' '}
            {preview.summary.quantity}
          </span>
        </div>
        <button className="primary-button" type="button" onClick={onCommit} disabled={!canCommit || isCommitting}>
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{isCommitting ? 'Выполняю' : `Выполнить ${preview.summary.readyRows} строк`}</span>
        </button>
      </header>
      <TransferRowsTable rows={preview.rows} />
    </section>
  );
}

function TransferBatchHistory({
  batches,
  canDelete,
  expandedIds,
  isLoading,
  onDelete,
  onDownload,
  onRefresh,
  onToggleAll,
  onToggleExpanded,
  onToggleSelected,
  selectedIds,
}: {
  batches: StockTransferBatch[];
  canDelete: boolean;
  expandedIds: string[];
  isLoading: boolean;
  onDelete: () => void;
  onDownload: (batch: StockTransferBatch) => void;
  onRefresh: () => void;
  onToggleAll: (ids: string[]) => void;
  onToggleExpanded: (id: string) => void;
  onToggleSelected: (id: string) => void;
  selectedIds: string[];
}) {
  const deletableIds = batches.filter((batch) => batch.status !== 'REVERSED').map((batch) => batch.id);
  const allSelected = deletableIds.length > 0 && deletableIds.every((id) => selectedIds.includes(id));

  return (
    <section className="transfer-history" aria-label="История файлов перемещений">
      <header className="transfer-history__header">
        <div>
          <strong>Файлы и история перемещений</strong>
          <span>Исходные Excel, выполненные строки, ошибки и отмененные пакеты выбранного клиента.</span>
        </div>
        <div className="transfer-history__actions">
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>{isLoading ? 'Обновляю' : 'Обновить историю'}</span>
          </button>
          {canDelete ? (
            <button className="danger-button" type="button" onClick={onDelete} disabled={!selectedIds.length}>
              <Trash2 size={16} aria-hidden="true" />
              <span>Удалить выбранные ({selectedIds.length})</span>
            </button>
          ) : null}
        </div>
      </header>

      {batches.length === 0 ? (
        <p className="warehouse-inline">Для клиента еще нет файлов перемещений.</p>
      ) : (
        <div className="transfer-history__table-wrap">
          <table className="transfer-history__table">
            <thead>
              <tr>
                <th>
                  {canDelete ? (
                    <input
                      aria-label="Выбрать все файлы перемещений"
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => onToggleAll(allSelected ? [] : deletableIds)}
                    />
                  ) : null}
                </th>
                <th>Файл</th>
                <th>Дата</th>
                <th>Оператор</th>
                <th>Статус</th>
                <th>Строки</th>
                <th>Количество</th>
                <th>Операции</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => {
                const expanded = expandedIds.includes(batch.id);
                return (
                  <Fragment key={batch.id}>
                    <tr className={batch.status === 'REVERSED' ? 'transfer-history__row--reversed' : undefined}>
                      <td>
                        {canDelete ? (
                          <input
                            aria-label={`Выбрать ${batch.fileName}`}
                            type="checkbox"
                            checked={selectedIds.includes(batch.id)}
                            disabled={batch.status === 'REVERSED'}
                            onChange={() => onToggleSelected(batch.id)}
                          />
                        ) : null}
                      </td>
                      <td>
                        <button className="transfer-history__file" type="button" onClick={() => onToggleExpanded(batch.id)}>
                          <FileSpreadsheet size={15} aria-hidden="true" />
                          <span>{batch.fileName}</span>
                        </button>
                        <small>{formatFileSize(batch.sizeBytes)}</small>
                      </td>
                      <td>{formatDateTime(batch.createdAt)}</td>
                      <td>{batch.uploadedByName || '-'}</td>
                      <td><span className={`transfer-batch-status transfer-batch-status--${batch.status.toLowerCase()}`}>{batchStatusLabel(batch.status)}</span></td>
                      <td>{batch.appliedRowCount} / {batch.rowCount}{batch.rejectedRowCount ? ` · ошибок ${batch.rejectedRowCount}` : ''}</td>
                      <td>{batch.quantity} шт.</td>
                      <td>
                        <div className="transfer-history__row-actions">
                          <button className="icon-button" type="button" onClick={() => onDownload(batch)} title="Скачать исходный Excel">
                            <Download size={16} aria-hidden="true" />
                          </button>
                          <button className="icon-button" type="button" onClick={() => onToggleExpanded(batch.id)} title="Показать строки">
                            {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="transfer-history__details-row">
                        <td colSpan={8}>
                          {batch.status === 'REVERSED' ? (
                            <p className="transfer-history__reversed-note">
                              Перемещения отменены {batch.reversedAt ? formatDateTime(batch.reversedAt) : ''}
                              {batch.reversedByName ? `, оператор: ${batch.reversedByName}` : ''}.
                            </p>
                          ) : null}
                          <TransferRowsTable rows={batch.rows} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TransferRowsTable({ rows }: { rows: BoxTransferPreviewRow[] }) {
  return (
    <div className="transfer-rows-table-wrap">
      <table className="transfer-rows-table">
        <thead>
          <tr>
            <th>Строка</th>
            <th>Результат</th>
            <th>Откуда</th>
            <th>Товар</th>
            <th>Куда</th>
            <th>Количество</th>
            <th>Доступно</th>
            <th>Пояснение</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const successful = row.status === 'READY' || row.status === 'APPLIED';
            return (
              <tr className={successful ? 'transfer-row--ready' : 'transfer-row--error'} key={`${row.rowNumber}:${row.fromBoxCode}:${row.barcode}`}>
                <td>{row.rowNumber}</td>
                <td>
                  <span className={`transfer-row-status ${successful ? 'transfer-row-status--ready' : 'transfer-row-status--error'}`}>
                    {successful ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
                    {transferRowStatusLabel(row.status)}
                  </span>
                </td>
                <td>{row.fromBoxCode || '-'}</td>
                <td>
                  <strong>{row.skuName || row.internalSku || row.barcode || '-'}</strong>
                  <span>{row.barcode || '-'}</span>
                </td>
                <td>{row.toBoxCode || '-'}</td>
                <td>{row.quantity || '-'}</td>
                <td>{row.availableQuantity}</td>
                <td>
                  <span className="transfer-row-message">
                    {!successful ? <AlertTriangle size={14} aria-hidden="true" /> : null}
                    {row.message}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function keepSelectedBalance(current: string, balances: StockBalance[]) {
  if (balances.some((balance) => balance.id === current && balance.quantity > 0)) {
    return current;
  }

  return balances.find((balance) => balance.box?.code && balance.quantity > 0)?.id ?? '';
}

function buildIdempotencyKey(balanceId: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
  return `web-transfer:${balanceId}:${random}`;
}

function transferRowStatusLabel(status: BoxTransferPreviewRow['status']) {
  if (status === 'READY') return 'Можно';
  if (status === 'APPLIED') return 'Выполнено';
  if (status === 'REJECTED') return 'Не выполнено';
  return 'Ошибка';
}

function batchStatusLabel(status: StockTransferBatch['status']) {
  if (status === 'APPLIED') return 'Выполнен';
  if (status === 'APPLIED_WITH_ERRORS') return 'Выполнен частично';
  if (status === 'REVERSED') return 'Отменен';
  return status;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} Б`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} КБ`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} МБ`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить складскую операцию.';
}
