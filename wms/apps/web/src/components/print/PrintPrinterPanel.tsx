import { PrintStationFormatPanel } from './PrintStationFormatPanel';
import { Network, RefreshCw, Save } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import {
  fetchPrintPrinters,
  upsertPrintPrinter,
  type AuthSession,
  type PrintPrinterConnectionType,
  type PrintPrinterSummary,
} from '../../lib/api';

type PrintPrinterPanelProps = {
  session: AuthSession;
};

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function PrintPrinterPanel({ session }: PrintPrinterPanelProps) {
  const [printers, setPrinters] = useState<PrintPrinterSummary[]>([]);
  const [code, setCode] = useState('TSC-01');
  const [groupCode, setGroupCode] = useState('DEFAULT');
  const [name, setName] = useState('TSC тестовый');
  const [connectionType, setConnectionType] = useState<PrintPrinterConnectionType>('dry_run');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9100');
  const [isActive, setActive] = useState(true);
  const [autoProcess, setAutoProcess] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [isSaving, setSaving] = useState(false);

  useEffect(() => {
    void loadPrinters();
  }, [session.accessToken]);

  async function loadPrinters() {
    setLoading(true);
    setError('');

    try {
      const list = await fetchPrintPrinters(session.accessToken);
      setPrinters(list);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить принтеры.');
    } finally {
      setLoading(false);
    }
  }

  async function savePrinter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const saved = await upsertPrintPrinter(session.accessToken, {
        code,
        groupCode,
        name,
        connectionType,
        host: connectionType === 'tcp' ? host.trim() : undefined,
        port: connectionType === 'tcp' ? parsePort(port) : undefined,
        isActive,
        autoProcess,
      });
      setPrinters((current) => [saved, ...current.filter((printer) => printer.id !== saved.id)]);
      setMessage(`Принтер ${saved.code} сохранен.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить принтер.');
    } finally {
      setSaving(false);
    }
  }

  function editPrinter(printer: PrintPrinterSummary) {
    setCode(printer.code);
    setGroupCode(printer.groupCode);
    setName(printer.name);
    setConnectionType(printer.connectionType);
    setHost(printer.host ?? '');
    setPort(printer.port ? String(printer.port) : '9100');
    setActive(printer.isActive);
    setAutoProcess(printer.autoProcess);
    setMessage('');
    setError('');
  }

  return (
    <div className="print-printer-layout">
      <PrintStationFormatPanel session={session} />
      <form className="print-form print-printer-form" onSubmit={savePrinter}>
        <div className="print-template-header">
          <div>
            <h3>Принтер</h3>
            <span>Тестовый режим для пилота, TCP для сетевого TSC</span>
          </div>
          <Network size={18} aria-hidden="true" />
        </div>

        <div className="print-fields print-fields--printer">
          <label>
            <span>Код</span>
            <input value={code} onChange={(event) => setCode(event.target.value)} required />
          </label>
          <label>
            <span>Группа</span>
            <input value={groupCode} onChange={(event) => setGroupCode(event.target.value)} required />
          </label>
          <label>
            <span>Название</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            <span>Подключение</span>
            <select value={connectionType} onChange={(event) => setConnectionType(event.target.value as PrintPrinterConnectionType)}>
              <option value="dry_run">Тестовый режим</option>
              <option value="tcp">TCP</option>
            </select>
          </label>
          <label>
            <span>Хост</span>
            <input value={host} onChange={(event) => setHost(event.target.value)} disabled={connectionType !== 'tcp'} />
          </label>
          <label>
            <span>Порт</span>
            <input min="1" max="65535" type="number" value={port} onChange={(event) => setPort(event.target.value)} disabled={connectionType !== 'tcp'} />
          </label>
        </div>

        <div className="print-switches">
          <label>
            <input type="checkbox" checked={isActive} onChange={(event) => setActive(event.target.checked)} />
            <span>Активен</span>
          </label>
          <label>
            <input type="checkbox" checked={autoProcess} onChange={(event) => setAutoProcess(event.target.checked)} />
            <span>Автообработка очереди</span>
          </label>
        </div>

        {(error || message) ? <p className={error ? 'form-error' : 'inline-status'}>{error || message}</p> : null}

        <div className="print-actions">
          <button className="primary-button" type="submit" disabled={isSaving}>
            <Save size={16} aria-hidden="true" />
            <span>{isSaving ? 'Сохраняю' : 'Сохранить принтер'}</span>
          </button>
          <button className="primary-button print-secondary" type="button" onClick={() => void loadPrinters()} disabled={isLoading}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Обновить</span>
          </button>
        </div>
      </form>

      <section className="print-printer-list" aria-label="Список принтеров">
        <div className="print-template-header">
          <div>
            <h3>Справочник</h3>
            <span>{printers.length} принтеров</span>
          </div>
        </div>

        {printers.length === 0 ? (
          <p className="panel-message">Принтеры еще не заведены.</p>
        ) : (
          <div className="print-job-items">
            {printers.map((printer) => (
              <button className="print-printer-card" key={printer.id} type="button" onClick={() => editPrinter(printer)}>
                <span className={`status status--${printer.isActive ? 'ready' : 'planned'}`}>
                  {printer.isActive ? 'активен' : 'отключен'}
                </span>
                <strong>{printer.code}</strong>
                <small>Группа {printer.groupCode}</small>
                <small>
                  {printer.name} · {printerConnectionLabel(printer.connectionType)}
                  {printer.host ? ` · ${printer.host}:${printer.port}` : ''}
                </small>
                <small>
                  {printer.autoProcess ? 'автоочередь' : 'ручной режим'} · последняя связь {formatLastSeen(printer.lastSeenAt)}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function parsePort(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 65535) : 9100;
}

function printerConnectionLabel(value: PrintPrinterConnectionType) {
  return value === 'dry_run' ? 'тестовый режим' : 'TCP';
}

function formatLastSeen(value: string | null) {
  return value ? dateTimeFormatter.format(new Date(value)) : '-';
}
