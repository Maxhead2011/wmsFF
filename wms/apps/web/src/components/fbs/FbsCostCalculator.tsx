import { Boxes, Calculator, PackageCheck, Percent, Sticker, Truck } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  fetchFbsCalculatorDestinations,
  fetchLogisticsTariffSet,
  fetchLogisticsTariffSets,
  quoteFbsCalculator,
  quoteLogistics,
  type AuthSession,
  type LogisticsQuoteResult,
  type LogisticsTariffSetDetail,
  type LogisticsTariffSetSummary,
} from '../../lib/api';

const MAX_QUANTITY = 3000;
const ITEMS_PER_BOX = 14;
const BOXES_PER_PALLET = 16;
const SPECIAL_DESTINATIONS = ['Внуково', 'Кавказский Бульвар'] as const;

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

type FbsDirectionCalculation = {
  totalWithTax: number;
  boxesCount: number;
  palletsCount: number;
  palletPrice: number;
  deliveryPrice: number;
  deliveryTax: number;
  deliveryWithTax: number;
  deliveryType: 'fixed' | 'pallet';
};

type FbsServicesCalculation = {
  processingCost: number;
  stickersCost: number;
  boxesCost: number;
  assemblyCost: number;
  boxesCount: number;
  servicesCost: number;
  servicesWithMarkup: number;
};

type CalculatorDisplayResult =
  | { mode: 'client'; destination: string; totalWithTax: number }
  | {
      mode: 'admin';
      quantity: number;
      services: FbsServicesCalculation;
      calculation: FbsDirectionCalculation;
      destination: string;
      tariffName: string;
    };

type FbsCostCalculatorProps = {
  session: AuthSession;
  isAdmin: boolean;
};

export function FbsCostCalculator({ session, isAdmin }: FbsCostCalculatorProps) {
  const [quantityValue, setQuantityValue] = useState('');
  const [result, setResult] = useState<CalculatorDisplayResult | null>(null);
  const [error, setError] = useState('');
  const [tariffSets, setTariffSets] = useState<LogisticsTariffSetSummary[]>([]);
  const [tariffSetId, setTariffSetId] = useState('');
  const [tariffDetail, setTariffDetail] = useState<LogisticsTariffSetDetail | null>(null);
  const [clientDestinations, setClientDestinations] = useState<string[]>([]);
  const [destination, setDestination] = useState('');
  const [isLoadingTariffs, setLoadingTariffs] = useState(false);
  const [isCalculating, setCalculating] = useState(false);

  useEffect(() => {
    if (isAdmin) return;
    let active = true;
    setLoadingTariffs(true);
    void fetchFbsCalculatorDestinations(session.accessToken)
      .then(({ destinations }) => {
        if (!active) return;
        setClientDestinations(destinations);
        setDestination((current) => current || destinations[0] || '');
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Не удалось загрузить список городов.');
      })
      .finally(() => {
        if (active) setLoadingTariffs(false);
      });
    return () => {
      active = false;
    };
  }, [isAdmin, session.accessToken]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setLoadingTariffs(true);
    void fetchLogisticsTariffSets(session.accessToken)
      .then((rows) => {
        if (!active) return;
        setTariffSets(rows);
        setTariffSetId((current) => current || rows[0]?.id || '');
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Не удалось загрузить тарифы логистики.');
      })
      .finally(() => {
        if (active) setLoadingTariffs(false);
      });
    return () => {
      active = false;
    };
  }, [isAdmin, session.accessToken]);

  useEffect(() => {
    if (!isAdmin || !tariffSetId) {
      setTariffDetail(null);
      setDestination('');
      return;
    }
    let active = true;
    setLoadingTariffs(true);
    setResult(null);
    void fetchLogisticsTariffSet(session.accessToken, tariffSetId)
      .then((detail) => {
        if (!active) return;
        setTariffDetail(detail);
        const options = buildDestinationOptions(detail);
        setDestination((current) =>
          options.some((option) => normalizeLogisticsPoint(option) === normalizeLogisticsPoint(current))
            ? current
            : options[0] || '',
        );
      })
      .catch((caught) => {
        if (!active) return;
        setTariffDetail(null);
        setDestination('');
        setError(caught instanceof Error ? caught.message : 'Не удалось загрузить города из тарифа.');
      })
      .finally(() => {
        if (active) setLoadingTariffs(false);
      });
    return () => {
      active = false;
    };
  }, [isAdmin, session.accessToken, tariffSetId]);

  const destinationOptions = useMemo(
    () => (isAdmin ? buildDestinationOptions(tariffDetail) : clientDestinations),
    [clientDestinations, isAdmin, tariffDetail],
  );

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = Number(quantityValue.trim());
    if (
      quantityValue.trim() === '' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      setError('Введите целое количество товаров от 1 до 3 000.');
      setResult(null);
      return;
    }

    if (!destination) {
      setError('Выберите город доставки.');
      setResult(null);
      return;
    }

    if (!isAdmin) {
      setCalculating(true);
      setError('');
      setResult(null);
      try {
        const calculation = await quoteFbsCalculator(session.accessToken, { quantity, destination });
        if (calculation.totalWithTax == null || calculation.requiresManualReview) {
          throw new Error('Для выбранного города стоимость требует ручного расчёта.');
        }
        setResult({
          mode: 'client',
          destination: calculation.destination,
          totalWithTax: calculation.totalWithTax,
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать выбранный город.');
      } finally {
        setCalculating(false);
      }
      return;
    }

    if (!tariffSetId) {
      setError('Выберите набор тарифов логистики.');
      setResult(null);
      return;
    }

    setCalculating(true);
    setError('');
    setResult(null);
    try {
      const services = calculateServices(quantity);
      const specialCalculation = calculateSpecialDirection(quantity, destination, services);
      if (specialCalculation) {
        setResult({
          mode: 'admin',
          quantity,
          services,
          calculation: specialCalculation,
          destination,
          tariffName: 'Специальный тариф FBS',
        });
        return;
      }
      const logistics = await quoteLogistics(session.accessToken, {
        tariffSetId,
        destination,
        boxes: services.boxesCount,
      });
      if (logistics.estimatedTotalRub == null) {
        throw new Error('Для выбранного города тариф требует ручного расчёта логистики.');
      }
      setResult({
        mode: 'admin',
        quantity,
        services,
        calculation: calculateQuotedDirection(services, logistics),
        destination: logistics.route.destination,
        tariffName: logistics.tariffSet.name,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать выбранный город.');
    } finally {
      setCalculating(false);
    }
  }

  function updateQuantity(value: string) {
    setQuantityValue(value);
    setError('');
    setResult(null);
  }

  return (
    <div className={`fbs-calculator${isAdmin ? ' fbs-calculator--admin' : ' fbs-calculator--client'}`}>
      <section className="fbs-calculator__input-card">
        <div className="fbs-calculator__intro">
          <span>
            <Calculator size={25} aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Предварительная стоимость</p>
            <h4>Рассчитайте партию FBS</h4>
            <p>
              {isAdmin
                ? 'Выберите город из действующих тарифов WMS — логистика автоматически войдёт в расчёт.'
                : 'Укажите количество товаров. В результате будет показана только итоговая стоимость с налогом.'}
            </p>
          </div>
        </div>

        <form
          className={`fbs-calculator__form${isAdmin ? ' fbs-calculator__form--admin' : ' fbs-calculator__form--client'}`}
          onSubmit={calculate}
          noValidate
        >
          <label htmlFor="fbs-calculator-quantity">
            <span>Количество товаров, ед.</span>
            <input
              id="fbs-calculator-quantity"
              type="number"
              min="1"
              max={MAX_QUANTITY}
              step="1"
              inputMode="numeric"
              value={quantityValue}
              onChange={(event) => updateQuantity(event.target.value)}
              placeholder="От 1 до 3000"
              required
            />
          </label>
          {isAdmin ? (
            <>
              <label htmlFor="fbs-calculator-tariff">
                <span>Набор тарифов логистики</span>
                <select
                  id="fbs-calculator-tariff"
                  value={tariffSetId}
                  onChange={(event) => {
                    setTariffSetId(event.target.value);
                    setResult(null);
                    setError('');
                  }}
                  disabled={isLoadingTariffs}
                  required
                >
                  <option value="">Выберите тариф</option>
                  {tariffSets.map((tariff) => (
                    <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <label htmlFor="fbs-calculator-city">
            <span>Город доставки</span>
            <select
              id="fbs-calculator-city"
              value={destination}
              onChange={(event) => {
                setDestination(event.target.value);
                setResult(null);
                setError('');
              }}
              disabled={isLoadingTariffs || destinationOptions.length === 0}
              required
            >
              <option value="">Выберите город</option>
              {destinationOptions.map((city) => (
                <option key={normalizeLogisticsPoint(city)} value={city}>{city}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={isCalculating || (isAdmin && isLoadingTariffs)}>
            <Calculator size={18} aria-hidden="true" />
            {isCalculating ? 'Рассчитываю' : 'Рассчитать стоимость'}
          </button>
        </form>

        {error ? <p className="fbs-calculator__error" role="alert">{error}</p> : null}

        {isAdmin ? (
          <div className="fbs-calculator__rules">
            <CalculationRule icon={PackageCheck} label="Обработка" value="10 ₽ / ед." />
            <CalculationRule icon={Sticker} label="Стикер" value="3 ₽ / ед." />
            <CalculationRule icon={Boxes} label="Вместимость" value="14 ед. / короб" />
            <CalculationRule icon={Percent} label="Наценка" value="50%" />
          </div>
        ) : null}
      </section>

      {result?.mode === 'client' ? (
        <section className="fbs-calculator__client-results" aria-live="polite">
          <ClientTotal name={result.destination} value={result.totalWithTax} />
        </section>
      ) : result?.mode === 'admin' ? (
        <section className="fbs-calculator__results" aria-live="polite">
          <div className="fbs-calculator__summary">
            <div>
              <span>Товаров</span>
              <strong>{formatNumber(result.quantity)}</strong>
            </div>
            <div>
              <span>Коробов</span>
              <strong>{formatNumber(result.services.boxesCount)}</strong>
            </div>
            <div>
              <span>Тариф WMS</span>
              <strong>{result.tariffName}</strong>
            </div>
          </div>

          <div className="fbs-calculator__directions fbs-calculator__directions--single">
            <DirectionResult
              name={result.destination}
              tone="blue"
              calculation={result.calculation}
            />
          </div>

          <details className="fbs-calculator__breakdown">
            <summary>Показать расчёт услуг</summary>
            <div>
              <BreakdownRow label={`Обработка · ${formatNumber(result.quantity)} ед.`} value={result.services.processingCost} />
              <BreakdownRow label={`Стикеры · ${formatNumber(result.quantity)} ед.`} value={result.services.stickersCost} />
              <BreakdownRow label={`Короба · ${formatNumber(result.services.boxesCount)} шт.`} value={result.services.boxesCost} />
              <BreakdownRow label={`Формирование коробов · ${formatNumber(result.services.boxesCount)} шт.`} value={result.services.assemblyCost} />
              <BreakdownRow label="Услуги до наценки" value={result.services.servicesCost} />
              <BreakdownRow label="Услуги с наценкой 50%" value={result.services.servicesWithMarkup} total />
            </div>
          </details>
        </section>
      ) : (
        <section className="fbs-calculator__placeholder">
          <span><Truck size={30} aria-hidden="true" /></span>
          <div>
            <strong>Результат появится здесь</strong>
            <p>
              {isAdmin
                ? 'Калькулятор возьмёт стоимость логистики для выбранного города из тарифов WMS.'
                : 'После расчёта здесь будет показана только итоговая стоимость с налогом.'}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

function ClientTotal({ name, value }: { name: string; value: number }) {
  return (
    <article>
      <small>{name}</small>
      <span>Стоимость с налогом</span>
      <strong>{formatMoney(value)}</strong>
    </article>
  );
}

function CalculationRule({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
}) {
  return (
    <div>
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DirectionResult({
  name,
  tone,
  calculation,
}: {
  name: string;
  tone: 'blue' | 'green';
  calculation: FbsDirectionCalculation;
}) {
  return (
    <article className={`fbs-calculator-direction fbs-calculator-direction--${tone}`}>
      <header>
        <span><Truck size={19} aria-hidden="true" /></span>
        <div>
          <small>Направление</small>
          <strong>{name}</strong>
        </div>
      </header>
      <div className="fbs-calculator-direction__total">
        <span>Итоговая стоимость с налогом</span>
        <strong>{formatMoney(calculation.totalWithTax)}</strong>
      </div>
      <dl>
        <div>
          <dt>Коробов</dt>
          <dd>{formatNumber(calculation.boxesCount)}</dd>
        </div>
        {calculation.deliveryType === 'pallet' ? (
          <>
            <div>
              <dt>Паллет</dt>
              <dd>{formatNumber(calculation.palletsCount)}</dd>
            </div>
            <div>
              <dt>Цена за паллету</dt>
              <dd>{formatMoney(calculation.palletPrice)}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Тип логистики</dt>
            <dd>Тариф WMS</dd>
          </div>
        )}
        <div>
          <dt>Логистика без налога</dt>
          <dd>{formatMoney(calculation.deliveryPrice)}</dd>
        </div>
        <div>
          <dt>Налог на логистику</dt>
          <dd>{formatMoney(calculation.deliveryTax)}</dd>
        </div>
        <div>
          <dt>Логистика с налогом</dt>
          <dd>{formatMoney(calculation.deliveryWithTax)}</dd>
        </div>
      </dl>
    </article>
  );
}

function BreakdownRow({ label, value, total = false }: { label: string; value: number; total?: boolean }) {
  return (
    <div className={total ? 'is-total' : undefined}>
      <span>{label}</span>
      <strong>{formatMoney(value)}</strong>
    </div>
  );
}

function calculateServices(quantity: number): FbsServicesCalculation {
  const boxesCount = Math.ceil(quantity / ITEMS_PER_BOX);
  const processingCost = quantity * 10;
  const stickersCost = quantity * 3;
  const boxesCost = boxesCount * 100;
  const assemblyCost = boxesCount * 40;
  const servicesCost = processingCost + stickersCost + boxesCost + assemblyCost;

  return {
    processingCost,
    stickersCost,
    boxesCost,
    assemblyCost,
    boxesCount,
    servicesCost,
    servicesWithMarkup: servicesCost * 1.5,
  };
}

function calculateSpecialDirection(
  quantity: number,
  destination: string,
  services: FbsServicesCalculation,
) {
  const normalized = normalizeLogisticsPoint(destination).replace(/ё/g, 'е');
  const isVnukovo = normalized.includes('внуково');
  const isKavkaz = normalized.includes('кавказ');
  if (!isVnukovo && !isKavkaz) return null;

  let palletsCount = 0;
  let palletPrice = 0;
  let deliveryPrice = isVnukovo ? 1500 : 3000;
  let deliveryType: FbsDirectionCalculation['deliveryType'] = 'fixed';
  if (quantity > 1000) {
    palletsCount = Math.ceil(services.boxesCount / BOXES_PER_PALLET);
    palletPrice = isVnukovo
      ? palletsCount <= 2
        ? 1500
        : 1200
      : getKavkazPalletPrice(palletsCount);
    deliveryPrice = palletsCount * palletPrice;
    deliveryType = 'pallet';
  }
  return buildDirectionCalculation(
    services,
    deliveryPrice,
    palletsCount,
    palletPrice,
    deliveryType,
  );
}

function getKavkazPalletPrice(palletsCount: number) {
  if (palletsCount === 1) return 3500;
  if (palletsCount === 2) return 3000;
  if (palletsCount === 3) return 2800;
  if (palletsCount === 4) return 2500;
  if (palletsCount === 5) return 2300;
  if (palletsCount === 6) return 2200;
  return 2000;
}

function calculateQuotedDirection(
  services: FbsServicesCalculation,
  logistics: LogisticsQuoteResult,
): FbsDirectionCalculation {
  const deliveryPrice = Number(logistics.estimatedTotalRub ?? 0);
  const palletsCount = Number(logistics.input.pallets ?? 0);
  const deliveryType: FbsDirectionCalculation['deliveryType'] = palletsCount > 0 ? 'pallet' : 'fixed';
  const palletPrice = palletsCount > 0 ? deliveryPrice / palletsCount : 0;
  return buildDirectionCalculation(services, deliveryPrice, palletsCount, palletPrice, deliveryType);
}

function buildDirectionCalculation(
  services: FbsServicesCalculation,
  deliveryPrice: number,
  palletsCount: number,
  palletPrice: number,
  deliveryType: FbsDirectionCalculation['deliveryType'],
): FbsDirectionCalculation {
  const deliveryWithTax = addTax(deliveryPrice);
  const deliveryTax = deliveryWithTax - deliveryPrice;
  return {
    totalWithTax: addTax(services.servicesWithMarkup + deliveryPrice),
    boxesCount: services.boxesCount,
    palletsCount,
    palletPrice,
    deliveryPrice,
    deliveryTax,
    deliveryWithTax,
    deliveryType,
  };
}

function addTax(amount: number) {
  return (amount / 94) * 100;
}

function buildDestinationOptions(tariffSet: LogisticsTariffSetDetail | null) {
  if (!tariffSet) return [];
  const moscowDirections = tariffSet.directions.filter((direction) => isMoscowOrigin(direction.origin));
  const source = moscowDirections.length > 0 ? moscowDirections : tariffSet.directions;
  const options = new Map<string, string>();
  source.forEach((direction) => {
    const city = direction.destination.trim();
    if (city) options.set(normalizeLogisticsPoint(city), city);
  });
  SPECIAL_DESTINATIONS.forEach((city) => options.set(normalizeLogisticsPoint(city), city));
  return [...options.values()].sort((left, right) => left.localeCompare(right, 'ru'));
}

function isMoscowOrigin(origin: string) {
  const normalized = normalizeLogisticsPoint(origin);
  return normalized === 'москва' || normalized === 'moscow';
}

function normalizeLogisticsPoint(value: string) {
  return value.toLowerCase().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}
