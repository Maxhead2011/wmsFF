import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockBalancesService } from './stock-balances.service';
import { CabinetStockExportDto } from './dto/cabinet-stock-export.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

// TEST: exact exported snapshot and trusted request metadata must survive later stock changes.
describe('cabinet stock export audit', () => {
  afterEach(() => vi.unstubAllEnvs());
  const dto = () => ({ clientId: 'client', fileName: 'ostatki.xls', generatedAt: '2026-10-07T10:00:00.000Z',
    filters: { search: 'blue', section: 'stock', scope: 'all_filtered_rows' },
    rows: [{ barcode: '123', internalSku: 'blue-M', name: 'Suit', status: 'Доступно', quantity: 5, updatedAt: '2026-10-07T09:00:00.000Z' }] });
  function setup() {
    const create = vi.fn().mockResolvedValue({ id: 'audit', createdAt: new Date() });
    const requireClientAccess = vi.fn();
    const service = new StockBalancesService({ auditLog: { create } } as any, { requireClientAccess } as any);
    return { service, create, requireClientAccess };
  }
  it('records actor, IP, filters, exact rows and server-derived totals', async () => {
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
    const { service, create, requireClientAccess } = setup();
    await (service as any).recordCabinetExport(dto(), { id: 'manager', name: 'Manager' }, { ip: '192.0.2.4', userAgent: 'Edge' });
    expect(requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client', 'read');
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: 'manager', action: 'CLIENT_STOCK_EXPORT_PREPARED', entityId: 'client',
      payload: { ipAddress: '192.0.2.4', userAgent: 'Edge', filters: dto().filters, rows: dto().rows, rowCount: 1, totalQuantity: 5 } });
  });
  it('rejects another client before writing', async () => {
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
    const { service, create, requireClientAccess } = setup();
    requireClientAccess.mockImplementation(() => { throw new Error('forbidden'); });
    await expect((service as any).recordCabinetExport(dto(), { id: 'manager' }, {})).rejects.toThrow('forbidden');
    expect(create).not.toHaveBeenCalled();
  });
  it('preserves sold WMS behaviour with the existing flag off', async () => {
    vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'false');
    const { service, create } = setup();
    expect(await (service as any).recordCabinetExport(dto(), { id: 'manager' }, {})).toEqual({ recorded: false });
    expect(create).not.toHaveBeenCalled();
  });
  it('validates nested filters and quantities and rejects spoofed request metadata', async () => {
    expect(await validate(plainToInstance(CabinetStockExportDto, dto()))).toEqual([]);
    const invalid = { ...dto(), ipAddress: 'fake', filters: { ...dto().filters, scope: 'current-page' },
      rows: [{ ...dto().rows[0], quantity: -1 }] };
    const errors = await validate(plainToInstance(CabinetStockExportDto, invalid), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map(error => error.property)).toEqual(expect.arrayContaining(['ipAddress', 'filters', 'rows']));
  });
  it('rejects missing filters and oversized exports', async () => {
    const errors = await validate(plainToInstance(CabinetStockExportDto, { ...dto(), filters: undefined, rows: Array(20001).fill(dto().rows[0]) }));
    expect(errors.map(error => error.property)).toEqual(expect.arrayContaining(['filters', 'rows']));
  });
});
