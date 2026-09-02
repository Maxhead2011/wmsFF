import { describe, expect, it, vi } from 'vitest';
import { ServiceCenterController } from '../src/modules/service/service-center.controller';

describe('ServiceCenterController storage optimization', () => {
  it('returns a read-only optimization report for the selected client', async () => {
    const optimization = {
      buildReport: vi.fn().mockResolvedValue({
        client: { id: 'client-lukin', code: 'LUKIN', name: 'Лукин Илья Ильич' },
        summary: { totalUnits: 18 },
        targetBoxes: [],
        rows: [],
      }),
    };
    const controller = new ServiceCenterController({} as never, optimization as never);

    // TEST: the endpoint delegates by client id and performs no stock mutation itself.
    const result = await controller.getStorageOptimization('client-lukin');

    expect(optimization.buildReport).toHaveBeenCalledWith('client-lukin');
    expect(result.client.id).toBe('client-lukin');
  });
});
