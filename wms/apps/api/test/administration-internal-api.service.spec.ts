import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdministrationInternalApiService,
  INTERNAL_API_DEFINITIONS,
  INTERNAL_API_RESTART_CONFIRMATION,
} from '../src/modules/administration/administration-internal-api.service';

const originalRestartFlag = process.env.API_SELF_RESTART_ENABLED;

afterEach(() => {
  if (originalRestartFlag === undefined) delete process.env.API_SELF_RESTART_ENABLED;
  else process.env.API_SELF_RESTART_ENABLED = originalRestartFlag;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AdministrationInternalApiService', () => {
  // TEST: a surplus in one group must not conceal missing handlers in another.
  it.each(INTERNAL_API_DEFINITIONS)('счётчик маршрутов группы $id соответствует её контроллерам', (definition) => {
    const matchingControllers = controllerFiles(join(__dirname, '../src/modules'))
      .map((file) => readFileSync(file, 'utf8'))
      .filter((source) => {
        const decorator = source.match(/@Controller\(([\s\S]*?)\)/)?.[1] ?? '';
        const prefixes = [...decorator.matchAll(/['"]([^'"]+)['"]/g)].map((match) => `/${match[1]}`);
        // TEST: include shared-prefix controllers, but count an aliased controller only once.
        return prefixes.some((prefix) => definition.prefixes.includes(prefix));
      });
    expect(matchingControllers.length).toBeGreaterThan(0);
    const routeCount = matchingControllers.reduce(
      (sum, source) => sum + [...source.matchAll(/@(Get|Post|Patch|Put|Delete)\s*\(/g)].length,
      0,
    );
    expect(definition.routeCount).toBe(routeCount);
  });

  it('описывает все контроллеры и все маршруты текущего AppModule', () => {
    const controllerSources = controllerFiles(join(__dirname, '../src/modules'))
      .map((file) => readFileSync(file, 'utf8'));
    const sourcePrefixes = controllerSources.flatMap((source) => {
      const controller = source.match(/@Controller\(([\s\S]*?)\)/)?.[1] ?? '';
      return [...controller.matchAll(/['"]([^'"]+)['"]/g)].map((match) => `/${match[1]}`);
    });
    const sourceRoutes = controllerSources.reduce(
      (sum, source) => sum + [...source.matchAll(/@(Get|Post|Patch|Put|Delete)\s*\(/g)].length,
      0,
    );
    const registryPrefixes = INTERNAL_API_DEFINITIONS.flatMap((definition) => definition.prefixes);
    const registryRoutes = INTERNAL_API_DEFINITIONS.reduce((sum, definition) => sum + definition.routeCount, 0);

    // ADDED: A new controller or endpoint must also receive an explanation in the admin registry.
    expect(new Set(registryPrefixes)).toEqual(new Set(sourcePrefixes));
    expect(registryRoutes).toBe(sourceRoutes);
    expect(INTERNAL_API_DEFINITIONS).toHaveLength(31);
  });

  it('не рисует ложный зелёный статус при ошибке основной БД', async () => {
    const service = new AdministrationInternalApiService(
      { $queryRaw: vi.fn().mockRejectedValue(new Error('database unavailable')) } as never,
      { write: vi.fn() } as never,
    );

    const result = await service.overview(adminUser());

    expect(result.dependencies.database.status).toBe('ERROR');
    expect(result.modules.find((module) => module.id === 'stock')?.status).toBe('DEGRADED');
    expect(result.modules.find((module) => module.id === 'health')?.status).toBe('WORKING');
    expect(result.summary.degraded).toBeGreaterThan(0);
  });

  it('запрещает перезапуск пользователю без system:admin', async () => {
    process.env.API_SELF_RESTART_ENABLED = 'true';
    const service = new AdministrationInternalApiService(
      { $queryRaw: vi.fn() } as never,
      { write: vi.fn() } as never,
    );

    await expect(service.restart(
      { confirmation: INTERNAL_API_RESTART_CONFIRMATION },
      adminUser({ permissionCodes: ['administration:demo'] }),
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('требует точную фразу перед реальным перезапуском', async () => {
    process.env.API_SELF_RESTART_ENABLED = 'true';
    vi.spyOn(process, 'uptime').mockReturnValue(120);
    const service = new AdministrationInternalApiService(
      { $queryRaw: vi.fn() } as never,
      { write: vi.fn() } as never,
    );

    await expect(service.restart({ confirmation: 'да' }, adminUser()))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('сначала пишет аудит, затем завершает процесс для Docker-restart', async () => {
    process.env.API_SELF_RESTART_ENABLED = 'true';
    vi.useFakeTimers();
    vi.spyOn(process, 'uptime').mockReturnValue(120);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const service = new AdministrationInternalApiService(
      { $queryRaw: vi.fn() } as never,
      audit as never,
    );

    const result = await service.restart(
      { confirmation: INTERNAL_API_RESTART_CONFIRMATION },
      adminUser(),
    );

    expect(result.accepted).toBe(true);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'administration.internal-api.restart',
      userId: 'admin-1',
    }));
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return controllerFiles(fullPath);
    return entry.name.endsWith('.controller.ts') ? [fullPath] : [];
  });
}

function adminUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'admin-1',
    email: 'admin@example.test',
    name: 'Администратор',
    roleCodes: ['ADMIN'],
    permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
    ...overrides,
  } as never;
}
