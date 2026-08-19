import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { CreateIntegrationStockAdjustmentDto } from '../src/modules/integration-api/dto/create-stock-adjustment.dto';
import { IntegrationApiService } from '../src/modules/integration-api/integration-api.service';

describe('IntegrationApiService stock adjustments', () => {
  it('принимает корректировку бескоробного остатка без boxCode', async () => {
    // ADDED: контракт API не должен снова сделать boxCode обязательным.
    const dto = Object.assign(new CreateIntegrationStockAdjustmentDto(), {
      barcode: '697149012584',
      countedQuantity: 2,
      idempotencyKey: 'external-adjustment-1',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('передает отсутствующий boxCode в безопасную бескоробную ветку ledger', async () => {
    // ADDED: сервис не вызывает trim у отсутствующего boxCode и сохраняет idempotency.
    const adjustInventoryToCounted = vi.fn().mockResolvedValue({
      idempotencyKey: 'CLIENT_API:aaaaaaaaaaaa:external-adjustment-1',
      status: 'NO_CHANGE',
      skuId: 'sku-1',
      box: null,
      previousQuantity: 1,
      countedQuantity: 1,
      delta: 0,
    });
    const service = new IntegrationApiService(
      {} as never,
      { adjustInventoryToCounted } as never,
    );

    await expect(
      service.adjustStock(
        {
          credential: {
            id: 'credential-1',
            name: 'External WMS',
            keyPrefix: 'aaaaaaaaaaaa',
            clientId: 'client-1',
            warehouseId: 'warehouse-1',
          },
          scopes: ['stock:write'],
          clientIp: '127.0.0.1',
        } as never,
        {
          barcode: '697149012584',
          countedQuantity: 1,
          idempotencyKey: 'external-adjustment-1',
        },
      ),
    ).resolves.toMatchObject({ data: { status: 'NO_CHANGE', box: null } });
    expect(adjustInventoryToCounted).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        barcode: '697149012584',
        boxCode: undefined,
        countedQuantity: 1,
        idempotencyKey: 'CLIENT_API:aaaaaaaaaaaa:external-adjustment-1',
      }),
      expect.objectContaining({
        activeWarehouseId: 'warehouse-1',
        writableWarehouseIds: ['warehouse-1'],
      }),
    );
  });
});
