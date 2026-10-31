import { BadRequestException } from '@nestjs/common';

export const cargoPickupEnabled = () => process.env.WMS_CARGO_PICKUP_ENABLED === 'true';

// FIX: legacy arrivals never acquire an implicit delivery charge.
export function cargoPickupInput(dto: Record<string, unknown>) {
  if (!cargoPickupEnabled()) {
    if (dto.ourDelivery !== undefined || dto.deliveryCostRub !== undefined) {
      throw new BadRequestException('Учёт забора с карго не включён.');
    }
    return {};
  }
  if (dto.ourDelivery !== undefined && typeof dto.ourDelivery !== 'boolean') {
    throw new BadRequestException('Выберите вид доставки.');
  }
  if (dto.ourDelivery !== true) return { ourDelivery: false, deliveryCostRub: null };
  const cost = dto.deliveryCostRub;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0 || cost > 10000000 || Math.abs(cost * 100 - Math.round(cost * 100)) > 0.000001) {
    throw new BadRequestException('Укажите стоимость доставки в рублях, не более двух знаков после запятой.');
  }
  return { ourDelivery: true, deliveryCostRub: cost };
}
