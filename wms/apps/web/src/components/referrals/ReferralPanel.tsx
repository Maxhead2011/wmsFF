import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchReferralReport, type AuthSession, type ReferralReport } from '../../lib/api';
import './referrals.css';

type LoadState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: ReferralReport | null;
  error?: string;
};

export function ReferralPanel({ session }: { session: AuthSession }) {
  const [periodFrom, setPeriodFrom] = useState(() => monthStartInputValue(new Date()));
  const [periodTo, setPeriodTo] = useState(() => dateInputValue(new Date()));
  const [report, setReport] = useState<LoadState>({ status: 'idle', data: null });

  useEffect(() => {
    void loadReport();
  }, []);

  async function loadReport() {
    setReport((current) => ({ ...current, status: 'loading', error: undefined }));

    try {
      setReport({
        status: 'ready',
        data: await fetchReferralReport(session.accessToken, {
          periodFrom: periodFrom || undefined,
          periodTo: periodTo || undefined,
        }),
      });
    } catch (caught) {
      setReport({ status: 'error', data: null, error: errorMessage(caught) });
    }
  }

  const totals = report.data?.totals;

  return (
    <div className="referral-workspace">
      <section className="referral-panel referral-panel--filters" aria-label="Фильтр реферальной программы">
        <label>
          <span>Период с</span>
          <input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
        </label>
        <label>
          <span>Период по</span>
          <input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
        </label>
        <button className="primary-button" type="button" onClick={() => void loadReport()} disabled={report.status === 'loading'}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{report.status === 'loading' ? 'Обновляю' : 'Показать'}</span>
        </button>
      </section>

      {report.error ? <p className="form-error">{report.error}</p> : null}

      <section className="referral-summary" aria-label="Итоги реферальной программы">
        <article>
          <span>Клиентов</span>
          <strong>{formatNumber(totals?.clientsCount ?? 0)}</strong>
        </article>
        <article>
          <span>Услуг ФФ</span>
          <strong>{formatMoney(totals?.servicesRub ?? 0)}</strong>
        </article>
        <article>
          <span>Рефералка</span>
          <strong>{formatMoney(totals?.referralRub ?? 0)}</strong>
        </article>
        <article>
          <span>Начислений</span>
          <strong>{formatNumber(totals?.chargesCount ?? 0)}</strong>
        </article>
      </section>

      {report.status === 'loading' ? <p className="inline-status">Загружаю реферальные начисления.</p> : null}

      {report.data && report.data.clients.length === 0 ? (
        <section className="referral-panel">
          <p className="referral-empty">Администратор еще не назначил клиентов или срок действия назначений закончился.</p>
        </section>
      ) : null}

      <section className="referral-client-grid" aria-label="Клиенты реферальной программы">
        {report.data?.clients.map((client) => (
          <article className="referral-client-card" key={client.client.id}>
            <header>
              <div>
                <span>{client.percent}%</span>
                <h3>{client.client.name}</h3>
              </div>
              <small>{periodLabel(client.startsAt, client.expiresAt)}</small>
            </header>

            <div className="referral-client-card__metrics">
              <span>
                База услуг
                <strong>{formatMoney(client.servicesRub)}</strong>
              </span>
              <span>
                К выплате
                <strong>{formatMoney(client.referralRub)}</strong>
              </span>
              <span>
                Начислений
                <strong>{formatNumber(client.chargesCount)}</strong>
              </span>
              <span>
                Последняя услуга
                <strong>{client.latestServiceAt ? formatDate(client.latestServiceAt) : 'нет'}</strong>
              </span>
            </div>

            <div className="referral-service-list">
              {client.services.length === 0 ? <p>За выбранный период нет услуг ФФ.</p> : null}
              {client.services.map((service) => (
                <div key={service.serviceId ?? service.serviceName}>
                  <span>{service.serviceName}</span>
                  <strong>{formatMoney(service.totalRub)}</strong>
                  <small>{formatNumber(service.quantity)} ед. · {formatNumber(service.chargesCount)} начисл.</small>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthStartInputValue(date: Date) {
  return dateInputValue(new Date(date.getFullYear(), date.getMonth(), 1));
}

function periodLabel(startsAt: string, expiresAt: string | null) {
  return expiresAt ? `${formatDate(startsAt)} - ${formatDate(expiresAt)}` : `с ${formatDate(startsAt)} без срока`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось загрузить реферальную программу.';
}
