import { BadRequestException } from '@nestjs/common';

type PickInput = { sourceBoxCode: string; barcode: string; kiz: string };
type ReceiptInput = { targetBoxCode: string; barcode: string; kiz: string; pickedByThisRequest: boolean };

function required(value: string, message: string) {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

export function assertSkuCollectionPick(input: PickInput) {
  // FIX: the internal collection flow always records physical origin, product and KIZ.
  return {
    sourceBoxCode: required(input.sourceBoxCode, 'Сканируйте исходный короб.'),
    barcode: required(input.barcode, 'Сканируйте ШК товара.'),
    kiz: required(input.kiz, 'Сканируйте КИЗ.'),
  };
}

export function assertSkuCollectionReceipt(input: ReceiptInput) {
  const normalized = {
    targetBoxCode: required(input.targetBoxCode, 'Сканируйте короб приёмки.'),
    barcode: required(input.barcode, 'Сканируйте ШК товара.'),
    kiz: required(input.kiz, 'Сканируйте КИЗ.'),
  };
  if (!input.pickedByThisRequest) {
    throw new BadRequestException('КИЗ не был отобран этой заявкой. Обычный дубликат принимать нельзя.');
  }
  return normalized;
}
