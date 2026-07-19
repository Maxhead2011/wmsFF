import {
  Archive,
  BadgeRussianRuble,
  Boxes,
  CircleCheckBig,
  Clock3,
  PackageCheck,
  Search,
  ShoppingBasket,
  Truck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchClients, type AuthSession, type ClientSummary } from '../../lib/api';
import './fbs.css';

type FbsPanelProps = {
  session: AuthSession;
};

type FbsView = 'active' | 'shipped' | 'cost' | 'archive';

const fbsViews = [
  {
    id: 'active' as const,
    title: 'Активные заказы по FBS',
    description: 'Новые заказы, сборка, упаковка и готовность к передаче.',
    icon: ShoppingBasket,
    accent: 'red',
  },
  {
    id: 'shipped' as const,
    title: 'Отгруженные',
    description: 'Заказы, переданные в доставку или на маркетплейс.',
    icon: Truck,
    accent: 'green',
  },
  {
    id: 'cost' as const,
    title: 'Стоимость обработки FBS',
    description: 'Сборка, упаковка и другие начисления по заказам FBS.',
    icon: BadgeRussianRuble,
    accent: 'amber',
  },
  {
    id: 'archive' as const,
    title: 'Архив',
    description: 'Завершённые, отменённые и закрытые заказы.',
    icon: Archive,
    accent: 'slate',
  },
];

export function FbsPanel({ session }: FbsPanelProps) {
  const [activeView, setActiveView] = useState<FbsView>('active');
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState(
    session.user.clientIds.length === 1 ? session.user.clientIds[0] : '',
  );
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    void fetchClients(session.accessToken)
      .then((rows) => {
        if (!active) return;
        setClients(rows);
        setSelectedClientId((current) => current || (rows.length === 1 ? rows[0].id : ''));
      })
      .catch(() => {
        if (!active) return;
        setClients([]);
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );
  const activeConfig = fbsViews.find((view) => view.id === activeView) ?? fbsViews[0];

  return (
    <section className="fbs-panel" aria-label="FBS">
      <header className="fbs-panel__hero">
        <div className="fbs-panel__hero-icon">
          <ShoppingBasket size={24} aria-hidden="true" />
        </div>
        <div>
          <p className="eyebrow">Клиентский контур</p>
          <h2>Управление FBS</h2>
          <p>Единый экран заказов, отгрузок и стоимости обработки по модели Fulfillment by Seller.</p>
        </div>
        <span className="fbs-panel__scope">
          {selectedClient
            ? `${selectedClient.code} · ${selectedClient.name}`
            : 'Доступный клиентский контур'}
        </span>
      </header>

      <div className="fbs-tiles" role="tablist" aria-label="Разделы FBS">
        {fbsViews.map((view, index) => {
          const Icon = view.icon;
          const isActive = activeView === view.id;
          return (
            <button
              className={`fbs-tile fbs-tile--${view.accent}${isActive ? ' is-active' : ''}`}
              key={view.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveView(view.id)}
            >
              <span className="fbs-tile__icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <span className="fbs-tile__content">
                <span className="fbs-tile__number">{index + 1}</span>
                <strong>{view.title}</strong>
                <small>{view.description}</small>
              </span>
              <span className="fbs-tile__count">0</span>
            </button>
          );
        })}
      </div>

      <section className="fbs-workspace" role="tabpanel" aria-label={activeConfig.title}>
        <div className="fbs-workspace__heading">
          <div>
            <p className="eyebrow">FBS</p>
            <h3>{activeConfig.title}</h3>
            <p>{activeConfig.description}</p>
          </div>
          <div className="fbs-workspace__filters">
            {clients.length > 1 ? (
              <label>
                <span>Клиент</span>
                <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
                  <option value="">Все доступные клиенты</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.code} · {client.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {activeView !== 'cost' ? (
              <label className="fbs-workspace__search">
                <span>Поиск</span>
                <span>
                  <Search size={17} aria-hidden="true" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Номер заказа, ШК или товар"
                  />
                </span>
              </label>
            ) : null}
          </div>
        </div>

        {activeView === 'cost' ? <FbsCostView /> : <FbsOrdersView view={activeView} search={search} />}
      </section>
    </section>
  );
}

function FbsOrdersView({ search, view }: { search: string; view: Exclude<FbsView, 'cost'> }) {
  const emptyCopy = {
    active: {
      icon: Clock3,
      title: 'Активных FBS-заказов пока нет',
      text: 'После подключения источника заказы появятся здесь и будут распределены по этапам сборки и упаковки.',
    },
    shipped: {
      icon: PackageCheck,
      title: 'Отгруженных FBS-заказов пока нет',
      text: 'Переданные заказы будут отображаться с датой отгрузки, количеством мест и итоговой стоимостью обработки.',
    },
    archive: {
      icon: Archive,
      title: 'Архив FBS пока пуст',
      text: 'Завершённые и отменённые заказы будут храниться здесь и останутся доступны для поиска.',
    },
  }[view];
  const EmptyIcon = emptyCopy.icon;

  return (
    <>
      <div className="fbs-order-summary">
        <article>
          <Boxes size={18} aria-hidden="true" />
          <span>Заказов</span>
          <strong>0</strong>
        </article>
        <article>
          <ShoppingBasket size={18} aria-hidden="true" />
          <span>Товаров</span>
          <strong>0</strong>
        </article>
        <article>
          <CircleCheckBig size={18} aria-hidden="true" />
          <span>{view === 'active' ? 'Готовы к отгрузке' : 'Обработано'}</span>
          <strong>0</strong>
        </article>
      </div>

      <div className="fbs-table-wrap">
        <table className="fbs-table">
          <thead>
            <tr>
              <th>Заказ</th>
              <th>Маркетплейс</th>
              <th>Товары</th>
              <th>Статус</th>
              <th>{view === 'active' ? 'Срок сборки' : 'Дата'}</th>
            </tr>
          </thead>
        </table>
        <div className="fbs-empty">
          <span>
            <EmptyIcon size={27} aria-hidden="true" />
          </span>
          <strong>
            {search.trim() ? `По запросу «${search.trim()}» ничего не найдено` : emptyCopy.title}
          </strong>
          <p>{search.trim() ? 'Измените поисковый запрос или очистите поле.' : emptyCopy.text}</p>
        </div>
      </div>
    </>
  );
}

function FbsCostView() {
  return (
    <>
      <div className="fbs-cost-summary">
        <article>
          <span>Заказов обработано</span>
          <strong>0</strong>
          <small>текущий расчётный период</small>
        </article>
        <article>
          <span>Единиц обработано</span>
          <strong>0</strong>
          <small>сборка и упаковка</small>
        </article>
        <article className="fbs-cost-summary__total">
          <span>Предварительная стоимость</span>
          <strong>0 ₽</strong>
          <small>до формирования начисления</small>
        </article>
      </div>
      <div className="fbs-cost-empty">
        <BadgeRussianRuble size={28} aria-hidden="true" />
        <div>
          <strong>Расчёт начнётся после появления FBS-заказов</strong>
          <p>
            Стоимость будет собираться из фактически выполненных операций и подключённых клиенту тарифов.
          </p>
        </div>
      </div>
    </>
  );
}
