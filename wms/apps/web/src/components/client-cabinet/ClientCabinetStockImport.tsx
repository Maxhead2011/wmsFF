import { CheckCircle2, FileSearch, RotateCcw, UploadCloud } from 'lucide-react';
import { ChangeEvent, useRef, useState } from 'react';
import {
  commitStockImport,
  previewStockImport,
  type ClientSummary,
  type StockImportCommitResult,
  type StockImportPreview,
} from '../../lib/api';
import { StockCommitResultBlock, StockPreviewResult } from '../imports/ImportResultBlocks';

type ClientCabinetStockImportProps = {
  accessToken: string;
  client: ClientSummary;
  onImported: () => Promise<void>;
};

type BusyAction = 'preview' | 'commit' | null;

export function ClientCabinetStockImport({ accessToken, client, onImported }: ClientCabinetStockImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceDocument, setSourceDocument] = useState('');
  const [preview, setPreview] = useState<StockImportPreview | null>(null);
  const [commitResult, setCommitResult] = useState<StockImportCommitResult | null>(null);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function changeFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setPreview(null);
    setCommitResult(null);
    setError('');
    if (nextFile && !sourceDocument) {
      setSourceDocument(nextFile.name);
    }
  }

  function clearImport() {
    setFile(null);
    setSourceDocument('');
    setPreview(null);
    setCommitResult(null);
    setError('');
    setBusyAction(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function runPreview() {
    if (!file) {
      return;
    }

    setBusyAction('preview');
    setError('');
    setCommitResult(null);
    try {
      setPreview(await previewStockImport(accessToken, { file, clientId: client.id }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось проверить файл остатков.');
    } finally {
      setBusyAction(null);
    }
  }

  async function runCommit() {
    if (!file) {
      return;
    }

    setBusyAction('commit');
    setError('');
    try {
      setCommitResult(
        await commitStockImport(accessToken, {
          file,
          clientId: client.id,
          sourceDocument: sourceDocument.trim() || file.name,
        }),
      );
      await onImported();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить остатки.');
    } finally {
      setBusyAction(null);
    }
  }

  const hasErrors = Boolean(preview?.issues.some((issue) => issue.severity === 'error'));
  const isBusy = busyAction != null;
  const canSubmit = Boolean(file && !isBusy);

  return (
    <div className="client-cabinet-stock-import">
      <div className="client-cabinet-stock-import__heading">
        <div>
          <h3>Загрузка остатков</h3>
          <span>
            Клиент: {client.code} - {client.name}
          </span>
        </div>
      </div>
      <div className="client-cabinet-stock-import__fields">
        <label>
          <span>Документ-источник</span>
          <input value={sourceDocument} onChange={(event) => setSourceDocument(event.target.value)} />
        </label>
        <label className="client-cabinet-file-field">
          <UploadCloud size={18} aria-hidden="true" />
          <span>{file?.name ?? 'Выберите XLSX-файл остатков'}</span>
          <input ref={fileInputRef} accept=".xlsx,.xls" type="file" onChange={changeFile} />
        </label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="client-cabinet-stock-import__actions">
        <button className="primary-button" type="button" onClick={runPreview} disabled={!canSubmit}>
          <FileSearch size={16} aria-hidden="true" />
          <span>{busyAction === 'preview' ? 'Проверка' : 'Проверить'}</span>
        </button>
        <button className="primary-button secondary-action" type="button" onClick={runCommit} disabled={!canSubmit || hasErrors}>
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{busyAction === 'commit' ? 'Загрузка' : 'Записать в WMS'}</span>
        </button>
        <button
          className="primary-button import-clear-action"
          type="button"
          onClick={clearImport}
          disabled={isBusy || (!file && !preview && !commitResult && !error)}
        >
          <RotateCcw size={16} aria-hidden="true" />
          <span>Отменить / очистить</span>
        </button>
      </div>
      {preview ? <StockPreviewResult preview={preview} /> : null}
      {commitResult ? <StockCommitResultBlock result={commitResult} /> : null}
    </div>
  );
}
