import { afterEach, expect, it, vi } from 'vitest';
import { TsdOperationLogService } from '../src/modules/tsd/tsd-operation-log.service';
afterEach(() => vi.unstubAllEnvs());
// TEST: replay checks must not fetch screenshot bytes or the full scan payload.
it('reads only the persisted replay receipt, with the same replay result', async () => {
  vi.stubEnv('WMS_COMPACT_OPERATION_RECEIPTS_ENABLED','true');
  const findUnique = vi.fn().mockResolvedValue({status:'ACCEPTED',serverMessage:'ok'});
  const service = new TsdOperationLogService({tsdOperation:{findUnique}} as never, {} as never);
  const row = await service.findExisting('key');
  const query = findUnique.mock.calls[0][0];
  expect(query.select).toEqual({status:true,serverMessage:true,reviewReason:true,resolutionMessage:true});
  expect(service.existingResult({operationKey:'key',operationType:'scan'} as never,row!)).toMatchObject({status:'ALREADY_APPLIED',message:'ok'});
});
it('preserves the legacy query when disabled', async () => {
  const findUnique = vi.fn().mockResolvedValue(null);
  await new TsdOperationLogService({tsdOperation:{findUnique}} as never,{} as never).findExisting('key');
  expect(findUnique).toHaveBeenCalledWith({where:{operationKey:'key'}});
});
