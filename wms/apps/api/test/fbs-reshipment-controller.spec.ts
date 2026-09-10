import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FbsReshipmentController } from '../src/modules/marketplace-connections/fbs-reshipment.controller';
import { CreateFbsReshipmentDto, PreviewFbsReshipmentDto } from '../src/modules/marketplace-connections/dto/fbs-reshipment.dto';
import type { AuthUser } from '../src/modules/auth/auth.types';

// TEST: real route metadata/DTO validation; no external service is bootstrapped.
describe('reshipment HTTP contract', () => {
  it('registers only the isolated permission-protected endpoints', () => {
    expect(Reflect.getMetadata('path', FbsReshipmentController)).toContain('marketplace-connections/fbs/reshipment');
    expect(Reflect.getMetadata('requiredPermissions', FbsReshipmentController)).toEqual(['clients:write']);
    for (const name of ['check', 'preview', 'create', 'resume'] as const) {
      expect(Reflect.getMetadata('path', FbsReshipmentController.prototype[name])).toBe(name);
      expect(Reflect.getMetadata('method', FbsReshipmentController.prototype[name])).toBe(1); // POST
    }
  });
  it('passes authenticated context and exact body through each isolated action', async () => {
    const service = { capabilities: vi.fn(), check: vi.fn(), preview: vi.fn(), create: vi.fn(), resume: vi.fn() };
    const controller = new FbsReshipmentController(service as never);
    const user = { id: 'admin' } as AuthUser;
    const body = { clientId: 'client', orders: [{ id: '1', connectionId: 'c' }], mode: 'SAME_ITEM' as const,
      confirm: true, previewToken: 'a'.repeat(64), runId: 'run' };
    controller.capabilities(user); expect(service.capabilities).toHaveBeenCalledWith(user);
    for (const name of ['check', 'preview', 'create', 'resume'] as const) {
      await controller[name](body, user); expect(service[name]).toHaveBeenCalledWith(body, user);
    }
  });
  it('rejects false confirmation, invalid modes, empty and oversized selections', () => {
    const good = { clientId: 'client', orders: [{ id: '1', connectionId: 'c' }], mode: 'SAME_ITEM', confirm: true, previewToken: 'a'.repeat(64) };
    expect(validateSync(plainToInstance(CreateFbsReshipmentDto, good))).toEqual([]);
    for (const override of [{ confirm: false }, { mode: 'FORCE' }, { orders: [] }, { orders: Array(101).fill(good.orders[0]) }, { orders: [{ id: '', connectionId: 'c' }] }]) {
      expect(validateSync(plainToInstance(CreateFbsReshipmentDto, { ...good, ...override })).length).toBeGreaterThan(0);
    }
    expect(validateSync(plainToInstance(PreviewFbsReshipmentDto, { ...good, mode: 'NEW_ITEM' }))).toEqual([]);
  });
});
