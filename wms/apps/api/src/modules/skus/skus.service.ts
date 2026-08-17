import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VolumeSource } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { VolumeService } from '../stock/volume.service';
import { BulkUpdateSkuVolumeDto } from './dto/bulk-update-sku-volume.dto';
import { CreateArticleMappingDto } from './dto/create-article-mapping.dto';
import { CreateNomenclatureItemDto } from './dto/create-nomenclature-item.dto';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import {
  parseNomenclatureSheet,
  type NomenclatureImportItem,
  type SheetMatrix,
} from './nomenclature-xlsx.parser';

@Injectable()
export class SkusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly volumes: VolumeService,
  ) {}

  async list(filter: { clientId?: string; search?: string; draftsOnly?: boolean }, user: AuthUser) {
    const warehouseId = this.scopedWarehouseId(user);
    const where: Prisma.SkuWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, filter.clientId),
      isDraft: filter.draftsOnly ? true : undefined,
      OR: filter.search
        ? [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { internalSku: { contains: filter.search, mode: 'insensitive' } },
            { barcodes: { some: { value: { contains: filter.search } } } },
          ]
        : undefined,
    };

    const skus = await this.prisma.sku.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        client: { select: { id: true, code: true, name: true } },
        barcodes: true,
        _count: {
          select: {
            balances: warehouseId ? { where: { warehouseId } } : true,
            movements: warehouseId ? { where: { warehouseId } } : true,
          },
        },
      },
      take: 100,
    });

    return skus.map(enrichSkuMarketplaceData);
  }

  async get(id: string, user: AuthUser) {
    const warehouseId = this.scopedWarehouseId(user);
    const sku = await this.prisma.sku.findFirst({
      where: {
        id,
        clientId: this.clientScopes.resolveClientFilter(user),
      },
      include: {
        client: { select: { id: true, code: true, name: true } },
        barcodes: true,
        balances: {
          where: warehouseId ? { warehouseId } : undefined,
          include: {
            box: { select: { id: true, code: true, status: true } },
            pallet: { select: { id: true, code: true, status: true } },
          },
        },
        _count: {
          select: {
            balances: warehouseId ? { where: { warehouseId } } : true,
            movements: warehouseId ? { where: { warehouseId } } : true,
            clientRequestItems: warehouseId
              ? { where: { request: { warehouseId } } }
              : true,
            packageItems: warehouseId
              ? { where: { package: { request: { warehouseId } } } }
              : true,
            productMarks: warehouseId
              ? {
                  where: {
                    OR: [
                      { box: { warehouseId } },
                      { stockMovement: { warehouseId } },
                    ],
                  },
                }
              : true,
          },
        },
      },
    });

    if (!sku) {
      throw new NotFoundException('SKU не найден.');
    }

    return enrichSkuMarketplaceData(sku);
  }

  async listBulkVolume(
    filter: { clientId?: string; sourceVolumeFrom?: string; sourceVolumeTo?: string },
    user: AuthUser,
  ) {
    if (!filter.clientId) {
      throw new BadRequestException('Выберите клиента для массового изменения литража.');
    }
    this.clientScopes.requireClientAccess(user, filter.clientId, 'read');
    const client = await this.prisma.client.findUnique({
      where: { id: filter.clientId },
      select: { id: true, code: true, name: true },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const groups = await this.prisma.sku.groupBy({
      by: ['volumeLiters'],
      where: { clientId: filter.clientId },
      _count: { _all: true },
      orderBy: { volumeLiters: 'asc' },
    });
    const hasRange = filter.sourceVolumeFrom !== undefined || filter.sourceVolumeTo !== undefined;
    if (hasRange && (filter.sourceVolumeFrom === undefined || filter.sourceVolumeTo === undefined)) {
      return {
        client,
        volumes: groups.map((group) => ({
          key: group.volumeLiters === null ? 'EMPTY' : group.volumeLiters.toString(),
          value: group.volumeLiters === null ? null : Number(group.volumeLiters),
          count: group._count._all,
        })),
        items: [],
        total: 0,
      };
    }
    const sourceWhere = hasRange
      ? skuVolumeRange(filter.sourceVolumeFrom!, filter.sourceVolumeTo!)
      : null;
    const items = sourceWhere
      ? await this.prisma.sku.findMany({
          where: { clientId: filter.clientId, ...sourceWhere },
          orderBy: [{ name: 'asc' }, { internalSku: 'asc' }],
          select: {
            id: true,
            internalSku: true,
            clientSku: true,
            article: true,
            name: true,
            lengthCm: true,
            widthCm: true,
            heightCm: true,
            volumeLiters: true,
            volumeSource: true,
            barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }], select: { id: true, value: true, isPrimary: true } },
          },
          take: 5000,
        })
      : [];

    return {
      client,
      volumes: groups.map((group) => ({
        key: group.volumeLiters === null ? 'EMPTY' : group.volumeLiters.toString(),
        value: group.volumeLiters === null ? null : Number(group.volumeLiters),
        count: group._count._all,
      })),
      items,
      total: items.length,
    };
  }

  async updateBulkVolume(dto: BulkUpdateSkuVolumeDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    await this.requireBranchCatalogWrite(user, dto.clientId);
    const skuIds = [...new Set(dto.skuIds)];
    if (skuIds.length !== dto.skuIds.length) {
      throw new BadRequestException('В списке товаров есть повторяющиеся позиции.');
    }
    const sourceWhere = skuVolumeRange(dto.sourceVolumeFrom, dto.sourceVolumeTo);
    const matching = await this.prisma.sku.count({
      where: { id: { in: skuIds }, clientId: dto.clientId, ...sourceWhere },
    });
    if (matching !== skuIds.length) {
      throw new BadRequestException('Часть товаров уже изменилась или не относится к выбранному клиенту. Обновите список.');
    }

    const volume = new Prisma.Decimal(dto.newVolumeLiters.toFixed(3));
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.sku.updateMany({
        where: { id: { in: skuIds }, clientId: dto.clientId, ...sourceWhere },
        data: { volumeLiters: volume, volumeSource: 'MANUAL' },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'sku.bulk-volume-update',
          entity: 'sku',
          entityId: dto.clientId,
          payload: {
            clientId: dto.clientId,
            sourceVolumeFrom: dto.sourceVolumeFrom,
            sourceVolumeTo: dto.sourceVolumeTo,
            newVolumeLiters: dto.newVolumeLiters,
            updated: result.count,
            skuIds,
          },
        },
      });
      return {
        clientId: dto.clientId,
        sourceVolumeFrom: dto.sourceVolumeFrom,
        sourceVolumeTo: dto.sourceVolumeTo,
        newVolumeLiters: Number(volume),
        updated: result.count,
      };
    });
  }

  async create(dto: CreateSkuDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    await this.requireBranchCatalogWrite(user, dto.clientId);
    const volume = this.tryCalculateVolume(dto);

    // Русский комментарий: карточка SKU и основной штрихкод создаются одной транзакцией, чтобы не ловить "висячие" barcode.
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sku = await tx.sku.create({
          data: {
            clientId: dto.clientId,
            internalSku: dto.internalSku.trim(),
            clientSku: cleanOptional(dto.clientSku),
            article: cleanOptional(dto.article),
            name: dto.name.trim(),
            brand: cleanOptional(dto.brand),
            category: cleanOptional(dto.category),
            color: cleanOptional(dto.color),
            size: cleanOptional(dto.size),
            weightGrams: dto.weightGrams ?? null,
            lengthCm: dto.lengthCm,
            widthCm: dto.widthCm,
            heightCm: dto.heightCm,
            volumeLiters: volume?.liters,
            volumeSource: volume ? 'CALCULATED' : 'MANUAL',
            needsChestnyZnak: dto.needsChestnyZnak ?? false,
            isUnmarked: dto.isUnmarked ?? false,
            needsLabel: dto.needsLabel ?? false,
            needsRelabel: dto.needsRelabel ?? false,
            marketplacePayload: manualMarketplacePayload(dto.photoUrls),
          },
        });

        if (dto.barcode) {
          await tx.barcode.create({
            data: {
              skuId: sku.id,
              value: dto.barcode.trim(),
              isPrimary: true,
            },
          });
        }

        const saved = await tx.sku.findUniqueOrThrow({
          where: { id: sku.id },
          include: { barcodes: true },
        });

        return enrichSkuMarketplaceData(saved);
      });
    } catch (caught) {
      if (isUniqueConstraintError(caught)) {
        throw new BadRequestException('Такой SKU или штрихкод уже есть у клиента.');
      }

      throw caught;
    }
  }

  async update(id: string, dto: UpdateSkuDto, user: AuthUser) {
    const warehouseId = this.scopedWarehouseId(user);
    const existing = await this.prisma.sku.findFirst({
      where: {
        id,
        clientId: this.clientScopes.resolveClientFilter(user),
      },
      include: { barcodes: true },
    });

    if (!existing) {
      throw new NotFoundException('SKU не найден.');
    }

    this.clientScopes.requireClientAccess(user, existing.clientId, 'write');
    await this.requireBranchCatalogWrite(user, existing.clientId);
    if (dto.clientId && dto.clientId !== existing.clientId) {
      throw new BadRequestException('Нельзя перенести SKU к другому клиенту через редактирование карточки.');
    }

    const updateData = this.buildSkuUpdateData(dto, existing);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.sku.update({
          where: { id },
          data: updateData,
        });

        if (dto.barcode !== undefined) {
          await tx.barcode.deleteMany({ where: { skuId: id, isPrimary: true } });
          const barcode = cleanOptional(dto.barcode);
          if (barcode) {
            await tx.barcode.upsert({
              where: {
                skuId_value: {
                  skuId: id,
                  value: barcode,
                },
              },
              update: { isPrimary: true },
              create: {
                skuId: id,
                value: barcode,
                isPrimary: true,
              },
            });
          }
        }

        const updated = await tx.sku.findUniqueOrThrow({
          where: { id },
          include: {
            barcodes: true,
            balances: {
              where: warehouseId ? { warehouseId } : undefined,
              include: {
                box: { select: { id: true, code: true, status: true } },
                pallet: { select: { id: true, code: true, status: true } },
              },
            },
            _count: {
              select: {
                balances: warehouseId ? { where: { warehouseId } } : true,
                movements: warehouseId ? { where: { warehouseId } } : true,
                clientRequestItems: warehouseId
                  ? { where: { request: { warehouseId } } }
                  : true,
                packageItems: warehouseId
                  ? { where: { package: { request: { warehouseId } } } }
                  : true,
                productMarks: warehouseId
                  ? {
                      where: {
                        OR: [
                          { box: { warehouseId } },
                          { stockMovement: { warehouseId } },
                        ],
                      },
                    }
                  : true,
              },
            },
          },
        });

        return enrichSkuMarketplaceData(updated);
      });
    } catch (caught) {
      if (isUniqueConstraintError(caught)) {
        throw new BadRequestException('Такой SKU или штрихкод уже есть у клиента.');
      }

      throw caught;
    }
  }

  async delete(id: string, user: AuthUser) {
    const existing = await this.prisma.sku.findFirst({
      where: {
        id,
        clientId: this.clientScopes.resolveClientFilter(user),
      },
      select: {
        id: true,
        clientId: true,
        internalSku: true,
        name: true,
        _count: {
          select: {
            balances: true,
            movements: true,
            clientRequestItems: true,
            packageItems: true,
            productMarks: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('SKU не найден.');
    }

    this.clientScopes.requireClientAccess(user, existing.clientId, 'write');
    await this.requireBranchCatalogWrite(user, existing.clientId);

    const linkedRecords =
      existing._count.balances +
      existing._count.movements +
      existing._count.clientRequestItems +
      existing._count.packageItems +
      existing._count.productMarks;
    if (linkedRecords > 0) {
      throw new BadRequestException(
        'Нельзя удалить SKU, который уже участвует в остатках, движениях, заявках или маркировке. Сначала очистите связанные операции.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.barcode.deleteMany({ where: { skuId: id } }),
      this.prisma.sku.delete({ where: { id } }),
    ]);

    return { id, internalSku: existing.internalSku, name: existing.name, deleted: true };
  }

  listNomenclature(filter: { search?: string }) {
    const where: Prisma.NomenclatureItemWhereInput = filter.search
      ? {
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { printName: { contains: filter.search, mode: 'insensitive' } },
            { internalSku: { contains: filter.search, mode: 'insensitive' } },
            { article: { contains: filter.search, mode: 'insensitive' } },
            { barcode: { contains: filter.search } },
          ],
        }
      : {};

    return this.prisma.nomenclatureItem.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  async createNomenclature(dto: CreateNomenclatureItemDto, user: AuthUser) {
    this.requireGlobalCatalogWrite(user);
    const internalSku = this.buildNomenclatureInternalSku(dto);

    try {
      return await this.prisma.nomenclatureItem.create({
        data: {
          internalSku,
          article: cleanOptional(dto.article),
          barcode: cleanOptional(dto.barcode),
          name: dto.name.trim(),
          printName: cleanOptional(dto.printName),
          unit: cleanOptional(dto.unit),
          itemType: cleanOptional(dto.itemType),
          color: cleanOptional(dto.color),
          size: cleanOptional(dto.size),
          needsChestnyZnak: dto.needsChestnyZnak ?? false,
        },
      });
    } catch (caught) {
      if (isUniqueConstraintError(caught)) {
        throw new BadRequestException('Такая номенклатура или штрихкод уже есть в общем справочнике.');
      }

      throw caught;
    }
  }

  async updateNomenclature(id: string, dto: CreateNomenclatureItemDto, user: AuthUser) {
    this.requireGlobalCatalogWrite(user);
    const existing = await this.prisma.nomenclatureItem.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Номенклатура не найдена.');
    }

    try {
      return await this.prisma.nomenclatureItem.update({
        where: { id },
        data: {
          internalSku: (dto.internalSku ?? existing.internalSku).trim(),
          article: dto.article === undefined ? existing.article : cleanOptional(dto.article) ?? null,
          barcode: dto.barcode === undefined ? existing.barcode : cleanOptional(dto.barcode) ?? null,
          name: dto.name.trim(),
          printName: dto.printName === undefined ? existing.printName : cleanOptional(dto.printName) ?? null,
          unit: dto.unit === undefined ? existing.unit : cleanOptional(dto.unit) ?? null,
          itemType: dto.itemType === undefined ? existing.itemType : cleanOptional(dto.itemType) ?? null,
          color: dto.color === undefined ? existing.color : cleanOptional(dto.color) ?? null,
          size: dto.size === undefined ? existing.size : cleanOptional(dto.size) ?? null,
          needsChestnyZnak: dto.needsChestnyZnak ?? existing.needsChestnyZnak,
        },
      });
    } catch (caught) {
      if (isUniqueConstraintError(caught)) {
        throw new BadRequestException('Такой внутренний SKU или штрихкод уже используется в общей номенклатуре.');
      }

      throw caught;
    }
  }

  async listArticleMappings(clientId: string, user: AuthUser) {
    if (!clientId) {
      throw new BadRequestException('Не выбран клиент для справочника соответствий.');
    }

    this.clientScopes.requireClientAccess(user, clientId, 'read');

    return this.prisma.clientArticleMapping.findMany({
      where: { clientId },
      orderBy: [{ targetArticle: 'asc' }, { sourceArticle: 'asc' }],
    });
  }

  async createArticleMapping(dto: CreateArticleMappingDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    await this.requireBranchCatalogWrite(user, dto.clientId);
    const sourceArticle = dto.sourceArticle.trim();
    const targetArticle = dto.targetArticle.trim();
    if (normalizeArticleMappingValue(sourceArticle) === normalizeArticleMappingValue(targetArticle)) {
      throw new BadRequestException(
        'Исходный товар и товар после переклейки должны отличаться.',
      );
    }

    try {
      const existing = await this.prisma.clientArticleMapping.findFirst({
        where: {
          clientId: dto.clientId,
          sourceArticle: { equals: sourceArticle, mode: 'insensitive' },
          targetArticle: { equals: targetArticle, mode: 'insensitive' },
        },
      });
      if (existing) {
        return await this.prisma.clientArticleMapping.update({
          where: { id: existing.id },
          data: { comment: cleanOptional(dto.comment) },
        });
      }
      return await this.prisma.clientArticleMapping.create({
        data: {
          clientId: dto.clientId,
          sourceArticle,
          targetArticle,
          comment: cleanOptional(dto.comment),
        },
      });
    } catch (caught) {
      if (isUniqueConstraintError(caught)) {
        throw new BadRequestException('Такое соответствие уже есть в справочнике клиента.');
      }

      throw caught;
    }
  }

  async deleteArticleMapping(id: string, user: AuthUser) {
    const mapping = await this.prisma.clientArticleMapping.findUnique({
      where: { id },
      select: { id: true, clientId: true },
    });
    if (!mapping) {
      throw new NotFoundException('Соответствие переклейки не найдено.');
    }
    this.clientScopes.requireClientAccess(user, mapping.clientId, 'write');
    await this.requireBranchCatalogWrite(user, mapping.clientId);
    await this.prisma.clientArticleMapping.delete({ where: { id } });
    return { id, deleted: true };
  }

  async importArticleMappingsWorkbook(clientId: string, file: Express.Multer.File, user: AuthUser) {
    if (!clientId) {
      throw new BadRequestException('Не выбран клиент для импорта соответствий.');
    }

    this.clientScopes.requireClientAccess(user, clientId, 'write');
    await this.requireBranchCatalogWrite(user, clientId);
    const rows = this.readSheet(file.buffer, ['Соответствие', 'Соответствия']);
    const parsed = parseArticleMappingSheet(rows);

    if (parsed.items.length === 0) {
      throw new BadRequestException({
        message: 'В файле не найдено соответствий для загрузки.',
        errors: parsed.issues.filter((issue) => issue.severity === 'error'),
        summary: parsed.summary,
      });
    }

    const counters = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: parsed.issues.filter((issue) => issue.severity === 'error').length,
      warnings: parsed.issues.filter((issue) => issue.severity === 'warning').length,
    };
    const savedMappings = [];

    for (const item of parsed.items) {
      try {
        const existing = await this.prisma.clientArticleMapping.findUnique({
          where: {
            clientId_sourceArticle_targetArticle: {
              clientId,
              sourceArticle: item.sourceArticle,
              targetArticle: item.targetArticle,
            },
          },
        });
        const mapping = await this.prisma.clientArticleMapping.upsert({
          where: {
            clientId_sourceArticle_targetArticle: {
              clientId,
              sourceArticle: item.sourceArticle,
              targetArticle: item.targetArticle,
            },
          },
          create: {
            clientId,
            sourceArticle: item.sourceArticle,
            targetArticle: item.targetArticle,
            comment: item.comment,
          },
          update: {
            comment: item.comment,
          },
        });
        counters[existing ? 'updated' : 'created'] += 1;
        savedMappings.push(mapping);
      } catch (caught) {
        counters.skipped += 1;
        counters.errors += 1;
        parsed.issues.push({
          row: item.sourceRow,
          message: caught instanceof Error ? caught.message : 'Не удалось сохранить соответствие.',
          severity: 'error',
        });
      }
    }

    return {
      fileName: file.originalname,
      summary: {
        ...parsed.summary,
        ...counters,
      },
      issues: parsed.issues,
      items: savedMappings,
    };
  }

  async importNomenclatureWorkbook(file: Express.Multer.File, user: AuthUser) {
    this.requireGlobalCatalogWrite(user);
    const rows = this.readFirstSheet(file.buffer);
    const parsed = parseNomenclatureSheet(rows);
    const errors = parsed.issues.filter((issue) => issue.severity === 'error');

    if (parsed.items.length === 0) {
      throw new BadRequestException({
        message: 'В файле не найдена номенклатура для загрузки.',
        errors,
        summary: parsed.summary,
      });
    }

    const counters = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: errors.length,
      warnings: parsed.issues.filter((issue) => issue.severity === 'warning').length,
    };
    const savedSkus = [];

    for (const item of parsed.items) {
      try {
        const result = await this.upsertImportedNomenclature(item);
        counters[result.created ? 'created' : 'updated'] += 1;
        savedSkus.push(result.sku);
      } catch (caught) {
        counters.skipped += 1;
        counters.errors += 1;
        parsed.issues.push({
          row: item.sourceRow,
          internalSku: item.internalSku,
          name: item.name,
          message: caught instanceof Error ? caught.message : 'Не удалось сохранить строку номенклатуры.',
          severity: 'error',
        });
      }
    }

    return {
      fileName: file.originalname,
      summary: {
        ...parsed.summary,
        ...counters,
      },
      issues: parsed.issues,
      items: savedSkus,
    };
  }

  private async upsertImportedNomenclature(item: NomenclatureImportItem) {
    const existingByBarcode = item.barcode
      ? await this.prisma.nomenclatureItem.findUnique({
          where: { barcode: item.barcode },
        })
      : null;

    const existingSku =
      existingByBarcode ??
      (await this.prisma.nomenclatureItem.findUnique({
        where: { internalSku: item.internalSku },
      }));

    const sku = existingSku
      ? await this.prisma.nomenclatureItem.update({
          where: { id: existingSku.id },
          data: this.importedNomenclatureData(item),
        })
      : await this.prisma.nomenclatureItem.create({
          data: this.importedNomenclatureData(item),
        });

    return { sku, created: !existingSku };
  }

  private importedNomenclatureData(item: NomenclatureImportItem): Prisma.NomenclatureItemUncheckedCreateInput {
    return {
      internalSku: item.internalSku,
      article: item.article,
      barcode: item.barcode,
      name: item.name,
      printName: item.printName,
      unit: item.unit,
      itemType: item.itemType,
      color: item.color,
      size: item.size,
    };
  }

  private buildNomenclatureInternalSku(dto: CreateNomenclatureItemDto) {
    return (dto.internalSku || dto.article || dto.barcode || dto.name).trim().slice(0, 100);
  }

  private readFirstSheet(buffer: Buffer): SheetMatrix {
    return this.readSheet(buffer);
  }

  private readSheet(buffer: Buffer, preferredSheetNames: string[] = []): SheetMatrix {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const preferred = new Set(preferredSheetNames.map((name) => normalizeImportHeader(name)));
    const sheetName =
      workbook.SheetNames.find((name) => preferred.has(normalizeImportHeader(name))) ??
      workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json<SheetMatrix[number]>(worksheet, {
      header: 1,
      raw: false,
      blankrows: false,
    });
  }

  private scopedWarehouseId(user: AuthUser) {
    if (
      user.permissionCodes?.includes('system:admin') ||
      user.roleCodes?.includes('CLIENT') ||
      (user.warehouseIds?.length ?? 0) === 0
    ) {
      return null;
    }

    const warehouseId = user.activeWarehouseId?.trim() ?? '';
    if (!warehouseId || !user.warehouseIds?.includes(warehouseId)) {
      throw new ForbiddenException('Для работы с номенклатурой выберите доступный филиал.');
    }
    return warehouseId;
  }

  private async requireBranchCatalogWrite(user: AuthUser, clientId: string) {
    const warehouseId = this.scopedWarehouseId(user);
    if (!warehouseId) return;
    if (!user.writableWarehouseIds?.includes(warehouseId)) {
      throw new ForbiddenException('Нет прав на изменение данных в выбранном филиале.');
    }

    const [currentLink, activeLinks] = await this.prisma.$transaction([
      this.prisma.warehouseClient.findFirst({
        where: { warehouseId, clientId, status: 'ACTIVE' },
        select: { clientId: true },
      }),
      this.prisma.warehouseClient.count({
        where: { clientId, status: 'ACTIVE' },
      }),
    ]);
    if (!currentLink) {
      throw new ForbiddenException('Клиент не закреплён за выбранным филиалом.');
    }
    if (activeLinks > 1) {
      throw new ForbiddenException(
        'Карточка товара общая для нескольких филиалов. Изменить её может только администратор сети.',
      );
    }
  }

  private requireGlobalCatalogWrite(user: AuthUser) {
    if (this.scopedWarehouseId(user)) {
      throw new ForbiddenException(
        'Общий справочник номенклатуры изменяет только администратор сети.',
      );
    }
  }

  private buildSkuUpdateData(
    dto: UpdateSkuDto,
    existing: {
      internalSku: string;
      clientSku: string | null;
      article: string | null;
      name: string;
      brand: string | null;
      category: string | null;
      color: string | null;
      size: string | null;
      weightGrams: number | null;
      lengthCm: Prisma.Decimal | null;
      widthCm: Prisma.Decimal | null;
      heightCm: Prisma.Decimal | null;
      volumeLiters: Prisma.Decimal | null;
      volumeSource: VolumeSource;
      needsChestnyZnak: boolean;
      isUnmarked: boolean;
      needsLabel: boolean;
      needsRelabel: boolean;
      marketplacePayload: Prisma.JsonValue | null;
    },
  ): Prisma.SkuUncheckedUpdateInput {
    const nextLength = dto.lengthCm ?? decimalToNumber(existing.lengthCm);
    const nextWidth = dto.widthCm ?? decimalToNumber(existing.widthCm);
    const nextHeight = dto.heightCm ?? decimalToNumber(existing.heightCm);
    const dimensionsChanged = dto.lengthCm !== undefined || dto.widthCm !== undefined || dto.heightCm !== undefined;
    const hasManualVolumeOverride =
      existing.volumeSource === VolumeSource.MANUAL && (decimalToNumber(existing.volumeLiters) ?? 0) > 0;
    const volume =
      !hasManualVolumeOverride && dimensionsChanged && nextLength && nextWidth && nextHeight
        ? this.volumes.calculateLiters({
            lengthCm: nextLength,
            widthCm: nextWidth,
            heightCm: nextHeight,
          })
        : null;

    return {
      ...(dto.internalSku === undefined ? {} : { internalSku: dto.internalSku.trim() }),
      ...(dto.clientSku === undefined ? {} : { clientSku: cleanOptional(dto.clientSku) ?? null }),
      ...(dto.article === undefined ? {} : { article: cleanOptional(dto.article) ?? null }),
      ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
      ...(dto.brand === undefined ? {} : { brand: cleanOptional(dto.brand) ?? null }),
      ...(dto.category === undefined ? {} : { category: cleanOptional(dto.category) ?? null }),
      ...(dto.color === undefined ? {} : { color: cleanOptional(dto.color) ?? null }),
      ...(dto.size === undefined ? {} : { size: cleanOptional(dto.size) ?? null }),
      ...(dto.weightGrams === undefined ? {} : { weightGrams: dto.weightGrams || null }),
      ...(dto.lengthCm === undefined ? {} : { lengthCm: dto.lengthCm ?? null }),
      ...(dto.widthCm === undefined ? {} : { widthCm: dto.widthCm ?? null }),
      ...(dto.heightCm === undefined ? {} : { heightCm: dto.heightCm ?? null }),
      ...(volume ? { volumeLiters: volume.liters, volumeSource: 'CALCULATED' } : {}),
      ...(dto.needsChestnyZnak === undefined ? {} : { needsChestnyZnak: dto.needsChestnyZnak }),
      ...(dto.isUnmarked === undefined ? {} : { isUnmarked: dto.isUnmarked }),
      ...(dto.needsLabel === undefined ? {} : { needsLabel: dto.needsLabel }),
      ...(dto.needsRelabel === undefined ? {} : { needsRelabel: dto.needsRelabel }),
      ...(dto.photoUrls === undefined ? {} : { marketplacePayload: mergeManualPhotos(existing.marketplacePayload, dto.photoUrls) }),
    };
  }

  private tryCalculateVolume(dto: CreateSkuDto) {
    if (!dto.lengthCm || !dto.widthCm || !dto.heightCm) {
      return null;
    }

    return this.volumes.calculateLiters({
      lengthCm: dto.lengthCm,
      widthCm: dto.widthCm,
      heightCm: dto.heightCm,
    });
  }
}

function cleanOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function skuVolumeRange(sourceVolumeFrom: string | number, sourceVolumeTo: string | number): Prisma.SkuWhereInput {
  const from = Number(String(sourceVolumeFrom).trim().replace(',', '.'));
  const to = Number(String(sourceVolumeTo).trim().replace(',', '.'));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0 || from > 1_000_000 || to > 1_000_000) {
    throw new BadRequestException('Некорректный диапазон литража.');
  }
  if (from > to) {
    throw new BadRequestException('Начало диапазона литража не может быть больше окончания.');
  }
  return {
    volumeLiters: {
      gte: new Prisma.Decimal(from.toFixed(3)),
      lte: new Prisma.Decimal(to.toFixed(3)),
    },
  };
}

function cleanPhotoUrls(photoUrls?: string[]) {
  return uniqueValues(
    (photoUrls ?? [])
      .map((photo) => photo.trim())
      .filter((photo) => photo && looksLikeImageUrl(photo)),
  ).slice(0, 12);
}

function manualMarketplacePayload(photoUrls?: string[]): Prisma.InputJsonValue | undefined {
  const manualPhotos = cleanPhotoUrls(photoUrls);
  return manualPhotos.length > 0 ? { manualPhotos } : undefined;
}

function mergeManualPhotos(payload: Prisma.JsonValue | null, photoUrls?: string[]): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const manualPhotos = cleanPhotoUrls(photoUrls);
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...(payload as Record<string, Prisma.JsonValue>) } : {};
  if (manualPhotos.length === 0) {
    delete base.manualPhotos;
    return Object.keys(base).length > 0 ? (base as Prisma.InputJsonObject) : Prisma.JsonNull;
  }

  return { ...base, manualPhotos };
}

function enrichSkuMarketplaceData<T extends { marketplacePayload: Prisma.JsonValue | null }>(sku: T) {
  return {
    ...sku,
    marketplacePhotos: extractMarketplacePhotos(sku.marketplacePayload),
    marketplaceCharacteristics: extractMarketplaceCharacteristics(sku.marketplacePayload),
  };
}

function extractMarketplacePhotos(payload: Prisma.JsonValue | null) {
  const photos: string[] = [];

  visitMarketplacePayload(payload, (value, key) => {
    const normalizedKey = key.toLowerCase();
    if (typeof value === 'string' && looksLikeImageUrl(value)) {
      photos.push(value);
      return;
    }

    if (!['photo', 'photos', 'image', 'images', 'picture', 'pictures', 'media', 'primary_image'].some((name) => normalizedKey.includes(name))) {
      return;
    }

    if (typeof value === 'string' && looksLikeImageUrl(value)) {
      photos.push(value);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, Prisma.JsonValue>;
      for (const field of ['url', 'big', 'small', 'file_name', 'link', 'c246x328', 'c516x688', 'hq', 'tm']) {
        const candidate = record[field];
        if (typeof candidate === 'string' && looksLikeImageUrl(candidate)) {
          photos.push(candidate);
        }
      }
    }
  });

  return uniqueValues(photos).slice(0, 60);
}

function extractMarketplaceCharacteristics(payload: Prisma.JsonValue | null) {
  const characteristics: Array<{ name: string; value: string }> = [];

  visitMarketplacePayload(payload, (value, key) => {
    const normalizedKey = key.toLowerCase();
    if (!['characteristic', 'characteristics', 'attribute', 'attributes', 'dimensions'].some((name) => normalizedKey.includes(name))) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const property = characteristicFromValue(item);
        if (property) {
          characteristics.push(property);
        }
      }
      return;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, Prisma.JsonValue>;
      const direct = characteristicFromValue(record);
      if (direct) {
        characteristics.push(direct);
        return;
      }

      for (const [name, propertyValue] of Object.entries(record)) {
        if (propertyValue == null || typeof propertyValue === 'object') {
          continue;
        }
        characteristics.push({ name, value: String(propertyValue) });
      }
    }
  });

  const seen = new Set<string>();
  return characteristics
    .filter((item) => {
      const key = `${item.name}:${item.value}`.toLowerCase();
      if (!item.name || !item.value || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 120);
}

function visitMarketplacePayload(
  value: Prisma.JsonValue | null,
  visitor: (value: Prisma.JsonValue, key: string) => void,
  key = '',
  depth = 0,
) {
  if (value == null || depth > 7) {
    return;
  }

  visitor(value, key);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitMarketplacePayload(item, visitor, String(index), depth + 1));
    return;
  }

  if (typeof value === 'object') {
    Object.entries(value as Record<string, Prisma.JsonValue>).forEach(([nextKey, nextValue]) =>
      visitMarketplacePayload(nextValue, visitor, nextKey, depth + 1),
    );
  }
}

function characteristicFromValue(value: Prisma.JsonValue): { name: string; value: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, Prisma.JsonValue>;
  const name = textFromJson(record.name) || textFromJson(record.charcName) || textFromJson(record.attribute_name) || textFromJson(record.title);
  if (!name) {
    return null;
  }

  const rawValue = record.value ?? record.values ?? record.val ?? record.display_value;
  const normalizedValue = Array.isArray(rawValue)
    ? rawValue
        .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? textFromJson((item as Record<string, Prisma.JsonValue>).value) : textFromJson(item)))
        .filter(Boolean)
        .join(', ')
    : textFromJson(rawValue);

  return normalizedValue ? { name, value: normalizedValue } : null;
}

function textFromJson(value: Prisma.JsonValue | undefined) {
  if (value == null || typeof value === 'object') {
    return '';
  }

  return String(value).trim();
}

function looksLikeImageUrl(value: string) {
  return /^https?:\/\//i.test(value) && /\.(avif|gif|jpe?g|png|webp)(\?|$)/i.test(value);
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value ? value.toNumber() : undefined;
}

type ArticleMappingImportItem = {
  sourceArticle: string;
  targetArticle: string;
  comment?: string;
  sourceRow: number;
};

type ArticleMappingImportIssue = {
  row: number;
  message: string;
  severity: 'warning' | 'error';
};

function parseArticleMappingSheet(rows: SheetMatrix) {
  const columns = detectArticleMappingColumns(rows);
  const items: ArticleMappingImportItem[] = [];
  const issues: ArticleMappingImportIssue[] = [];
  const seenKeys = new Set<string>();

  rows.forEach((row, index) => {
    const sourceRow = index + 1;
    if (looksLikeArticleMappingHeader(row)) {
      return;
    }

    const sourceArticle = cleanImportText(row[columns.sourceArticle]);
    const targetArticle = cleanImportText(row[columns.targetArticle]);
    const comment = cleanImportText(row[columns.comment]);

    if (!sourceArticle && !targetArticle) {
      return;
    }

    if (!sourceArticle || !targetArticle) {
      issues.push({
        row: sourceRow,
        message: 'Нужно заполнить артикул на складе и артикул продавца.',
        severity: 'error',
      });
      return;
    }

    if (
      normalizeArticleMappingValue(sourceArticle) ===
      normalizeArticleMappingValue(targetArticle)
    ) {
      issues.push({
        row: sourceRow,
        message: 'Исходный товар и товар после переклейки должны отличаться.',
        severity: 'error',
      });
      return;
    }

    const dedupeKey = [
      normalizeArticleMappingValue(sourceArticle),
      normalizeArticleMappingValue(targetArticle),
    ].join('|');
    if (seenKeys.has(dedupeKey)) {
      issues.push({
        row: sourceRow,
        message: 'Дубль соответствия в файле, строка пропущена.',
        severity: 'warning',
      });
      return;
    }

    seenKeys.add(dedupeKey);
    items.push({
      sourceArticle,
      targetArticle,
      comment: comment || undefined,
      sourceRow,
    });
  });

  return {
    items,
    issues,
    summary: {
      sourceRows: Math.max(rows.length - 1, 0),
      rows: items.length,
    },
  };
}

function detectArticleMappingColumns(rows: SheetMatrix) {
  for (const row of rows) {
    const normalized = row.map((cell) => normalizeImportHeader(cleanImportText(cell)));
    if (!normalized.some(isArticleMappingHeaderCell)) {
      continue;
    }

    return {
      sourceArticle:
        findImportColumn(normalized, ['где лежит', 'артикул на складе', 'склад', 'исходный', 'старый', 'source']) ?? 0,
      targetArticle:
        findImportColumn(normalized, ['должно уехать', 'артикул продавца', 'продавца', 'целевой', 'новый', 'target']) ?? 1,
      comment: findImportColumn(normalized, ['комментарий', 'примечание', 'comment']) ?? 2,
    };
  }

  return {
    sourceArticle: 0,
    targetArticle: 1,
    comment: 2,
  };
}

function looksLikeArticleMappingHeader(row: SheetMatrix[number]) {
  const normalized = row.map((cell) => normalizeImportHeader(cleanImportText(cell)));
  return normalized.some(isArticleMappingHeaderCell);
}

function isArticleMappingHeaderCell(cell: string) {
  return (
    cell.includes('артикул') ||
    cell.includes('article') ||
    cell.includes('должно уехать') ||
    cell.includes('где лежит')
  );
}

function findImportColumn(cells: string[], needles: string[]) {
  const index = cells.findIndex((cell) => needles.some((needle) => cell.includes(needle)));
  return index >= 0 ? index : undefined;
}

function cleanImportText(value: SheetMatrix[number][number]) {
  if (value == null) {
    return '';
  }
  const text = String(value).replace(/\.0$/, '').trim();
  return text === '#N/A' || text.toUpperCase() === 'N/A' ? '' : text;
}

function normalizeImportHeader(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeArticleMappingValue(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
