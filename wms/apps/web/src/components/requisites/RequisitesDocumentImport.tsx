import { AlertTriangle, CheckCircle2, FileSpreadsheet, LoaderCircle, UploadCloud } from 'lucide-react';
import { useId, useState, type ChangeEvent } from 'react';
import {
  parseRequisitesDocument,
  type RequisitesDocumentFields,
  type RequisitesDocumentResult,
} from '../../lib/api';
import './requisites-document-import.css';

type RequisitesDocumentImportProps = {
  accessToken: string;
  target: 'own-company' | 'client';
  disabled?: boolean;
  onImported: (fields: RequisitesDocumentFields) => void;
};

export function RequisitesDocumentImport({
  accessToken,
  target,
  disabled = false,
  onImported,
}: RequisitesDocumentImportProps) {
  const inputId = useId();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<RequisitesDocumentResult | null>(null);
  const [error, setError] = useState('');

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setStatus('loading');
    setResult(null);
    setError('');
    try {
      const parsed = await parseRequisitesDocument(accessToken, target, file);
      onImported(parsed.fields);
      setResult(parsed);
      setStatus('success');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось распознать реквизиты.');
      setStatus('error');
    }
  }

  return (
    <section className={`requisites-import requisites-import--${status}`} aria-label="Импорт реквизитов из документа">
      <div className="requisites-import__icon" aria-hidden="true">
        {status === 'loading' ? <LoaderCircle className="requisites-import__spinner" size={22} /> : <UploadCloud size={22} />}
      </div>
      <div className="requisites-import__body">
        <strong>Заполнить реквизиты из файла</strong>
        <span>Загрузите PDF, XLS или XLSX — найденные данные автоматически появятся в полях ниже.</span>
        {status === 'success' && result ? (
          <p className="requisites-import__result">
            <CheckCircle2 size={15} aria-hidden="true" />
            <span>
              {result.fileName}: заполнено полей — {result.recognizedFields.length}. Проверьте их и сохраните карточку.
            </span>
          </p>
        ) : null}
        {status === 'error' ? (
          <p className="requisites-import__error">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
        {result?.warnings.length ? (
          <p className="requisites-import__warning">{result.warnings.join(' ')}</p>
        ) : null}
      </div>
      <label className="requisites-import__button" htmlFor={inputId} aria-disabled={disabled || status === 'loading'}>
        <FileSpreadsheet size={16} aria-hidden="true" />
        <span>{status === 'loading' ? 'Распознаю…' : 'Выбрать файл'}</span>
      </label>
      <input
        className="requisites-import__input"
        id={inputId}
        type="file"
        accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={disabled || status === 'loading'}
        onChange={(event) => void selectFile(event)}
      />
    </section>
  );
}
