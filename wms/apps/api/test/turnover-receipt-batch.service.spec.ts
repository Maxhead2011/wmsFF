import { MovementType } from '@prisma/client';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

describe('TurnoverService receipt batch export', () => {
  it('exports movements by the date encoded in the box number', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'LUKIN', name: 'ИП Лукин' }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          receiptMovement('movement-1807', 'FFL_LKB1807_251'),
          receiptMovement('movement-1907', 'FFL_LKB1907_001'),
        ]),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new TurnoverService(prisma as never, clientScopes as never);

    const file = await service.getReceiptPeriodXlsx(
      { clientId: 'client-1', receiptBatchDate: '2026-07-18' },
      adminUser,
    );

    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          // TEST: preserve all batch predicates inside the warehouse-scope AND composition.
          AND: [{
            clientId: 'client-1',
            quantity: { gt: 0 },
            type: MovementType.RECEIPT,
            box: { code: { startsWith: 'FFL_LKB1807', mode: 'insensitive' } },
          }],
        }),
      }),
    );
    const workbook = XLSX.read(file.content);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[1]], { header: 1 });
    const values = rows.flat().map(String);
    expect(values).toContain('FFL_LKB1807_251');
    expect(values).not.toContain('FFL_LKB1907_001');
    expect(file.fileName).toContain('batch-2026-07-18');
  });
});

function receiptMovement(id: string, boxCode: string) {
  return {
    id,
    clientId: 'client-1',
    skuId: 'sku-1',
    type: MovementType.RECEIPT,
    quantity: 2,
    sourceDocument: 'Онлайн-приемка',
    createdAt: new Date('2026-07-21T07:21:07.500Z'),
    box: { id: `box-${id}`, code: boxCode },
    sku: {
      id: 'sku-1',
      internalSku: 'SKU-1',
      clientSku: 'CLIENT-SKU-1',
      article: 'Костюм_синий',
      name: 'Костюм',
      color: 'синий',
      size: 'XL',
      barcodes: [{ value: '2052467953793', isPrimary: true }],
    },
    productMarks: [],
  };
}

const adminUser: AuthUser = {
  id: 'admin-1',
  email: 'admin@example.test',
  name: 'Admin',
  roleCodes: ['ADMIN'],
  permissionCodes: ['system:admin'],
  clientScopeMode: 'ALL',
  clientIds: [],
  writableClientIds: [],
};

// TEST: client receipt export is a pivot of the same scoped movements, while staff keep locations.
it('summarizes client receipts across boxes and KIZ rows without mixing sizes', async () => {
  const first = receiptMovement('a', 'FFL_LKB1807_001');
  const second = receiptMovement('b', 'FFL_LKB1807_002');
  const third = receiptMovement('c', 'FFL_LKB1807_003');
  third.sku.size = 'M';
  third.sku.barcodes[0].value = '0000123456789';
  const prisma = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'LUKIN', name: 'ИП Лукин' }) },
    stockMovement: { findMany: vi.fn().mockResolvedValue([first, second, third]) },
  };
  const scopes = { requireClientAccess: vi.fn() };
  const service = new TurnoverService(prisma as never, scopes as never);
  const file = await service.getReceiptPeriodXlsx({ clientId: 'client-1' }, {
    ...adminUser, roleCodes: ['CLIENT'], permissionCodes: ['stock:read'],
  });
  const workbook = XLSX.read(file.content);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Приемка'], { header: 1 });
  expect(rows[0]).toEqual(['Товар', 'Артикул', 'Баркод', 'Цвет', 'Размер', 'Количество']);
  expect(rows.slice(1)).toEqual(expect.arrayContaining([
    ['Костюм', 'Костюм_синий', '2052467953793', 'синий', 'XL', 4],
    ['Костюм', 'Костюм_синий', '0000123456789', 'синий', 'M', 2],
  ]));
  expect(rows).toHaveLength(3);
  expect(JSON.stringify(workbook)).not.toContain('FFL_LKB');
  expect(scopes.requireClientAccess).toHaveBeenCalled();
});

// TEST: grouping follows the barcode even when historical SKU names differ.
it('groups different SKU records with the same barcode and keeps barcode-less SKUs separate', async () => {
  const a = receiptMovement('a', 'BOX-A');
  const b = receiptMovement('b', 'BOX-B');
  b.sku.internalSku = 'SKU-2'; b.sku.article = 'Other article';
  const c = receiptMovement('c', 'BOX-C'); c.sku.barcodes = []; c.sku.internalSku = 'SKU-3';
  const d = receiptMovement('d', 'BOX-D'); d.sku.barcodes = []; d.sku.internalSku = 'SKU-4';
  const service = new TurnoverService({
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'C', name: 'Client' }) },
    stockMovement: { findMany: vi.fn().mockResolvedValue([a, b, c, d]) },
  } as never, { requireClientAccess: vi.fn() } as never);
  const file = await service.getReceiptPeriodXlsx({ clientId: 'client-1' }, { ...adminUser, roleCodes: ['CLIENT'], permissionCodes: ['stock:read'] });
  const book = XLSX.read(file.content);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['Приемка'], { header: 1 }).slice(1);
  expect(rows).toHaveLength(3);
  expect(rows.find(row => row[2] === '2052467953793')?.[5]).toBe(4);
  expect(rows.reduce((total, row) => total + Number(row[5]), 0)).toBe(8);
});

// TEST: role routing never turns staff or outbound documents into client receipt summaries.
it.each([
  [['CLIENT'], ['stock:read'], MovementType.RECEIPT, true],
  [['CLIENT'], ['system:admin'], MovementType.RECEIPT, false],
  [['ADMIN'], ['stock:read'], MovementType.RECEIPT, false],
  [['CLIENT'], ['stock:read'], MovementType.SHIP, false],
] as const)('keeps document format scoped to client receipts (%j / %s)', async (roles, permissions, type, summary) => {
  const service = new TurnoverService({} as never, {} as never);
  vi.spyOn(service, 'getReceiptDocument').mockResolvedValue({
    movementId: 'movement', sourceDocument: 'Receipt', type, typeLabel: type === MovementType.SHIP ? 'Отгрузка' : 'Приемка',
    generatedAt: '2026-09-20T00:00:00Z', periodFrom: '2026-09-20T00:00:00Z', periodTo: '2026-09-20T00:00:00Z',
    totalQuantity: 2, skuCount: 1, boxesCount: 1, fileName: 'receipt.xlsx', client: { id: 'c', code: 'C', name: 'Client' },
    rows: [{ position: 1, movementId: 'movement', date: '2026-09-20T00:00:00Z', boxCode: 'BOX-PRIVATE', barcode: '00123',
      internalSku: 'SKU-1', clientSku: 'CLIENT-SKU', article: 'Article', name: 'Suit', color: 'Blue', size: 'M',
      quantity: 2, status: 'AVAILABLE', statusLabel: 'Доступно', kiz: 'KIZ-PRIVATE', sourceRows: [], comment: null }],
  } as never);
  const file = await service.getReceiptDocumentXlsx('movement', { ...adminUser, roleCodes: [...roles], permissionCodes: [...permissions] });
  const book = XLSX.read(file.content);
  const values = JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[1]], { header: 1 }));
  expect(values.includes('BOX-PRIVATE')).toBe(!summary);
  expect(values.includes('KIZ-PRIVATE')).toBe(!summary);
  expect(values).toContain('00123');
});
