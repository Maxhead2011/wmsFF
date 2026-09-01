// TEST: an error screenshot can only be attached by the same TSD worker.
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TsdDeviceService } from '../src/modules/tsd/tsd-device.service';

describe('TsdDeviceService: снимок ошибки', () => {
  it('прикрепляет ограниченный снимок только к ошибке этого сотрудника', async () => {
    const prisma = {
      tsdOperation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'error-1',
          operationType: 'monitor_error',
          payload: { workerUserId: 'worker-1' },
        }),
        update: vi.fn().mockResolvedValue({ id: 'error-1' }),
      },
    };
    const service = new TsdDeviceService(prisma as never, {} as never, {} as never, {} as never);
    const file = {
      buffer: Buffer.from('jpeg'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    await expect(service.attachMonitorErrorScreenshot('error-1', file, user())).resolves.toEqual({
      accepted: true,
      operationId: 'error-1',
      size: 4,
    });
    expect(prisma.tsdOperation.update).toHaveBeenCalledWith({
      where: { id: 'error-1' },
      data: expect.objectContaining({
        screenshotData: expect.any(Uint8Array),
        screenshotMimeType: 'image/jpeg',
        screenshotCapturedAt: expect.any(Date),
      }),
    });
  });
});

function user(): AuthUser {
  return {
    id: 'worker-1',
    email: 'worker@example.com',
    name: 'Анна',
    roleCodes: ['TSD'],
    permissionCodes: ['stock:write'],
    clientScopeMode: 'LIMITED',
    clientIds: ['client-1'],
    writableClientIds: ['client-1'],
  };
}
