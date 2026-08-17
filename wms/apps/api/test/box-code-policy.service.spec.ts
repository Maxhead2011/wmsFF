import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  BOX_CODE_POLICY_SETTING,
  BoxCodePolicyService,
} from '../src/common/boxes/box-code-policy.service';

describe('BoxCodePolicyService', () => {
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
