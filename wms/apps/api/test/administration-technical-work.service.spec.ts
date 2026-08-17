import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdministrationTechnicalWorkService } from '../src/modules/administration/administration-technical-work.service';

describe('AdministrationTechnicalWorkService: confirmation boundary', () => {
  const owner = {
    id: 'owner-1',
    administrationEnabled: true,
    isDemo: false,
  } as never;

  function setup() {
    const prisma = {
      fbsTsdAssembly: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'task-1', requestId: 'request-1', status: 'RETURN_REQUIRED' })
          .mockResolvedValueOnce({ status: 'RETURNED' }),
      },
    };
    const auditLog = { write: vi.fn().mockResolvedValue(undefined) };
    const marketplaceConnections = {
      resolveFbsSyncConflict: vi.fn().mockResolvedValue({ message: 'Решение применено.' }),
    };
    const service = new AdministrationTechnicalWorkService(
      prisma as never,
      auditLog as never,
      marketplaceConnections as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, auditLog, marketplaceConnections };
  }

  // ADDED: A direct request cannot bypass the confirmation shown by the web UI.
  it.each([
    ['RETURN_TO_STOCK', '', 'ВЕРНУТЬ'],
    ['MANAGER_CONFIRMED', 'неверная фраза', 'ПОДТВЕРДИТЬ'],
  ])('не применяет %s без точной фразы подтверждения', async (action, confirmation, expected) => {
    const { service, prisma, marketplaceConnections } = setup();

    await expect(service.apply({
      issueId: 'STATUS:request-1:task-1',
      action,
      confirmation,
      comment: 'Проверено менеджером',
    }, owner)).rejects.toThrow(new BadRequestException(`Подтвердите действие словом «${expected}».`));

    expect(prisma.fbsTsdAssembly.findUnique).not.toHaveBeenCalled();
    expect(marketplaceConnections.resolveFbsSyncConflict).not.toHaveBeenCalled();
  });

  // ADDED: The valid phrase reaches the existing repair exactly once and is verified afterward.
  it('применяет возврат при точном подтверждении', async () => {
    const { service, auditLog, marketplaceConnections } = setup();

    const result = await service.apply({
      issueId: 'STATUS:request-1:task-1',
      action: 'RETURN_TO_STOCK',
      confirmation: '  вернуть  ',
    }, owner);

    expect(marketplaceConnections.resolveFbsSyncConflict).toHaveBeenCalledTimes(1);
    expect(marketplaceConnections.resolveFbsSyncConflict).toHaveBeenCalledWith(
      'request-1',
      'task-1',
      { action: 'RETURN_TO_STOCK', comment: undefined },
      owner,
    );
    expect(auditLog.write).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ applied: true, verified: true }));
  });

  // ADDED: An unavailable route audit must never be rendered as an empty healthy result.
  it('не скрывает сбой анализа маршрута сообщением об отсутствии проблем', async () => {
    const auditFailure = new Error('База временно недоступна');
    const service = new AdministrationTechnicalWorkService(
      {} as never,
      {} as never,
      {} as never,
      {
        listActiveRequests: vi.fn().mockResolvedValue([{ id: 'request-1' }]),
        auditRequest: vi.fn().mockRejectedValue(auditFailure),
      } as never,
      {} as never,
    );

    await expect(service.diagnose('REQUESTS', owner)).rejects.toBe(auditFailure);
  });
});
