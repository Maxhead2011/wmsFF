import { BadRequestException } from '@nestjs/common';
import pdfMake = require('pdfmake');
import { PDFDocument, degrees } from 'pdf-lib';
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

// FIX: reproduce the supplied WB layout: supply number, large QR, quantity and direction.
// Rotate the artwork, not the PDF page, so merging/printing preserves physical 58x40 media.
export async function buildWbSupplyLabelsPdf(labels: SupplyLabel[]) {
  configurePdfMake();
  const content: Content[] = labels.map((label, index) => ({
    stack: [
      { text: label.supplyId, bold: true, fontSize: 10, alignment: 'center', margin: [0, 0, 0, 4] },
      { qr: label.supplyId, fit: 107, eccLevel: 'M', alignment: 'center', margin: [0, 0, 0, 2] },
      { text: `${label.quantity} шт.`, fontSize: 12, margin: [0, 0, 0, 1] },
      { text: label.destination, fontSize: label.destination.length > 35 ? 5 : label.destination.length > 20 ? 8 : 12 },
    ],
    ...(index < labels.length - 1 ? { pageBreak: 'after' as const } : {}),
  }));
  const width = 40 * 72 / 25.4, height = 58 * 72 / 25.4;
  const definition: TDocumentDefinitions = {
    pageSize: { width, height }, pageMargins: [3, 4, 3, 4],
    defaultStyle: { font: 'DejaVuSans' }, content,
  };
  const source = await PDFDocument.load(await pdfMake.createPdf(definition).getBuffer());
  const result = await PDFDocument.create();
  for (const embedded of await result.embedPages(source.getPages())) {
    result.addPage([height, width]).drawPage(embedded, { x: height, y: 0, rotate: degrees(90) });
  }
  return Buffer.from(await result.save());
}
