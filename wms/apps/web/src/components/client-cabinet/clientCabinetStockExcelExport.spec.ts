import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateStockRows, downloadClientCabinetStockExcel } from './clientCabinetStockExcelExport';
import { recordCabinetStockExport } from '../../lib/api';
vi.mock('../../lib/api', () => ({ recordCabinetStockExport: vi.fn() }));

const row = (quantity: number, status: string, freeQuantity?: number): any => ({
  skuId: 'sku', quantity, status, freeQuantity, updatedAt: '2026-09-16T00:00:00Z',
  sku: { id: 'sku', name: 'Suit', internalSku: 'suit-xs', barcodes: [{ value: '123', isPrimary: true }] },
});

// TEST: a download and its audit must describe one identical snapshot, including active filters.
describe('cabinet export audit ordering', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
  function browser() {
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });
    vi.stubGlobal('window', { setTimeout: vi.fn() });
    const blob = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    return { link, blob };
  }
  it('waits for the journal and exports exactly the recorded quantities', async () => {
    const { link, blob } = browser();
    let resolve!: (value: any) => void;
    vi.mocked(recordCabinetStockExport).mockImplementation(() => new Promise(done => { resolve = done; }));
    const stock = row(7, 'AVAILABLE', 5);
    const pending = downloadClientCabinetStockExcel({ id: 'client', code: 'CL1', name: 'Client' } as any,
      [stock], false, [], { accessToken: 'token', search: 'suit', section: 'stock' });
    expect(link.click).not.toHaveBeenCalled();
    const snapshot = vi.mocked(recordCabinetStockExport).mock.calls[0][1];
    expect(snapshot.filters).toEqual({ search: 'suit', section: 'stock', scope: 'all_filtered_rows' });
    expect(snapshot.rows[0].quantity).toBe(5);
    stock.quantity = 100;
    resolve({ recorded: true, id: 'audit' });
    await pending;
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.download).toBe(snapshot.fileName);
    const html = await (blob.mock.calls[0][0] as Blob).text();
    expect(html).toContain('<td>5</td>');
    expect(html).not.toContain('<td>100</td>');
  });
  it('does not download if the journal write fails', async () => {
    const { link } = browser();
    vi.mocked(recordCabinetStockExport).mockRejectedValue(new Error('journal unavailable'));
    await expect(downloadClientCabinetStockExcel({ id: 'client', code: 'CL1' } as any,
      [row(5, 'AVAILABLE', 5)], false, [], { accessToken: 'token', search: '', section: 'skus' })).rejects.toThrow('journal unavailable');
    expect(link.click).not.toHaveBeenCalled();
  });
});
// TEST: Excel receives the unified free amount and must not add PACKING or subtract requests again.
describe('cabinet Excel lifecycle quantities', () => {
  it('exports available minus all WB demand exactly once', () => {
    const requests: any = [{ type: 'OUTBOUND', status: 'IN_WORK', items: [{ skuId: 'sku', quantity: 2 }] }];
    expect(aggregateStockRows([row(7, 'AVAILABLE', 5), row(2, 'PACKING', 0)], requests)[0].quantity).toBe(5);
  });
  it('does not export a product with only packing or fully reserved stock', () => {
    expect(aggregateStockRows([row(2, 'PACKING', 0), row(1, 'AVAILABLE', 0)], [])).toEqual([]);
  });
  it('keeps the sold WMS calculation when no lifecycle fields are supplied', () => {
    expect(aggregateStockRows([row(5, 'AVAILABLE')], [
      { type: 'OUTBOUND', status: 'IN_WORK', items: [{ skuId: 'sku', quantity: 2 }] } as any,
    ])[0].quantity).toBe(3);
  });
});
