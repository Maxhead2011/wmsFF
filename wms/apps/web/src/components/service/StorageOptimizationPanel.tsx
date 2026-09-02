import { ArrowRight, Boxes, Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  fetchServiceStorageOptimization,
  downloadServiceStorageOptimization,
  type ServiceStorageOptimizationReport,
} from '../../lib/api';
import './storage-optimization.css';

type StorageOptimizationPanelProps = {
  accessToken: string;
  clientId: string;
  clientName: string;
};

export function StorageOptimizationPanel({ accessToken, clientId, clientName }: StorageOptimizationPanelProps) {
  const [report, setReport] = useState<ServiceStorageOptimizationReport | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setReport(null);
    setError('');
  }, [clientId]);

  async function generateReport() {
    if (!clientId || isLoading) return;
    setLoading(true);
    setError('');
    try {
      const [nextReport, file] = await Promise.all([
        fetchServiceStorageOptimization(accessToken, clientId),
        downloadServiceStorageOptimization(accessToken, clientId),
      ]);
      setReport(nextReport);
      // FIX: one click forms the read-only report and downloads the real XLSX.
      downloadBlob(file, `Оптимизация_хранения_${safeFileName(clientName)}_${dateStamp()}.xlsx`);
    } catch (caught) {
      setReport(null);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="service-section storage-optimization" aria-label="Оптимизация хранения">
      <div className="service-section__heading">
        <Boxes size={18} aria-hidden="true" />
        <div>
          <h3>Оптимизация хранения</h3>
          <p className="service-help">
            Сначала один ШК в коробе, затем один артикул разных размеров. Целевое заполнение — 16–20 единиц.
          </p>
        </div>
      </div>

      <div className="storage-optimization__toolbar">
        <div>
          <strong>{clientName || 'Клиент не выбран'}</strong>
          <span>Отчёт рекомендательный: остатки, короба и паллетсорты автоматически не изменяются.</span>
        </div>
        <button className="primary-button" type="button" onClick={() => void generateReport()} disabled={!clientId || isLoading}>
          {isLoading
            ? <RefreshCw size={16} aria-hidden="true" className="is-spinning" />
            : <Download size={16} aria-hidden="true" />}
          {isLoading ? 'Анализирую остатки…' : report ? 'Сформировать Excel заново' : 'Сформировать отчёт Excel'}
        </button>
      </div>

      {error ? <div className="service-message service-message--error">{error}</div> : null}

      {report ? (
        <>
          <div className="storage-optimization__metrics">
            <Metric label="Единиц в анализе" value={report.summary.totalUnits} />
            <Metric label="Исходных коробов" value={report.summary.sourceBoxes} />
            <Metric label="Целевых коробов" value={report.summary.targetBoxes} />
            <Metric label="Идеально заполнено" value={report.summary.idealTargetBoxes} />
            <Metric label="Исключено из рекомендаций" value={report.summary.excludedUnits} />
            <Metric label="Нужно переложить" value={report.summary.movementUnits} />
            <Metric label="Целевых паллетсортов" value={report.summary.targetPalletSorts} />
            <Metric label="Паллетсортов 16–20 коробов" value={report.summary.idealTargetPalletSorts} />
          </div>

          <div className="storage-optimization__meta">
            Сформировано: {formatDateTime(report.generatedAt)}. Строк: {report.rows.length}.
          </div>

          <div className="service-table-wrap storage-optimization__table-wrap">
            <table className="data-table service-table storage-optimization__table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Исходный паллетсорт</th>
                  <th>Исходный короб</th>
                  <th>Кол-во</th>
                  <th></th>
                  <th>Предложенный короб</th>
                  <th>Предложенный паллетсорт</th>
                  <th>Приоритет</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, index) => (
                  <tr className={row.action === 'KEEP' ? 'is-keep' : ''} key={`${row.sourceBox}:${row.skuId}:${row.destinationBox}:${index}`}>
                    <td>
                      <strong>{row.productName}</strong>
                      <span>{row.article || 'Без артикула'} · {row.color || 'Без цвета'} · {row.size || 'Без размера'}</span>
                      <span>ШК: {row.barcode || 'не указан'} · {row.warehouseName}</span>
                    </td>
                    <td>{row.sourcePalletSort || 'Вне паллетсорта'}</td>
                    <td><strong>{row.sourceBox}</strong></td>
                    <td>{row.quantity}</td>
                    <td><ArrowRight size={16} aria-label="переместить в" /></td>
                    <td>
                      <strong>{row.destinationBox}</strong>
                      <span>{row.action === 'KEEP' ? 'Оставить в этом коробе' : 'Переместить'}</span>
                    </td>
                    <td>{row.destinationPalletSort}</td>
                    <td>{row.strategy === 'BARCODE' ? '1 короб = 1 ШК' : '1 короб = 1 артикул'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.rows.length === 0 ? <p className="panel-message">Нет доступных положительных остатков в коробах.</p> : null}
        </>
      ) : (
        <p className="panel-message">Выберите клиента и нажмите «Сформировать отчёт».</p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="service-metric">
      <span>{label}</span>
      <strong>{value.toLocaleString('ru-RU')}</strong>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось сформировать отчёт.';
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9А-Яа-я_-]+/g, '_').replace(/^_+|_+$/g, '') || 'client';
}

function dateStamp() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}
