import { BadRequestException } from '@nestjs/common';
import { BillingPriceTaxMode } from '@prisma/client';

type PrimaryLine = {
  key: string;
  description: string;
  serviceId: string | null;
  serviceCode: string;
  quantity: number;
  unitPriceRub: number;
  priceBeforeTaxRub: number;
  taxMode: BillingPriceTaxMode;
  billingPolicy?: string;
};

// FIX: opt-in LOGOFF policy for the two verified Lukin cards, never a global tariff change.
const LUKIN_CLIENT_IDS = new Set([
  'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9', // CL-000001
  '68cbb87b-5f53-4123-8b08-62ef372059b5', // CL-000010
]);

export function lukinPrimaryLines(clientId: string, quantity: number, lines: PrimaryLine[]): PrimaryLine[] {
  if (process.env.WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED !== 'true' || !LUKIN_CLIENT_IDS.has(clientId)) {
    return lines;
  }
  if (quantity === 0) return [];
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new BadRequestException('Некорректное количество первичной обработки Лукина.');
  }
  const required = [
    { code: 'NOM_ДОПОЛНИТЕЛЬНЫЕ_УСЛУГИ_ПО_УПАКОВКЕ', description: 'Дополнительные услуги', price: 4.26 },
    { code: 'ITEM_PROCESSING', description: 'Первичная обработка', price: 10.64 },
  ];
  const core = required.map(({ code, description, price }) => {
    const matching = lines.filter(line => line.serviceCode === code && line.key.startsWith('SERVICE:') && line.serviceId);
    if (matching.length !== 1) {
      throw new BadRequestException(`Проверьте услуги первичной обработки Лукина: требуется одна услуга «${description}».`);
    }
    return { ...matching[0], description, quantity, unitPriceRub: price, priceBeforeTaxRub: price,
      taxMode: BillingPriceTaxMode.INCLUDED, billingPolicy: 'LUKIN_PRIMARY_V1' };
  });
  // Relabeling is optional and keeps its actual quantity and existing tax calculation.
  const relabel = lines.filter(line => line.key === 'RELABEL' && line.quantity > 0);
  if (relabel.length > 1 || relabel.some(line => !Number.isSafeInteger(line.quantity) || line.quantity > quantity)) {
    throw new BadRequestException('Некорректное количество перемаркировки первичной обработки Лукина.');
  }
  return [...core, ...relabel];
}
