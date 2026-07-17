import { CheckCircle2, FileSearch, RotateCcw, UploadCloud } from 'lucide-react';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  commitStockImport,
  fetchClients,
  previewStockImport,
  type AuthSession,
  type ClientSummary,
  type StockImportCommitResult,
  type StockImportPreview,
} from '../../lib/api';
import { StockCommitResultBlock, StockPreviewResult } from './ImportResultBlocks';

type StockImportFormProps = {
  session: AuthSession;
};

type BusyAction = 'preview' | 'commit' | null;

export function StockImportForm({ session }: StockImportFormProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientsError, setClientsError] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sourceDocument, setSourceDocument] = useState('');
  const [preview, setPreview] = useState<StockImportPreview | null>(null);
  const [commitResult, setCommitResult] = useState<StockImportCommitResult | null>(null);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadClients() {
      try {
        const list = await fetchClients(session.accessToken);
        if (!isActive) {
          return;
        }

        setClients(list);
        setSelectedClientId((current) => current || list[0]?.id || '');
      } catch (caught) {
        if (isActive) {
          setClientsError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
        }
      }
    }

    void loadClients();

    return () => {
      isActive = false;
    };
  }, [session.accessToken]);

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

  function changeClient(clientId: string) {
    setSelectedClientId(clientId);
    setPreview(null);
    setCommitResult(null);
    setError('');
  }

  async function runPreview() {
    if (!file || !selectedClientId) {
      return;
    }

    setBusyAction('preview');
    setError('');
    setCommitResult(null);

    try {
      setPreview(await previewStockImport(session.accessToken, { file, clientId: selectedClientId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось проверить файл остатков.');
    } finally {
      setBusyAction(null);
    }
  }

  async function runCommit() {
    if (!file || !selectedClientId) {
      return;
    }

    setBusyAction('commit');
    setError('');

    try {
      setCommitResult(
        await commitStockImport(session.accessToken, {
          file,
          clientId: selectedClientId,
          sourceDocument: sourceDocument.trim() || file.name,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить остатки.');
    } finally {
      setBusyAction(null);
    }
  }

  const hasErrors = Boolean(preview?.issues.some((issue) => issue.severity === 'error'));
  const isBusy = busyAction != null;
  const canSubmit = Boolean(file && selectedClientId && !isBusy);

  return (
    <div className="import-form">
      <div className="import-fields">
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
          <span>Документ-источник</span>
          <input value={sourceDocument} onChange={(event) => setSourceDocument(event.target.value)} />
        </label>

        <label className="file-field">
          <UploadCloud size={18} aria-hidden="true" />
          <span>{file?.name ?? 'Выберите XLSX-файл остатков'}</span>
          <input ref={fileInputRef} accept=".xlsx,.xls" type="file" onChange={changeFile} />
        </label>
      </div>

      {clientsError ? <p className="form-error">{clientsError}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="import-actions">
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
