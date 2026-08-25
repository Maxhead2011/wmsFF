import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';

describe('StockOperationsService: привязка КИЗ при перемещении', () => {
  // TEST: свободная маркированная единица должна принять свой КИЗ перед перемещением.
  it('после ШК привязывает новый КИЗ к товару в исходном коробе', async () => {
    const kiz = '0104680992593139215TEST-KIZ<GS>91EE12';
    const sku = {
      id: 'sku-marked',
      clientId: 'client-1',
      internalSku: 'SKU-MARKED',
      clientSku: null,
      article: 'ARTICLE-MARKED',
      name: 'Маркированный костюм',
      color: 'синий',
      size: '46',
      needsChestnyZnak: true,
      isUnmarked: false,
      barcodes: [{ value: '2052399347905', isPrimary: true }],
    };
    const sourceBox = {
      id: 'box-source',
      clientId: 'client-1',
      code: 'FFL_SOURCE_001',
      status: 'active',
      warehouseId: 'warehouse-1',
      palletId: null,
      zoneId: null,
      client: { id: 'client-1', code: 'CLIENT', name: 'Клиент' },
      zone: null,
      pallet: null,
      balances: [{
        id: 'balance-source',
        warehouseId: 'warehouse-1',
        balanceKey: 'source-key',
        clientId: 'client-1',
        skuId: sku.id,
        boxId: 'box-source',
        palletId: null,
        status: 'AVAILABLE',
        quantity: 6,
        sku,
      }],
    };
    let registeredMark: { id: string; skuId: string; boxId: string; value: string } | null = null;
    const tx = {
      box: { findUnique: vi.fn().mockResolvedValue(sourceBox) },
      productMark: {
        findFirst: vi.fn(async (args: any) => {
          const value = args.where?.value?.equals;
          return registeredMark && value === registeredMark.value ? registeredMark : null;
        }),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(async (args: any) => {
          registeredMark = {
            id: 'mark-1',
            skuId: args.data.skuId,
            boxId: args.data.boxId,
            value: args.data.value,
          };
          return registeredMark;
        }),
      },
      stockBalance: { findFirst: vi.fn().mockResolvedValue(sourceBox.balances[0]) },
    };
    const transferService = new StockOperationsService(
      {
        ...tx,
        $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
      } as never,
      { requireClientAccess: vi.fn() } as never,
      {} as never,
    );

    await expect(
      transferService.inspectTsdTransferItem(
        { fromBoxCode: sourceBox.code, scanCode: '2052399347905' },
        user(),
      ),
    ).resolves.toMatchObject({
      state: 'SCAN_KIZ',
      item: { skuId: sku.id, scanType: 'BARCODE' },
    });
    expect(tx.productMark.create).not.toHaveBeenCalled();

    await expect(
      transferService.inspectTsdTransferItem(
        {
          fromBoxCode: sourceBox.code,
          scanCode: kiz,
          skuId: sku.id,
          bindMissingKiz: true,
        },
        user(),
      ),
    ).resolves.toMatchObject({
      state: 'SCAN_ITEM',
      item: { skuId: sku.id, scanType: 'KIZ' },
    });
    expect(tx.productMark.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clientId: 'client-1',
        skuId: sku.id,
        boxId: sourceBox.id,
        value: kiz,
        status: 'AVAILABLE',
      }),
    }));

    await expect(
      transferService.inspectTsdTransferItem(
        { fromBoxCode: sourceBox.code, scanCode: kiz },
        user(),
      ),
    ).resolves.toMatchObject({
      state: 'SCAN_ITEM',
      item: { skuId: sku.id, scanType: 'KIZ' },
    });
  });
});

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'operator@example.com',
    name: 'Operator',
    roleCodes: ['OPERATOR'],
    permissionCodes: ['stock:write', 'system:admin'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}
