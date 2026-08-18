import { describe, expect, it, vi } from 'vitest';
import { FbsStockAllocationExternalController } from '../src/modules/marketplace-connections/fbs-stock-allocation-external.controller';

describe('FBS stock allocation external API', () => {
  // TEST: the API key identity, not request data, selects the client whose stock can change.
  it('binds every external update to the client stored in the API key', async () => {
    const allocation = {
      authenticateApiKey: vi.fn().mockResolvedValue({ id: 'key-1', clientId: 'client-owner' }),
      saveExternalStockOverrides: vi.fn().mockResolvedValue({
        updated: true,
        duplicate: false,
      }),
    };
    const connections = {
      syncExternalFbsStockAllocation: vi.fn().mockResolvedValue({ synced: true }),
    };
    const controller = new FbsStockAllocationExternalController(
      allocation as never,
      connections as never,
    );
    const dto = {
      connectionId: 'connection-owner',
      externalReference: 'accounting-operation-42',
      items: [{ skuId: 'sku-1', requestedAmount: 7 }],
    };

    await controller.updateStocks('wms_fbs_test_key_that_is_long_enough', dto);

    expect(allocation.saveExternalStockOverrides).toHaveBeenCalledWith(
      'client-owner',
      'key-1',
      dto,
    );
    expect(connections.syncExternalFbsStockAllocation).toHaveBeenCalledWith(
      'client-owner',
      'connection-owner',
    );
  });

  // TEST: an idempotent retry does not start a second WB stock synchronization.
  it('does not synchronize a duplicate external operation twice', async () => {
    const allocation = {
      authenticateApiKey: vi.fn().mockResolvedValue({ id: 'key-1', clientId: 'client-owner' }),
      saveExternalStockOverrides: vi.fn().mockResolvedValue({
        updated: false,
        duplicate: true,
        changeId: 'change-1',
      }),
    };
    const connections = {
      syncExternalFbsStockAllocation: vi.fn(),
    };
    const controller = new FbsStockAllocationExternalController(
      allocation as never,
      connections as never,
    );

    await controller.updateStocks('wms_fbs_test_key_that_is_long_enough', {
      connectionId: 'connection-owner',
      externalReference: 'same-operation',
      items: [{ skuId: 'sku-1', requestedAmount: 7 }],
    });

    expect(connections.syncExternalFbsStockAllocation).not.toHaveBeenCalled();
  });
});
