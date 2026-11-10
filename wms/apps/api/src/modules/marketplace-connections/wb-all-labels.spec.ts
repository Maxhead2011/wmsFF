import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { wbAllLabels } from './wb-all-labels';

const order = (id = '1', connectionId = 'a') => ({ id, connectionId, supplyId: 's', marketplace: 'WILDBERRIES' });
async function file(width: number) { const pdf = await PDFDocument.create(); pdf.addPage([width, 100]); return { buffer: Buffer.from(await pdf.save()) }; }
const readers = () => ({ sc: vi.fn(() => file(11)), pvz: vi.fn(() => file(22)), pairs: vi.fn((_orders: any[]) => file(33)) });
// TEST: page dimensions identify parts without relying on implementation text.
describe('WB available-label ribbon', () => {
  // TEST: Ozon has order/product labels, but no WB SC or pickup-point labels.
  it('downloads Ozon pairs without requesting WB documents when enabled', async () => {
    const read = readers();
    const result = await wbAllLabels([{ ...order(), marketplace: 'OZON', supplyId: null }], read, true);
    expect(result.pageCount).toBe(1); expect(result.warnings).toEqual([]);
    expect(result.fileName).toBe('FBS_OZON_all_labels.pdf');
    expect(read.sc).not.toHaveBeenCalled(); expect(read.pvz).not.toHaveBeenCalled();
  });
  it('keeps SC, PVZ, paired pages in order and deduplicates supplies', async () => {
    const read = readers();
    const result = await wbAllLabels([order(), order(), order('2')], read);
    const pdf = await PDFDocument.load(Buffer.from(result.fileBase64, 'base64'));
    expect(pdf.getPages().map(page => page.getWidth())).toEqual([11, 22, 33]);
    expect(read.sc).toHaveBeenCalledTimes(1); expect(read.pvz).toHaveBeenCalledTimes(1);
    expect(read.pairs.mock.calls[0][0]).toHaveLength(2); expect(result.warnings).toEqual([]);
  });
  it('downloads available pairs when SC and cargo labels are not ready', async () => {
    const read = readers();
    read.sc.mockRejectedValue(new BadRequestException('Ещё не передана в доставку'));
    read.pvz.mockRejectedValue(new BadRequestException('Нет грузомест'));
    const result = await wbAllLabels([order()], read);
    expect(result.pageCount).toBe(1); expect(result.warnings.join(' ')).toContain('Нет грузомест');
    expect(result.warnings.join(' ')).toContain('СЦ'); expect(result.warnings.join(' ')).toContain('ПВЗ');
  });
  it('does not merge supplies belonging to different connections', async () => {
    const read = readers(); await wbAllLabels([order(), order('1', 'b')], read);
    expect(read.sc).toHaveBeenCalledTimes(2);
  });
  it('retains another order when a selected pair is unavailable', async () => {
    const read = readers();
    read.pairs = vi.fn(async (batch: any[]) => {
      if (batch.some(o => o.id === '2')) throw new BadRequestException('Стикер не готов');
      return file(33);
    }) as any;
    const result = await wbAllLabels([order(), order('2')], read);
    expect(result.pageCount).toBe(3); expect(result.warnings.join(' ')).toContain('2');
  });
  it('does not retry throttled batches or expose upstream error details', async () => {
    const read = readers(); read.pairs.mockRejectedValue(new Error('secret upstream HTTP429'));
    const result = await wbAllLabels([order(), order('2')], read);
    expect(read.pairs).toHaveBeenCalledTimes(1); expect(result.warnings.join(' ')).not.toContain('secret');
  });
  it('propagates permission failures instead of returning partial data', async () => {
    const read = readers(); read.pvz.mockRejectedValue(new ForbiddenException());
    await expect(wbAllLabels([order()], read)).rejects.toBeInstanceOf(ForbiddenException);
    expect(read.pairs).not.toHaveBeenCalled();
  });
  it('rejects non-WB and empty selections before accessing readers', async () => {
    const read = readers();
    await expect(wbAllLabels([{ ...order(), marketplace: 'OZON' }], read)).rejects.toThrow('Wildberries');
    await expect(wbAllLabels([], read)).rejects.toThrow('Wildberries'); expect(read.sc).not.toHaveBeenCalled();
  });
  it('does not download an empty PDF and reports missing supply', async () => {
    const read = readers(); read.pairs.mockRejectedValue(new BadRequestException('Не готов'));
    await expect(wbAllLabels([{ ...order(), supplyId: null }], read)).rejects.toThrow('Нет доступных');
    expect(read.sc).not.toHaveBeenCalled(); expect(read.pvz).not.toHaveBeenCalled();
  });
});
