import { BadRequestException } from '@nestjs/common';
import pdfMake = require('pdfmake');
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { configurePdfMake } from '../../common/pdf/pdfmake';

type Order = { id: string; connectionId: string; marketplace: string; supplyId?: string | null };
type Connection = { id: string; apiKey: string };
type Reader = (url: string, init: RequestInit) => Promise<any>;
export type SupplyLabel = { supplyId: string; quantity: number; destination: string };

// FIX: derive labels from existing WB supplies using GET only; no delivery transition.
export async function readWbSupplyLabels(orders: Order[], connections: Connection[], json: Reader) {
  if (!orders.length || orders.some(o => o.marketplace !== 'WILDBERRIES' || !/^WB-GI-\d+$/.test(o.supplyId || '')))
    throw new BadRequestException('Для печати стикера сначала создайте поставку WB и добавьте заказы.');
  const supplies = [...new Map(orders.map(o => [JSON.stringify([o.connectionId, o.supplyId]), o])).values()];
  const offices = new Map<string, any[]>();
  const labels: SupplyLabel[] = [];
  for (const supply of supplies) {
    const connection = connections.find(c => c.id === supply.connectionId);
    if (!connection) throw new BadRequestException('Кабинет поставки WB недоступен.');
    const read = (path: string) => json(`https://marketplace-api.wildberries.ru${path}`, {
      method: 'GET', headers: { Authorization: connection.apiKey, 'Content-Type': 'application/json' },
    });
    const id = supply.supplyId!;
    const info = await read(`/api/v3/supplies/${encodeURIComponent(id)}`);
    if (info.id !== id) throw new BadRequestException(`WB не подтвердил поставку ${id}.`);
    const members = await read(`/api/marketplace/v3/supplies/${encodeURIComponent(id)}/order-ids`);
    if (!Array.isArray(members.orderIds) || !members.orderIds.length || members.orderIds.some((n: unknown) => !/^\d+$/.test(String(n))))
      throw new BadRequestException(`WB не вернул состав поставки ${id}. Повторите получение этикеток.`);
    const ids = new Set<string>(members.orderIds.map(String));
    if (ids.size !== members.orderIds.length || orders.some(o => o.connectionId === supply.connectionId && o.supplyId === id && !ids.has(o.id)))
      throw new BadRequestException(`Состав поставки ${id} изменился. Обновите заказы.`);
    if (!offices.has(connection.id)) {
      const response = await read('/api/v3/offices');
      if (!Array.isArray(response)) throw new BadRequestException('WB не вернул направления поставок.');
      offices.set(connection.id, response);
    }
    const destination = offices.get(connection.id)!.find(o => String(o.id) === String(info.destinationOfficeId))?.name;
    if (typeof destination !== 'string' || !destination.trim())
      throw new BadRequestException(`WB не подтвердил направление поставки ${id}. Повторите получение этикеток.`);
    // WB assembly order represents one sale unit; count all members, not the selected subset.
    labels.push({ supplyId: id, quantity: ids.size, destination: destination.trim() });
  }
  return labels;
}

// FIX: vector QR with the exact supply ID; captions never overlap the QR quiet zone.
export async function buildWbSupplyLabelsPdf(labels: SupplyLabel[]) {
  configurePdfMake();
  const content: Content[] = labels.map((label, index) => ({
    stack: [
      { text: `${label.quantity} шт.`, bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
      { columns: [
        { qr: label.supplyId, fit: 50, eccLevel: 'M', width: 70, margin: [9, 9, 9, 9] },
        { text: label.destination, fontSize: label.destination.length > 35 ? 6 : 8, width: '*', margin: [3, 3, 0, 0] },
      ] },
      { text: label.supplyId, fontSize: 10, bold: true, margin: [0, 4, 0, 0], alignment: 'center' },
    ],
    ...(index < labels.length - 1 ? { pageBreak: 'after' as const } : {}),
  }));
  const definition: TDocumentDefinitions = {
    pageSize: { width: 58 * 72 / 25.4, height: 40 * 72 / 25.4 }, pageMargins: [6, 5, 6, 5],
    defaultStyle: { font: 'DejaVuSans' }, content,
  };
  return pdfMake.createPdf(definition).getBuffer();
}
