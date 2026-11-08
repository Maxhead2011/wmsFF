import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

type Order = { id: string; connectionId: string; supplyId?: string | null; marketplace: string };
type File = { buffer: Buffer };
type Readers = {
  sc: (orders: Order[]) => Promise<File>;
  pvz: (orders: Order[]) => Promise<File>;
  pairs: (orders: Order[]) => Promise<File>;
};

// FIX: read-only ribbon; a missing section must not discard the available labels.
export async function wbAllLabels(input: Order[], readers: Readers) {
  const orders = [...new Map(input.map(o => [JSON.stringify([o.connectionId, o.id]), o])).values()];
  if (!orders.length || orders.some(o => o.marketplace !== 'WILDBERRIES'))
    throw new BadRequestException('Выберите заказы Wildberries.');
  const warnings: string[] = [];
  const output = await PDFDocument.create();
  async function append(read: () => Promise<File>, label: string, split?: () => Promise<void>) {
    try {
      const file = await read();
      const pdf = await PDFDocument.load(file.buffer);
      if (!pdf.getPageCount()) throw new Error('Получен пустой PDF.');
      const pages = await output.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(page => output.addPage(page));
    } catch (error) {
      const status = (error as { getStatus?: () => number })?.getStatus?.();
      // Access failures are not missing labels. Never return another client's data.
      if (status === 401 || status === 403) throw error;
      if (split && (status === 400 || status === 404)) { await split(); return; }
      warnings.push(`${label}: ${error instanceof BadRequestException ? error.message : 'не удалось получить этикетку, повторите скачивание позже.'}`);
    }
  }
  const supplies = [...new Map(orders.filter(o => o.supplyId)
    .map(o => [JSON.stringify([o.connectionId, o.supplyId]), o])).values()];
  if (orders.some(o => !o.supplyId)) warnings.push('СЦ / ПВЗ: у части заказов ещё не привязана поставка.');
  for (const kind of ['sc', 'pvz'] as const) {
    for (const order of supplies) {
      await append(() => readers[kind]([order]), `${kind === 'sc' ? 'СЦ' : 'ПВЗ'} · ${order.supplyId}`);
    }
  }
  async function pairs(batch: Order[]): Promise<void> {
    await append(() => readers.pairs(batch), `ШК товара / заказа · ${batch.map(o => o.id).join(', ')}`,
      batch.length > 1 ? async () => {
        const mid = Math.ceil(batch.length / 2);
        await pairs(batch.slice(0, mid)); await pairs(batch.slice(mid));
      } : undefined);
  }
  await pairs(orders);
  if (!output.getPageCount()) throw new BadRequestException(`Нет доступных этикеток. ${warnings.join(' ')}`);
  return { fileBase64: Buffer.from(await output.save()).toString('base64'),
    fileName: 'FBS_WB_all_labels.pdf', pageCount: output.getPageCount(), warnings };
}
