import { describe, it, expect } from 'vitest';
import { recoveryInput, recoveryWarehouse, type RecoveryInput } from '../src/modules/administration/fbo-problems-policy';
describe('FBO recovery permissions and explicit intent', () => {
    const actor = (role: string, branches: string[] = []) => ({ status: 'ACTIVE', roles: [{ role: { code: role } }], warehouseScopes: branches.map(warehouseId => ({ warehouseId, canRead: true, canWrite: true })) });
    // TEST: a selected branch alone cannot grant access to an administrator.
    it('allows owner and restricts admin to one persisted writable branch', () => {
        expect(recoveryWarehouse(actor('OWNER'))).toBeNull();
        expect(recoveryWarehouse(actor('ADMIN', ['a']))).toBe('a');
        for (const u of [actor('MANAGER', ['a']), actor('ADMIN'), actor('ADMIN', ['a', 'b']), { ...actor('OWNER'), isDemo: true }, { ...actor('OWNER'), status: 'BLOCKED' }])
            expect(() => recoveryWarehouse(u)).toThrow();
    });
    // TEST: malformed input fails as a business validation error, never a runtime trim error.
    it('requires reason, physical confirmation, exact unit and box selections', () => {
        const valid: RecoveryInput = { action: 'PACK_UNITS', reason: 'Физически вложено', physicalConfirmed: true, unitIds: ['a'], targetBoxCode: ' BOX ' };
        expect(recoveryInput(valid).targetBoxCode).toBe('BOX');
        for (const patch of [{ reason: '' }, { physicalConfirmed: false }, { unitIds: [] }, { unitIds: ['a', 'a'] }, { targetBoxCode: 2 }, { action: 'OTHER' }, { action: 'ADD_BOXES', boxCodes: [] }])
            expect(() => recoveryInput({ ...valid, ...patch } as RecoveryInput)).toThrow();
    });
});
