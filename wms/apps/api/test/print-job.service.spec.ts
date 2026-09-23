import { BadRequestException } from '@nestjs/common';
import { LabelTemplateType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { LabelTemplateService } from '../src/modules/print/label-template.service';
import { PrintJobService } from '../src/modules/print/print-job.service';

describe('PrintJobService', () => {
  function createService(options: { isActive?: boolean } = {}) {
    const prisma = {
      printJob: {
        create: vi.fn().mockImplementation(({ data }) => ({ id: 'job-1', createdAt: new Date(), ...data })),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-1',
          printerCode: 'TSC-01',
          labelType: LabelTemplateType.BOX,
          payload: { source: 'label-template', templateCode: 'BOX_STANDARD' },
          tspl: 'PRINT 1',
          status: 'printed',
        }),
        update: vi.fn().mockImplementation(({ data }) => ({ id: 'job-1', createdAt: new Date(), ...data })),
      },
    } as unknown as PrismaService;

    const templates = {
      getTemplateOrThrow: vi.fn().mockResolvedValue({
        id: 'tpl-1',
        code: 'BOX_STANDARD',
        name: 'Box standard',
        type: LabelTemplateType.BOX,
        tspl: 'TEXT 10,10,"2",0,1,1,"{{boxCode}}"',
        version: 3,
        isActive: options.isActive ?? true,
      }),
      renderTspl: vi.fn().mockReturnValue('TEXT 10,10,"2",0,1,1,"BOX-001"'),
    } as unknown as LabelTemplateService;
    const printers = {
      getActivePrinterOrThrow: vi.fn().mockResolvedValue({ code: 'TSC-01', groupCode: 'DEFAULT' }),
    };
    const printerScopes = {
      requirePrinterGroupAccess: vi.fn(),
      resolvePrinterGroupFilter: vi.fn().mockReturnValue(undefined),
    };

    return {
      service: new PrintJobService(prisma, templates, printers as never, printerScopes as never),
      prisma,
      templates,
      printers,
      printerScopes,
    };
  }

  it('ставит готовый TSPL из шаблона в очередь печати', async () => {
    const { service, templates, printers } = createService();

    const job = await service.createFromTemplate('tpl-1', {
      printerCode: 'TSC-01',
      variables: { boxCode: 'BOX-001' },
      copies: 2,
    }, adminUser());

    expect(job.printerCode).toBe('TSC-01');
    expect(job.labelType).toBe(LabelTemplateType.BOX);
    expect(job.status).toBe('queued');
    expect(job.tspl).toContain('BOX-001');
    // TEST: two requested labels become a real printer command.
    expect(job.tspl).toContain('PRINT 2');
    expect(job.payload).toMatchObject({ templateCode: 'BOX_STANDARD', templateVersion: 3 });
    expect(printers.getActivePrinterOrThrow).toHaveBeenCalledWith('TSC-01');
    expect(templates.renderTspl).toHaveBeenCalledWith('TEXT 10,10,"2",0,1,1,"{{boxCode}}"', { boxCode: 'BOX-001' });
  });

  it('заменяет команду PRINT 1 в шаблоне выбранным числом копий', async () => {
    const { service, templates } = createService();
    vi.mocked(templates.renderTspl).mockReturnValue('SIZE 40 mm,60 mm\nPRINT 1');
    const job = await service.createFromTemplate('tpl-1', { printerCode: 'TSC-01', copies: 3 }, adminUser());
    expect(job.tspl).toBe('SIZE 40 mm,60 mm\nPRINT 3');
  });

  it('не ставит в очередь отключенный шаблон', async () => {
    const { service } = createService({ isActive: false });

    await expect(
      service.createFromTemplate('tpl-1', {
        printerCode: 'TSC-01',
        variables: { boxCode: 'BOX-001' },
      }, adminUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('обновляет статус задания и сохраняет сообщение оператора', async () => {
    const { service } = createService();

    const job = await service.updateStatus('job-1', {
      status: 'failed',
      message: 'Нет бумаги',
    }, adminUser());

    expect(job.status).toBe('failed');
    expect(job.payload).toMatchObject({
      source: 'label-template',
      statusMessage: 'Нет бумаги',
    });
  });

  it('создает новое задание перепечатки со связью с оригиналом', async () => {
    const { service, prisma, printers } = createService();

    const job = await service.reprintJob('job-1', {
      reason: 'Этикетка испорчена',
    }, adminUser());

    expect(printers.getActivePrinterOrThrow).toHaveBeenCalledWith('TSC-01');
    expect(prisma.printJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          printerCode: 'TSC-01',
          labelType: LabelTemplateType.BOX,
          tspl: 'PRINT 1',
          status: 'queued',
          payload: expect.objectContaining({
            templateCode: 'BOX_STANDARD',
            reprintOfJobId: 'job-1',
            reprintReason: 'Этикетка испорчена',
            reprintedAt: expect.any(String),
          }),
        }),
      }),
    );
    expect(job.payload).toMatchObject({
      reprintOfJobId: 'job-1',
      reprintReason: 'Этикетка испорчена',
    });
  });
});

function adminUser(): AuthUser {
  return {
    id: 'user-1',
    email: 'admin',
    name: 'Admin',
    roleCodes: ['ADMIN'],
    permissionCodes: ['system:admin', 'print:write'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
    printerGroups: [],
  };
}
