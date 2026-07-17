import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

describe('StockOperationsService: предпросмотр перемещений', () => {
  it('учитывает предыдущие строки файла и помечает нехватку до записи в БД', async () => {
    const sku = {
      id: 'sku-1',
      clientId: 'client-1',
      internalSku: 'SKU-1',
      name: 'Тестовый товар',
    };
    const prisma = {
      box: {
        findMany: vi.fn().mockResolvedValue([{ code: 'FFL_SOURCE' }]),
      },
      barcode: {
        findMany: vi.fn().mockResolvedValue([{ value: '4600000000001', sku }]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: sku.id,
            quantity: 5,
            box: { code: 'FFL_SOURCE' },
          },
        ]),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new StockOperationsService(
      prisma as never,
      clientScopes as never,
      { balanceKey: vi.fn() } as never,
    );

    const brokenRussianFileName = Buffer.from('Перемещения в новый короб.xlsx', 'utf8').toString('latin1');
    const preview = await service.previewBoxTransfersXlsx(
      'client-1',
      xlsxFile([
        ['Короб откуда', 'ШК', 'Короб куда', 'Количество'],
        ['FFL_SOURCE', '4600000000001', 'FFL_TARGET', 3],
        ['', '4600000000001', '', 3],
      ], brokenRussianFileName),
      {
        id: 'admin-1',
        email: 'admin@example.test',
        name: 'Администратор',
        roleCodes: ['ADMIN'],
        permissionCodes: ['stock:write'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1' }),
      'client-1',
      'write',
    );
    expect(preview.summary).toEqual({ rows: 2, readyRows: 1, errorRows: 1, quantity: 3 });
    expect(preview.fileName).toBe('Перемещения в новый короб.xlsx');
    expect(preview.rows[0]).toMatchObject({ status: 'READY', availableQuantity: 5, targetBoxExists: false });
    expect(preview.rows[1]).toMatchObject({ status: 'ERROR', availableQuantity: 2 });
    expect(preview.rows[1]).toMatchObject({ fromBoxCode: 'FFL_SOURCE', toBoxCode: 'FFL_TARGET' });
    expect(preview.rows[1].message).toContain('доступно 2, требуется 3');
  });
});

function xlsxFile(rows: unknown[][], originalname = 'Перемещения.xlsx') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Перемещения');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}
