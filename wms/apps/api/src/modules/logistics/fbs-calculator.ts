import { DEFAULT_FBS_ITEMS_PER_CARGO_PLACE } from '../marketplace-connections/fbs.constants';

export const FBS_VNUKOVO = 'Внуково';
export const FBS_KAVKAZ = 'Кавказский Бульвар';

const FBS_BOXES_PER_PALLET = 16;
const FBS_FIXED_DELIVERY_LIMIT = 1000;

export type FbsCalculatorQuote = {
  destination: string;
  quantity: number;
  boxes: number;
  processingCost: number;
  stickersCost: number;
  boxesCost: number;
  assemblyCost: number;
  servicesWithMarkup: number;
  deliveryPrice: number;
  subtotalBeforeTax: number;
  taxGrossUp: number;
  totalWithTax: number;
  requiresManualReview: false;
};

export function calculateFbsBoxes(quantity: number) {
  return Math.ceil(quantity / DEFAULT_FBS_ITEMS_PER_CARGO_PLACE);
}

export function quoteFixedFbsCalculator(
  quantityValue: number,
  destination: string,
): FbsCalculatorQuote | null {
  const quantity = Math.max(1, Math.trunc(quantityValue));
  const boxes = calculateFbsBoxes(quantity);
  const deliveryPrice = calculateSpecialFbsDelivery(destination, quantity, boxes);
  return deliveryPrice == null
    ? null
    : buildFbsCalculatorTotal(quantity, boxes, destination, deliveryPrice);
}

export function buildFbsCalculatorTotal(
  quantity: number,
  boxes: number,
  destination: string,
  deliveryPrice: number,
): FbsCalculatorQuote {
  const processingCost = quantity * 10;
  const stickersCost = quantity * 3;
  const boxesCost = boxes * 100;
  const assemblyCost = boxes * 40;
  const servicesWithMarkup = round(
    (processingCost + stickersCost + boxesCost + assemblyCost) * 1.5,
    2,
  );
  const subtotalBeforeTax = round(servicesWithMarkup + deliveryPrice, 2);
  const totalWithTax = round((subtotalBeforeTax / 94) * 100, 2);

  return {
    destination,
    quantity,
    boxes,
    processingCost,
    stickersCost,
    boxesCost,
    assemblyCost,
    servicesWithMarkup,
    deliveryPrice,
    subtotalBeforeTax,
    taxGrossUp: round(totalWithTax - subtotalBeforeTax, 2),
    totalWithTax,
    requiresManualReview: false,
  };
}

function calculateSpecialFbsDelivery(destination: string, quantity: number, boxes: number) {
  const normalized = destination.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
  const isVnukovo = normalized.includes('внуково');
  const isKavkaz = normalized.includes('кавказ');
  if (!isVnukovo && !isKavkaz) return null;
  if (quantity <= FBS_FIXED_DELIVERY_LIMIT) {
    return isVnukovo ? 1500 : 3000;
  }

  const pallets = Math.ceil(boxes / FBS_BOXES_PER_PALLET);
  if (isVnukovo) {
    return pallets * (pallets <= 2 ? 1500 : 1200);
  }
  const pricePerPallet =
    pallets === 1
      ? 3500
      : pallets === 2
        ? 3000
        : pallets === 3
          ? 2800
          : pallets === 4
            ? 2500
            : pallets === 5
              ? 2300
              : pallets === 6
                ? 2200
                : 2000;
  return pallets * pricePerPallet;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
