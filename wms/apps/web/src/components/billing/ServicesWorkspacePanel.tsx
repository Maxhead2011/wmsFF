import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchClients, type AuthSession, type ClientSummary } from '../../lib/api';
import { ClientBillingServicesPanel } from './ClientBillingServicesPanel';
import './billing.css';

export function ServicesWorkspacePanel({ session }: { session: AuthSession }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadClients();
  }, [session.accessToken]);

  async function loadClients() {
    setStatus('loading');
    setError(null);
    try {
      setClients(await fetchClients(session.accessToken));
      setStatus('ready');
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
    }
  }

  return (
    <section className="billing-panel" aria-label="Услуги клиентов">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Управление</p>
          <h2>Услуги клиентов</h2>
          <p>Подключение услуг, индивидуальные цены и порядок учета налога для каждого клиента.</p>
        </div>
        <button className="icon-button" type="button" onClick={() => void loadClients()} title="Обновить клиентов">
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </div>

      {status === 'loading' && clients.length === 0 ? <p>Загружаю клиентов...</p> : null}
      {status === 'error' ? <p className="form-error">{error}</p> : null}
      {clients.length > 0 ? <ClientBillingServicesPanel clients={clients} session={session} /> : null}
    </section>
  );
}
