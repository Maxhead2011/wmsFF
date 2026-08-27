import { ForbiddenException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../src/modules/auth/auth.module';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { KizCirculationModule } from '../src/modules/kiz-circulation/kiz-circulation.module';
import { KizCirculationService } from '../src/modules/kiz-circulation/kiz-circulation.service';

const clientUser = {
  id: 'user-client',
  email: 'client@example.test',
  name: 'Клиент',
  roleCodes: ['CLIENT'],
  permissionCodes: ['kiz-circulation:read', 'kiz-circulation:write'],
  clientScopeMode: 'LIMITED',
  clientIds: ['client-own'],
  writableClientIds: ['client-own'],
} satisfies AuthUser;

describe('KizCirculation client access', () => {
  // ADDED: защита от стартовой DI-регрессии при подключении ClientScopeService.
  it('импортирует AuthModule с проверкой клиентского доступа', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, KizCirculationModule) as unknown[];
    expect(imports).toContain(AuthModule);
  });

  // ADDED: подмена clientId останавливается до чтения данных погашения.
  it('запрашивает read-доступ к выбранному клиенту', async () => {
    const requireClientAccess = vi.fn(() => {
      throw new ForbiddenException('Нет доступа');
    });
    const service = new KizCirculationService(
      {} as never,
      {} as never,
      {} as never,
      { requireClientAccess } as never,
    );

    await expect(service.overview('client-foreign', clientUser)).rejects.toThrow('Нет доступа');
    expect(requireClientAccess).toHaveBeenCalledWith(clientUser, 'client-foreign', 'read');
  });

  // ADDED: ручной импорт КИЗ требует write-доступ именно к clientId из тела запроса.
  it('запрашивает write-доступ перед импортом', async () => {
    const requireClientAccess = vi.fn(() => {
      throw new ForbiddenException('Нет доступа');
    });
    const service = new KizCirculationService(
      {} as never,
      {} as never,
      {} as never,
      { requireClientAccess } as never,
    );

    await expect(service.importItems({ clientId: 'client-foreign' } as never, clientUser)).rejects.toThrow(
      'Нет доступа',
    );
    expect(requireClientAccess).toHaveBeenCalledWith(clientUser, 'client-foreign', 'write');
  });
});
