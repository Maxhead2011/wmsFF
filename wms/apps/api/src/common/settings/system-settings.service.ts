import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    return setting ? (setting.value as T) : fallback;
  }

  async getMany(keys: string[]) {
    return this.prisma.systemSetting.findMany({
      where: { key: { in: [...new Set(keys)] } },
      orderBy: { key: 'asc' },
    });
  }

  async set(key: string, value: Prisma.InputJsonValue, updatedByUserId?: string | null) {
    return this.prisma.systemSetting.upsert({
      where: { key },
      create: {
        key,
        value,
        updatedByUserId: updatedByUserId || null,
      },
      update: {
        value,
        updatedByUserId: updatedByUserId || null,
      },
    });
  }
}
