import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  BOX_CODE_POLICY_SETTING,
  BoxCodePolicyService,
} from '../src/common/boxes/box-code-policy.service';

describe('BoxCodePolicyService', () => {
  // TEST: additional storage prefixes are opt-in per WMS and never replace the primary prefix.
  it('accepts FFL_LKBBOX aliases while keeping the configured primary and rejecting ordinary boxes', async () => {
    const service = new BoxCodePolicyService({ get: async () => ({
      storageBoxPrefix: 'FFL_BOX_', storageBoxAliases: [' ffl_lkbbox ', 'FFL_LKBBOX'],
    }) } as never);
    await expect(service.requireStorageBox(' ffl_lkbbox_001 ')).resolves.toBe('FFL_LKBBOX_001');
    await expect(service.requireStorageBox('ffl_lkbbox001')).resolves.toBe('FFL_LKBBOX001');
    await expect(service.requireStorageBox('FFL_BOX_001')).resolves.toBe('FFL_BOX_001');
    for (const code of ['FFL_LKB001', 'FFL_LKBBOX', 'FFL_BOX_', 'SBOX_001']) {
      await expect(service.requireStorageBox(code)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await service.getPolicy()).toMatchObject({ storageBoxAliases: ['FFL_LKBBOX'] });
  });

  // TEST: installations without an explicit alias retain their existing validation.
  it('does not enable the WMSFF2207 alias for other installations by default', async () => {
    const service = new BoxCodePolicyService({ get: async () => ({ storageBoxPrefix: 'FFL_BOX_' }) } as never);
    await expect(service.requireStorageBox('FFL_LKBBOX001')).rejects.toThrow();
    await expect(service.requireStorageBox('FFL_BOX_001')).resolves.toBe('FFL_BOX_001');
  });

  // TEST: the current settings screen omits aliases; saving it must not remove this setting.
  it('preserves aliases on legacy updates and permits explicit removal', async () => {
    let stored: unknown = { storageBoxPrefix: 'FFL_BOX_', storageBoxAliases: ['FFL_LKBBOX'] };
    const service = new BoxCodePolicyService({ get: async () => stored,
      set: async (_key: string, value: unknown) => { stored = value; },
    } as never);
    await service.updatePolicy({ storageBoxPrefix: 'FFL_BOX_' }, 'admin-1');
    await expect(service.requireStorageBox('FFL_LKBBOX001')).resolves.toBe('FFL_LKBBOX001');
    await service.updatePolicy({ storageBoxPrefix: 'FFL_BOX_', storageBoxAliases: [] }, 'admin-1');
    await expect(service.requireStorageBox('FFL_LKBBOX001')).rejects.toThrow();
  });

  // TEST: aliases pass through the same validation as the primary prefix.
  it('rejects malformed aliases', async () => {
    const service = new BoxCodePolicyService({ get: async () => ({ storageBoxAliases: ['BAD PREFIX'] }) } as never);
    await expect(service.getPolicy()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('принимает настроенный префикс и исправляет известную опечатку', async () => {
    const settings = {
      get: vi.fn().mockResolvedValue({
        primaryPrefix: 'LOGOFF_',
        allowedPrefixes: ['LOGOFF_', 'FFL_'],
        receiptPrefix: 'LOGOFF_LKB',
        balancePrefix: 'LOGOFF_BAL',
        autoCorrections: { 'LG_': 'LOGOFF_' },
      }),
      set: vi.fn(),
    };
    const service = new BoxCodePolicyService(settings as never);

    await expect(service.requireAllowed('lg_001')).resolves.toBe('LOGOFF_001');
    expect(settings.get).toHaveBeenCalledWith(BOX_CODE_POLICY_SETTING, expect.any(Object));
  });

  it('отклоняет короб с посторонним префиксом', async () => {
    const settings = {
      get: vi.fn().mockResolvedValue({
        primaryPrefix: 'LOGOFF_',
        allowedPrefixes: ['LOGOFF_'],
        receiptPrefix: 'LOGOFF_LKB',
        balancePrefix: 'LOGOFF_BAL',
        autoCorrections: {},
      }),
    };
    const service = new BoxCodePolicyService(settings as never);

    await expect(service.requireAllowed('OTHER_001')).rejects.toBeInstanceOf(BadRequestException);
  });
});
