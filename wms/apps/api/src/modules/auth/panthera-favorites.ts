import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';

const keyFor = (userId: string) => `ui.panthera.favorites.${userId}`;
type Saved = { ids: string[]; revision: number };
const decode = (value: unknown): Saved | null => {
  if (!value || typeof value !== 'object' || !('ids' in value) || !('revision' in value)) return null;
  const saved = value as Saved;
  return Array.isArray(saved.ids) && Number.isSafeInteger(saved.revision) ? saved : null;
};
export async function readPantheraFavorites(prisma: PrismaService, userId: string) {
  const row = await prisma.systemSetting.findUnique({ where: { key: keyFor(userId) } });
  return decode(row?.value) ?? { ids: null, revision: 0 };
}
// FIX: authenticated identity only; revision check and write share a per-user transaction lock.
export async function savePantheraFavorites(prisma: PrismaService, userId: string, body: unknown) {
  const input = body as Saved;
  if (!input || !Array.isArray(input.ids) || input.ids.length > 100 ||
      input.ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) ||
      !Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new BadRequestException('Некорректный список быстрых ссылок.');
  }
  const key = keyFor(userId), ids = [...new Set(input.ids)];
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const row = await tx.systemSetting.findUnique({ where: { key } });
    const previous = decode(row?.value);
    if ((previous?.revision ?? 0) !== input.revision) {
      throw new ConflictException('Список изменён на другом устройстве. Обновите его и повторите действие.');
    }
    const next = { ids, revision: input.revision + 1 };
    await tx.systemSetting.upsert({
      where: { key }, create: { key, value: next, updatedByUserId: userId },
      update: { value: next, updatedByUserId: userId },
    });
    return next;
  });
}
