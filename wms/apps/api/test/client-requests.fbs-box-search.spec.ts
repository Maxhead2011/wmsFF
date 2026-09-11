import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { ClientRequestsService } from '../src/modules/client-requests/client-requests.service';

const orderId = '1234567890';
const skuId = 'sku-cashmere-s44';
const user = {
  id: 'operator', roleCodes: ['BRANCH_MANAGER'], permissionCodes: [],
  clientScopeMode: 'LIMITED', clientIds: ['client'], writableClientIds: ['client'],
  activeWarehouseId: 'moscow', warehouseIds: ['moscow'], writableWarehouseIds: ['moscow'],
} as AuthUser;

function fixture() {
  const request = {
    id: 'request-1', number: 1, title: 'FBS', status: 'IN_WORK',
    clientId: 'client', warehouseId: 'moscow',
    client: { id: 'client', code: 'CL-1', name: 'Client', storesWithoutBoxes: false },
    items: [{
      id: 'item', skuId, barcode: '2000000000008', name: 'Cashmere S/44', quantity: 1,
      comment: `FBS-заказы: ${orderId}`,
      sku: { id: skuId, internalSku: 'cashmere-s44', article: 'cashmere', name: 'Cashmere S/44',
        barcodes: [{ value: '2000000000008' }] },
    }],
    fbsOrderLinks: [{ orderId }],
  };
  const balance = {
    skuId, boxId: 'box-467', quantity: 19,
    box: { id: 'box-467', code: 'FFL_TEST_001', status: 'active' },
  };
  const prisma = {
    clientRequest: {
      findUnique: vi.fn().mockResolvedValue(request),
      findMany: vi.fn().mockResolvedValue([{ id: request.id }]),
    },
    stockBalance: { findMany: vi.fn().mockResolvedValue([balance]) },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const service = new ClientRequestsService(prisma as never, new ClientScopeService(), {} as never);
  return { service, prisma, request, balance };
}

describe('FBS box search: single-order stock visibility', () => {
  // TEST: a request has stock for one unassigned order; its box must be visible.
  it('returns a box with free stock for just one unassigned order', async () => {
    const { service } = fixture();
    const result = await service.getFbsBoxSearch('request-1', user);
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0]).toMatchObject({
      boxCode: 'FFL_TEST_001', orderIds: [orderId], candidateOrderIds: [orderId],
      confirmedOrderIds: [], items: [expect.objectContaining({ availableQuantity: 19, freeQuantity: 19 })],
    });
    expect(result.summary).toMatchObject({ boxes: 1, orders: 1, confirmedOrders: 0, unmatchedOrders: 0 });
    expect(result.unmatchedOrderIds).toEqual([]);
  });

  // TEST: visibility must not offer stock fully reserved by another assembly.
  it('keeps fully reserved stock unavailable for an unassigned order', async () => {
    const { service, prisma } = fixture();
    prisma.fbsTsdAssembly.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { skuId, boxId: null, reservedBoxId: 'box-467', itemCount: 19 },
    ]);
    const result = await service.getFbsBoxSearch('request-1', user);
    expect(result.boxes).toEqual([]);
    expect(result.unmatchedOrderIds).toEqual([orderId]);
  });

  // TEST: a confirmed box remains visible even when its free quantity is zero.
  it('preserves the confirmed box and reservation accounting', async () => {
    const { service, prisma } = fixture();
    prisma.fbsTsdAssembly.findMany.mockResolvedValueOnce([
      { orderId, requestItemId: 'item', skuId, boxId: 'box-467', status: 'IN_PROGRESS' },
    ]).mockResolvedValueOnce([{ skuId, boxId: 'box-467', reservedBoxId: null, itemCount: 19 }]);
    const result = await service.getFbsBoxSearch('request-1', user);
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0].confirmedOrderIds).toEqual([orderId]);
    expect(result.boxes[0].items[0].freeQuantity).toBe(0);
    expect(result.summary.confirmedOrders).toBe(1);
  });

  // TEST: Excel must include the same single-order box as the on-screen search.
  it('includes the single-order candidate in the Excel export', async () => {
    const { service } = fixture();
    const file = await service.getFbsBoxSearchXlsx('request-1', user);
    const workbook = XLSX.read(file.content, { type: 'buffer' });
    const rows = workbook.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }));
    expect(JSON.stringify(rows)).toContain('FFL_TEST_001');
    expect(JSON.stringify(rows)).toContain(orderId);
  });

  // TEST: preserve the client/warehouse scope and deleted/archived box exclusion.
  it('queries only the request warehouse and eligible stock', async () => {
    const { service, prisma } = fixture();
    await service.getFbsBoxSearch('request-1', user);
    expect(prisma.stockBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      clientId: 'client', warehouseId: 'moscow', status: 'AVAILABLE', quantity: { gt: 0 },
      box: { status: { notIn: ['deleted', 'archived'] } },
    }) }));
  });

  // TEST: expanding results must not expose a request from another client or branch.
  it.each(['client', 'warehouse'])('rejects a request outside the user %s scope', async (scope) => {
    const { service, prisma, request } = fixture();
    if (scope === 'client') request.clientId = 'other-client';
    else request.warehouseId = 'other-warehouse';
    await expect(service.getFbsBoxSearch('request-1', user)).rejects.toBeInstanceOf(
      scope === 'client' ? ForbiddenException : NotFoundException,
    );
    expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
  });
});
