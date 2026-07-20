import { Boxes, Calculator, PackageCheck, Percent, Sticker, Truck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

const MAX_QUANTITY = 3000;
const FIXED_DELIVERY_LIMIT = 1000;
const ITEMS_PER_BOX = 14;
const BOXES_PER_PALLET = 16;

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

type FbsCalculatorResult = {
  quantity: number;
  services: FbsServicesCalculation;
  kavkaz: FbsDirectionCalculation;
  vnukovo: FbsDirectionCalculation;
};

export function FbsCostCalculator() {
  const [quantityValue, setQuantityValue] = useState('');
  const [result, setResult] = useState<FbsCalculatorResult | null>(null);
  const [error, setError] = useState('');

  function calculate(event: FormEvent<HTMLFormElement>) {
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

    setError('');
    setResult(calculateFbsCost(quantity));
  }

  function updateQuantity(value: string) {
    setQuantityValue(value);
    setError('');
    setResult(null);
  }

  return (
    <div className="fbs-calculator">
      <section className="fbs-calculator__input-card">
        <div className="fbs-calculator__intro">
          <span>
            <Calculator size={25} aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Предварительная стоимость</p>
            <h4>Рассчитайте партию FBS</h4>
            <p>
              Укажите количество отправляемых товаров, чтобы сравнить стоимость доставки на Кавказский Бульвар
              и во Внуково.
            </p>
          </div>
        </div>

        <form className="fbs-calculator__form" onSubmit={calculate} noValidate>
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
          <button type="submit">
            <Calculator size={18} aria-hidden="true" />
            Рассчитать стоимость
          </button>
        </form>

        {error ? <p className="fbs-calculator__error" role="alert">{error}</p> : null}

        <div className="fbs-calculator__rules">
          <CalculationRule icon={PackageCheck} label="Обработка" value="10 ₽ / ед." />
          <CalculationRule icon={Sticker} label="Стикер" value="3 ₽ / ед." />
          <CalculationRule icon={Boxes} label="Вместимость" value="14 ед. / короб" />
          <CalculationRule icon={Percent} label="Наценка" value="50%" />
        </div>
      </section>

      {result ? (
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
              <span>Услуги с наценкой</span>
              <strong>{formatMoney(result.services.servicesWithMarkup)}</strong>
            </div>
          </div>

          <div className="fbs-calculator__directions">
            <DirectionResult
              name="Кавказский Бульвар"
              tone="blue"
              calculation={result.kavkaz}
            />
            <DirectionResult
              name="Внуково"
              tone="green"
              calculation={result.vnukovo}
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
            <p>Калькулятор покажет итог с налогом и отдельно распишет логистику по каждому направлению.</p>
          </div>
        </section>
      )}
    </div>
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
            <dd>Фиксированный тариф</dd>
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

export function calculateFbsCost(quantity: number): FbsCalculatorResult {
  const services = calculateServices(quantity);
  return {
    quantity,
    services,
    kavkaz: calculateDirection(quantity, services, 3000, getKavkazPalletPrice),
    vnukovo: calculateDirection(quantity, services, 1500, getVnukovoPalletPrice),
  };
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

function calculateDirection(
  quantity: number,
  services: FbsServicesCalculation,
  fixedDeliveryPrice: number,
  getPalletPrice: (palletsCount: number) => number,
): FbsDirectionCalculation {
  let palletsCount = 0;
  let palletPrice = 0;
  let deliveryPrice = fixedDeliveryPrice;
  let deliveryType: FbsDirectionCalculation['deliveryType'] = 'fixed';

  if (quantity > FIXED_DELIVERY_LIMIT) {
    palletsCount = Math.ceil(services.boxesCount / BOXES_PER_PALLET);
    palletPrice = getPalletPrice(palletsCount);
    deliveryPrice = palletsCount * palletPrice;
    deliveryType = 'pallet';
  }

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

function getKavkazPalletPrice(palletsCount: number) {
  if (palletsCount === 1) return 3500;
  if (palletsCount === 2) return 3000;
  if (palletsCount === 3) return 2800;
  if (palletsCount === 4) return 2500;
  if (palletsCount === 5) return 2300;
  if (palletsCount === 6) return 2200;
  return 2000;
}

function getVnukovoPalletPrice(palletsCount: number) {
  return palletsCount <= 2 ? 1500 : 1200;
}

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}
