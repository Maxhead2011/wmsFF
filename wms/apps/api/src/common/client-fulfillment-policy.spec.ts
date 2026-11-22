import { expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { configuredRule, requireSettingsEditor } from './client-fulfillment-policy';
// TEST: defaults, explicit overrides, client isolation and permissions.
it('reads independent rules with the original Palitra defaults', async () => {
  const db = {systemSetting:{findUnique:vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({value:false}).mockResolvedValueOnce({value:true})}};
  const id = 'e8597352-0b93-442c-9582-c694620a9695';
  expect(await configuredRule(db as unknown as Pick<Prisma.TransactionClient,'systemSetting'>,id,'zones')).toBe(true);
  expect(await configuredRule(db as unknown as Pick<Prisma.TransactionClient,'systemSetting'>,id,'pickKiz')).toBe(false);
  expect(await configuredRule(db as unknown as Pick<Prisma.TransactionClient,'systemSetting'>,'other','zones')).toBe(true);
  expect(new Set(db.systemSetting.findUnique.mock.calls.map(([q]) => q.where.key)).size).toBe(3);
});
it('allows only administrators and owners to edit', () => {
  expect(() => requireSettingsEditor(['MANAGER'])).toThrow();
  for (const role of ['ADMIN','OWNER']) expect(() => requireSettingsEditor([role])).not.toThrow();
});

// TEST: scoped read/write permission alone is insufficient on all settings endpoints.
it('rejects manager writes before invoking any client settings operation', async () => {
  const {ClientKizPolicyController} = await import('../modules/clients/client-kiz-policy.controller');
  const {ProductDisplayController} = await import('../modules/clients/product-display.controller');
  const save = vi.fn();
  const controller = new ClientKizPolicyController({save,saveFulfillment:save} as never);
  const display = new ProductDisplayController({save} as never);
  const manager = {roleCodes:['MANAGER'],permissionCodes:['clients:write']} as never;
  expect(() => controller.save('client',true,manager)).toThrow();
  expect(() => controller.saveFulfillment('client','zones',false,manager)).toThrow();
  expect(() => display.save('client',null,manager)).toThrow();
  expect(save).not.toHaveBeenCalled();
});
