import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KizCirculationBatchStatus,
  KizCirculationItemStatus,
  KizCirculationOperation,
  MarketplaceType,
  Prisma,
  StockStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import {
  CheckKizCirculationItemsDto,
  CreateKizCirculationBatchDto,
  ImportKizCirculationItemsDto,
  SyncKizCirculationDto,
  UpdateKizCirculationItemDto,
  UpsertKizTrueApiConnectionDto,
} from './dto/kiz-circulation.dto';
import { KizCirculationCryptoService } from './kiz-circulation-crypto.service';
import {
  buildKizCirculationDocument,
  isFinalMarketplaceSale,
  normalizeCisForTrueApi,
  officialTrueApiBase,
} from './kiz-circulation.policy';

@Injectable()
export class KizCirculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketplaces: MarketplaceConnectionsService,
    private readonly crypto: KizCirculationCryptoService,
    // ADDED: клиентский доступ всегда ограничивается закреплёнными clientId.
    private readonly clientScopes: ClientScopeService,
  ) {}

  async overview(clientId: string, user: AuthUser) {
    // FIX: не позволяем клиенту читать чужие КИЗ по подменённому clientId.
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const client = await this.requireClient(clientId);
    const [connection, marketplaceConnections, items, batches] = await Promise.all([
      this.prisma.kizTrueApiConnection.findUnique({ where: { clientId } }),
      this.prisma.clientMarketplaceConnection.findMany({
        where: {
          clientId,
          marketplace: { in: [MarketplaceType.WILDBERRIES, MarketplaceType.OZON, MarketplaceType.YANDEX_MARKET] },
        },
        select: { id: true, marketplace: true, accountName: true, isActive: true },
        orderBy: [{ marketplace: 'asc' }, { accountName: 'asc' }],
      }),
      this.prisma.kizCirculationItem.findMany({
        where: { clientId },
        include: {
          batch: { select: { id: true, status: true, crptDocumentId: true } },
        },
        orderBy: { eventAt: 'desc' },
        take: 500,
      }),
      this.prisma.kizCirculationBatch.findMany({
        where: { clientId },
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
    ]);
    const counts = items.reduce<Record<string, number>>((result, item) => {
      result[item.status] = (result[item.status] ?? 0) + 1;
      return result;
    }, {});
    return {
      client,
      connection: connection
        ? {
            id: connection.id,
            inn: connection.inn,
            kpp: connection.kpp,
            fiasId: connection.fiasId,
            productGroup: connection.productGroup,
            apiBaseUrl: connection.apiBaseUrl,
            tokenConfigured: Boolean(connection.apiTokenEncrypted),
            tokenExpiresAt: connection.tokenExpiresAt,
            certificateSubject: connection.certificateSubject,
            certificateThumbprint: connection.certificateThumbprint,
            isActive: connection.isActive,
            lastCheckedAt: connection.lastCheckedAt,
            lastCheckOk: connection.lastCheckOk,
            lastCheckMessage: connection.lastCheckMessage,
          }
        : null,
      marketplaceConnections,
      counts,
      items,
      batches: batches.map(({ signatureEncrypted: _signatureEncrypted, _count, ...batch }) => ({
        // FIX: даже зашифрованная УКЭП не покидает API; веб получает только документ и его статус.
        ...batch,
        itemCount: _count.items,
      })),
    };
  }

  async upsertConnection(clientId: string, dto: UpsertKizTrueApiConnectionDto, user: AuthUser) {
    // FIX: токен True API можно менять только у закреплённого клиента.
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    await this.requireClient(clientId);
    const existing = await this.prisma.kizTrueApiConnection.findUnique({ where: { clientId } });
    if (!existing && !dto.apiToken) {
      throw new BadRequestException('Для первого подключения вставьте токен True API.');
    }
    if (dto.kpp && dto.fiasId) {
      throw new BadRequestException('Укажите либо КПП юридического лица, либо ФИАС места деятельности ИП.');
    }
    const apiToken = dto.apiToken?.replace(/^Bearer\s+/i, '').trim();
    const apiBaseUrl = officialTrueApiBase(dto.apiBaseUrl);
    const data = {
      inn: dto.inn,
      kpp: dto.kpp || null,
      fiasId: dto.fiasId || null,
      productGroup: dto.productGroup,
      apiBaseUrl,
      ...(apiToken ? { apiTokenEncrypted: this.crypto.encrypt(apiToken) } : {}),
      tokenExpiresAt: dto.tokenExpiresAt ? new Date(dto.tokenExpiresAt) : null,
      certificateSubject: dto.certificateSubject || null,
      certificateThumbprint: dto.certificateThumbprint || null,
      isActive: dto.isActive ?? true,
      lastCheckOk: null,
      lastCheckMessage: null,
    };
    const saved = await this.prisma.$transaction(async (tx) => {
      const connection = await tx.kizTrueApiConnection.upsert({
        where: { clientId },
        create: { clientId, ...data, apiTokenEncrypted: data.apiTokenEncrypted! },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: existing ? 'KIZ_TRUE_API_CONNECTION_UPDATED' : 'KIZ_TRUE_API_CONNECTION_CREATED',
          entity: 'KizTrueApiConnection',
          entityId: connection.id,
          payload: { clientId, inn: dto.inn, productGroup: dto.productGroup, apiBaseUrl, tokenChanged: Boolean(apiToken) },
        },
      });
      return connection;
    });
    return { id: saved.id, configured: true };
  }

  async sync(clientId: string, dto: SyncKizCirculationDto | undefined, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'write'); // FIX
    const syncRequest = dto ?? {};
    const syncWindow = resolveKizSyncWindow(syncRequest);
    await this.requireClient(clientId);
    const connection = await this.prisma.kizTrueApiConnection.findUnique({ where: { clientId } });
    await this.marketplaces.listFbsOrders(clientId, user, true);

    const histories = await this.prisma.shippedKizHistory.findMany({
      where: {
        clientId,
        shippedAt: {
          gte: syncWindow.from,
          ...(syncWindow.to ? { lte: syncWindow.to } : {}),
        },
      },
      orderBy: { shippedAt: 'desc' },
      take: 10_000,
    });
    const assemblyIds = [...new Set(histories.map((row) => row.assemblyId))];
    const assemblies = assemblyIds.length
      ? await this.prisma.fbsTsdAssembly.findMany({
          where: { id: { in: assemblyIds } },
          select: { id: true, marketplace: true, connectionId: true, orderId: true },
        })
      : [];
    // FIX: выгрузка WB не должна подмешивать отгрузки Ozon или Яндекс из того же периода.
    const scopedAssemblies = syncRequest.marketplace
      ? assemblies.filter((row) => row.marketplace === syncRequest.marketplace)
      : assemblies;
    const assemblyById = new Map(scopedAssemblies.map((row) => [row.id, row]));
    const scopedHistories = histories.filter((row) => assemblyById.has(row.assemblyId));
    const links = scopedAssemblies.length
      ? await this.prisma.fbsOrderRequestLink.findMany({
          where: {
            clientId,
            connectionId: { in: [...new Set(scopedAssemblies.map((row) => row.connectionId))] },
            orderId: { in: [...new Set(scopedAssemblies.map((row) => row.orderId))] },
          },
        })
      : [];
    const linkByKey = new Map(
      links.map((row) => [`${row.marketplace}:${row.connectionId}:${row.orderId}`, row]),
    );

    let invalidCodes = 0;
    const retireCandidates: Prisma.KizCirculationItemCreateManyInput[] = [];
    for (const history of scopedHistories) {
      const assembly = assemblyById.get(history.assemblyId);
      if (!assembly) continue;
      const link = linkByKey.get(`${assembly.marketplace}:${assembly.connectionId}:${assembly.orderId}`);
      if (!link || !isFinalMarketplaceSale(assembly.marketplace, link.lastSupplierStatus, link.lastWbStatus)) continue;
      try {
        const cis = normalizeCisForTrueApi(history.kiz);
        retireCandidates.push({
          clientId,
          marketplace: assembly.marketplace,
          marketplaceConnectionId: assembly.connectionId,
          operation: KizCirculationOperation.RETIRE,
          sourceEventKey: `RETIRE:${assembly.marketplace}:${assembly.connectionId}:${assembly.orderId}:${cis}`,
          orderId: assembly.orderId,
          requestId: history.requestId,
          assemblyId: history.assemblyId,
          skuId: history.skuId,
          kizRaw: history.kiz,
          cis,
          productGroup: connection?.productGroup ?? '',
          eventAt: history.shippedAt,
          status: KizCirculationItemStatus.NEEDS_REVIEW,
          metadata: {
            requestNumber: history.requestNumber,
            productName: history.productName,
            internalSku: history.internalSku,
            source: 'MARKETPLACE_FINAL_SALE',
          },
        });
      } catch {
        invalidCodes += 1;
      }
    }
    const retireCreated = retireCandidates.length
      ? await this.prisma.kizCirculationItem.createMany({ data: retireCandidates, skipDuplicates: true })
      : { count: 0 };

    const retired = await this.prisma.kizCirculationItem.findMany({
      where: {
        clientId,
        marketplace: syncRequest.marketplace,
        operation: KizCirculationOperation.RETIRE,
        status: { in: [KizCirculationItemStatus.APPLIED, KizCirculationItemStatus.ALREADY_APPLIED] },
      },
      orderBy: { eventAt: 'desc' },
      take: 5000,
    });
    const marks = retired.length
      ? await this.prisma.productMark.findMany({
          where: {
            clientId,
            status: StockStatus.AVAILABLE,
            value: { in: [...new Set(retired.map((item) => item.kizRaw))] },
          },
          select: { value: true, updatedAt: true },
        })
      : [];
    const available = new Map(marks.map((mark) => [mark.value, mark]));
    const returnCandidates: Prisma.KizCirculationItemCreateManyInput[] = retired
      .filter((item) => available.has(item.kizRaw))
      .map((item) => ({
        clientId,
        marketplace: item.marketplace,
        marketplaceConnectionId: item.marketplaceConnectionId,
        operation: KizCirculationOperation.RETURN,
        sourceEventKey: `RETURN:${item.id}`,
        orderId: item.orderId,
        requestId: item.requestId,
        assemblyId: item.assemblyId,
        skuId: item.skuId,
        kizRaw: item.kizRaw,
        cis: item.cis,
        productGroup: item.productGroup || connection?.productGroup || '',
        eventAt: available.get(item.kizRaw)!.updatedAt,
        status: KizCirculationItemStatus.NEEDS_REVIEW,
        metadata: { source: 'PHYSICAL_RETURN_TO_AVAILABLE', retiredItemId: item.id },
      }));
    const returnCreated = returnCandidates.length
      ? await this.prisma.kizCirculationItem.createMany({ data: returnCandidates, skipDuplicates: true })
      : { count: 0 };
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'KIZ_CIRCULATION_SYNCED',
        entity: 'Client',
        entityId: clientId,
        payload: {
          scannedShipments: scopedHistories.length,
          retireCreated: retireCreated.count,
          returnCreated: returnCreated.count,
          invalidCodes,
          periodFrom: syncWindow.periodFrom,
          periodTo: syncWindow.periodTo,
          marketplace: syncRequest.marketplace ?? null,
        },
      },
    });
    return {
      scannedShipments: scopedHistories.length,
      retireCreated: retireCreated.count,
      returnCreated: returnCreated.count,
      invalidCodes,
      periodFrom: syncWindow.periodFrom,
      periodTo: syncWindow.periodTo,
      marketplace: syncRequest.marketplace ?? null,
    };
  }

  async importItems(dto: ImportKizCirculationItemsDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write'); // FIX
    await this.requireClient(dto.clientId);
    const connection = await this.prisma.kizTrueApiConnection.findUnique({ where: { clientId: dto.clientId } });
    const eventAt = dto.eventAt ? new Date(dto.eventAt) : new Date();
    const data = dto.codes.map((code) => {
      const kizRaw = code.trim();
      const cis = normalizeCisForTrueApi(kizRaw);
      return {
        clientId: dto.clientId,
        marketplace: dto.marketplace ?? MarketplaceType.OTHER,
        operation: dto.operation,
        sourceEventKey: `MANUAL:${dto.operation}:${randomUUID()}`,
        kizRaw,
        cis,
        productGroup: connection?.productGroup ?? '',
        eventAt,
        status: KizCirculationItemStatus.NEEDS_REVIEW,
        metadata: { source: 'MANUAL_IMPORT', importedBy: user.name },
      } satisfies Prisma.KizCirculationItemCreateManyInput;
    });
    const result = await this.prisma.kizCirculationItem.createMany({ data });
    return { imported: result.count };
  }

  async updateItem(itemId: string, dto: UpdateKizCirculationItemDto, user: AuthUser) {
    const item = await this.prisma.kizCirculationItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Строка КИЗ не найдена.');
    this.clientScopes.requireClientAccess(user, item.clientId, 'write'); // FIX
    if (
      item.batchId ||
      item.status === KizCirculationItemStatus.SUBMITTED ||
      item.status === KizCirculationItemStatus.APPLIED
    ) {
      throw new BadRequestException('Нельзя менять КИЗ после включения в подписанный или отправленный пакет.');
    }
    const nextCost = dto.productCostKopecks ?? item.productCostKopecks;
    const nextStatus = dto.excluded
      ? KizCirculationItemStatus.EXCLUDED
      : item.status === KizCirculationItemStatus.EXCLUDED
        ? checkedItemStatus(item.operation, item.remoteStatus ?? '', nextCost, item.remoteMessage)
        : item.remoteStatus
          ? checkedItemStatus(item.operation, item.remoteStatus, nextCost, item.remoteMessage)
          : item.status;
    return this.prisma.kizCirculationItem.update({
      where: { id: itemId },
      data: {
        ...(dto.productCostKopecks !== undefined ? { productCostKopecks: dto.productCostKopecks } : {}),
        ...(dto.productGroup ? { productGroup: dto.productGroup } : {}),
        status: nextStatus,
      },
    });
  }

  async checkItems(dto: CheckKizCirculationItemsDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write'); // FIX
    const connection = await this.requireConnection(dto.clientId);
    const ids = [...new Set(dto.itemIds)];
    const items = await this.prisma.kizCirculationItem.findMany({
      where: { id: { in: ids }, clientId: dto.clientId },
    });
    if (items.length !== ids.length) throw new BadRequestException('Часть выбранных КИЗ не найдена.');
    const response = await this.fetchCisInfo(connection, items.map((item) => item.cis));
    const resultRows = asArray(response);
    const byRequested = new Map(
      resultRows.map((row) => [text(asRecord(row.cisInfo).requestedCis) || text(asRecord(row.cisInfo).cis), row]),
    );
    await this.prisma.$transaction(
      items.map((item, index) => {
        const row = byRequested.get(item.cis) ?? resultRows[index] ?? {};
        const info = asRecord(row.cisInfo);
        const remoteStatus = text(info.status).toUpperCase();
        const remoteMessage = text(row.errorMessage) || null;
        return this.prisma.kizCirculationItem.update({
          where: { id: item.id },
          data: {
            remoteStatus: remoteStatus || null,
            remoteMessage,
            productGroup: text(info.productGroup) || item.productGroup || connection.productGroup,
            status: checkedItemStatus(item.operation, remoteStatus, item.productCostKopecks, remoteMessage),
          },
        });
      }),
    );
    await this.prisma.kizTrueApiConnection.update({
      where: { clientId: dto.clientId },
      data: { lastCheckedAt: new Date(), lastCheckOk: true, lastCheckMessage: `Проверено КИЗ: ${items.length}` },
    });
    return { checked: items.length };
  }

  async createBatch(dto: CreateKizCirculationBatchDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write'); // FIX
    const connection = await this.requireConnection(dto.clientId);
    const ids = [...new Set(dto.itemIds)];
    const items = await this.prisma.kizCirculationItem.findMany({
      where: { id: { in: ids }, clientId: dto.clientId, operation: dto.operation },
    });
    if (items.length !== ids.length) throw new BadRequestException('Часть выбранных КИЗ не найдена или имеет другой тип операции.');
    if (items.some((item) => item.status !== KizCirculationItemStatus.READY || item.batchId)) {
      throw new BadRequestException('В пакет можно включить только проверенные КИЗ со статусом «Готов».');
    }
    const groups = [...new Set(items.map((item) => item.productGroup || connection.productGroup))];
    if (groups.length !== 1) throw new BadRequestException('В одном документе ЧЗ должны быть КИЗ одной товарной группы.');
    if (dto.documentType === 'OTHER' && !dto.primaryDocumentCustomName) {
      throw new BadRequestException('Для типа документа «Прочее» укажите его наименование.');
    }
    if (dto.operation === KizCirculationOperation.RETIRE && !connection.kpp && !connection.fiasId) {
      throw new BadRequestException('Для вывода из оборота заполните КПП юрлица или ФИАС места деятельности ИП.');
    }
    const payload = buildKizCirculationDocument({
      operation: dto.operation,
      inn: connection.inn,
      kpp: connection.kpp,
      fiasId: connection.fiasId,
      actionDate: dto.actionDate,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      documentDate: dto.documentDate,
      primaryDocumentCustomName: dto.primaryDocumentCustomName,
      paid: dto.paid,
      items,
    });
    // FIX: JSONB не является источником подписываемых байтов. Сохраняем точную строку один раз.
    const payloadJson = JSON.stringify(payload);
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.kizCirculationBatch.create({
        data: {
          clientId: dto.clientId,
          operation: dto.operation,
          productGroup: groups[0],
          documentType: dto.operation === KizCirculationOperation.RETIRE ? 'LK_RECEIPT' : 'LP_RETURN',
          payload: payload as Prisma.InputJsonValue,
          payloadJson,
          payloadHash,
          createdByUserId: user.id,
          createdByName: user.name,
        },
      });
      const locked = await tx.kizCirculationItem.updateMany({
        where: { id: { in: ids }, status: KizCirculationItemStatus.READY, batchId: null },
        data: { batchId: batch.id, status: KizCirculationItemStatus.IN_BATCH },
      });
      if (locked.count !== ids.length) throw new BadRequestException('Состав пакета изменился. Обновите список и повторите.');
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'KIZ_CIRCULATION_BATCH_CREATED',
          entity: 'KizCirculationBatch',
          entityId: batch.id,
          payload: { clientId: dto.clientId, operation: dto.operation, itemCount: ids.length, payloadHash },
        },
      });
      return batch;
    });
  }

  async setSignature(batchId: string, signatureValue: string, user: AuthUser) {
    const batch = await this.prisma.kizCirculationBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Пакет КИЗ не найден.');
    this.clientScopes.requireClientAccess(user, batch.clientId, 'write'); // FIX
    if (batch.status !== KizCirculationBatchStatus.DRAFT) {
      throw new BadRequestException('Подпись можно добавить только в черновик.');
    }
    if (createHash('sha256').update(batch.payloadJson).digest('hex') !== batch.payloadHash) {
      throw new BadRequestException('JSON пакета повреждён. Сформируйте новый пакет.');
    }
    const signature = signatureValue.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
      throw new BadRequestException('УКЭП должна быть передана в формате Base64 без служебного текста.');
    }
    await this.prisma.$transaction([
      this.prisma.kizCirculationBatch.update({
        where: { id: batchId },
        data: { signatureEncrypted: this.crypto.encrypt(signature), status: KizCirculationBatchStatus.SIGNED },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'KIZ_CIRCULATION_BATCH_SIGNED',
          entity: 'KizCirculationBatch',
          entityId: batchId,
          payload: { payloadHash: batch.payloadHash },
        },
      }),
    ]);
    return { signed: true, payloadHash: batch.payloadHash };
  }

  async submit(batchId: string, confirmation: string, user: AuthUser) {
    if (confirmation.trim().toUpperCase() !== 'ОТПРАВИТЬ') {
      throw new BadRequestException('Для отправки в Честный знак введите ОТПРАВИТЬ.');
    }
    const batch = await this.prisma.kizCirculationBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });
    if (!batch) throw new NotFoundException('Пакет КИЗ не найден.');
    this.clientScopes.requireClientAccess(user, batch.clientId, 'write'); // FIX
    if (batch.status !== KizCirculationBatchStatus.SIGNED || !batch.signatureEncrypted) {
      throw new BadRequestException('Сначала подпишите неизменённый JSON пакета отделённой УКЭП.');
    }
    const connection = await this.requireConnection(batch.clientId);
    const statusRows = asArray(await this.fetchCisInfo(connection, batch.items.map((item) => item.cis)));
    const statuses = statusRows.map((row) => text(asRecord(row.cisInfo).status).toUpperCase());
    const expected = batch.operation === KizCirculationOperation.RETIRE
      ? ['INTRODUCED']
      : ['RETIRED', 'WRITTEN_OFF'];
    if (statuses.length !== batch.items.length || statuses.some((status) => !expected.includes(status))) {
      await this.releaseRejectedBatch(batch.id, batch.items, statuses);
      throw new BadRequestException('Статусы КИЗ изменились после формирования пакета. Пакет снят; проверьте КИЗ и соберите новый.');
    }
    const response = await this.trueApiRequest(connection, `/lk/documents/create?pg=${encodeURIComponent(batch.productGroup)}`, {
      method: 'POST',
      body: {
        document_format: 'MANUAL',
        // FIX: отправляем ровно те байты, которые оператор скачал и подписал.
        product_document: Buffer.from(batch.payloadJson, 'utf8').toString('base64'),
        type: batch.documentType,
        signature: this.crypto.decrypt(batch.signatureEncrypted),
      },
    });
    const responseRecord = asRecord(response);
    const crptDocumentId = typeof response === 'string'
      ? response.replace(/^"|"$/g, '')
      : text(responseRecord.value) || text(responseRecord.document_id) || text(responseRecord.id);
    if (!crptDocumentId) throw new BadGatewayException('Честный знак принял запрос без идентификатора документа.');
    await this.prisma.$transaction(async (tx) => {
      await tx.kizCirculationBatch.update({
        where: { id: batch.id },
        data: {
          status: KizCirculationBatchStatus.SUBMITTED,
          crptDocumentId,
          crptStatus: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });
      await tx.kizCirculationItem.updateMany({
        where: { batchId: batch.id },
        data: { status: KizCirculationItemStatus.SUBMITTED },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'KIZ_CIRCULATION_BATCH_SUBMITTED',
          entity: 'KizCirculationBatch',
          entityId: batch.id,
          payload: { crptDocumentId, payloadHash: batch.payloadHash, itemCount: batch.items.length },
        },
      });
    });
    return { submitted: true, crptDocumentId };
  }

  async refreshBatch(batchId: string, user: AuthUser) {
    const batch = await this.prisma.kizCirculationBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Пакет КИЗ не найден.');
    this.clientScopes.requireClientAccess(user, batch.clientId, 'write'); // FIX
    if (!batch.crptDocumentId) throw new BadRequestException('Пакет ещё не отправлен в Честный знак.');
    const connection = await this.requireConnection(batch.clientId);
    const response = asRecord(
      await this.trueApiRequest(connection, `/doc/${encodeURIComponent(batch.crptDocumentId)}/info`, { method: 'GET' }),
    );
    const status = text(response.status).toUpperCase() || 'UNKNOWN';
    const error = text(response.error_message) || text(response.errorMessage) || null;
    const applied = status === 'CHECKED_OK';
    const rejected = ['CHECKED_NOT_OK', 'PROCESSING_ERROR', 'REJECTED'].includes(status);
    await this.prisma.$transaction([
      this.prisma.kizCirculationBatch.update({
        where: { id: batch.id },
        data: {
          crptStatus: status,
          crptError: error,
          ...(applied ? { status: KizCirculationBatchStatus.APPLIED, processedAt: new Date() } : {}),
          ...(rejected ? { status: KizCirculationBatchStatus.REJECTED, processedAt: new Date() } : {}),
        },
      }),
      ...(applied || rejected
        ? [
            this.prisma.kizCirculationItem.updateMany({
              where: { batchId: batch.id },
              data: {
                status: applied ? KizCirculationItemStatus.APPLIED : KizCirculationItemStatus.ERROR,
                remoteMessage: error,
              },
            }),
          ]
        : []),
    ]);
    return { status, error, applied, rejected };
  }

  private async requireClient(clientId: string) {
    const normalized = clientId.trim();
    if (!normalized) throw new BadRequestException('Выберите клиента.');
    const client = await this.prisma.client.findUnique({
      where: { id: normalized },
      select: { id: true, code: true, name: true, inn: true, kpp: true, clientKind: true },
    });
    if (!client) throw new NotFoundException('Клиент не найден.');
    return client;
  }

  private async requireConnection(clientId: string) {
    const connection = await this.prisma.kizTrueApiConnection.findUnique({ where: { clientId } });
    if (!connection?.isActive) throw new BadRequestException('Сначала настройте активное подключение к Честному знаку.');
    if (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date()) {
      throw new BadRequestException('Токен True API истёк. Обновите его в настройках.');
    }
    return connection;
  }

  private fetchCisInfo(connection: Awaited<ReturnType<KizCirculationService['requireConnection']>>, cises: string[]) {
    return this.trueApiRequest(connection, `/cises/info?pg=${encodeURIComponent(connection.productGroup)}`, {
      method: 'POST',
      body: cises,
    });
  }

  private async trueApiRequest(
    connection: Awaited<ReturnType<KizCirculationService['requireConnection']>>,
    path: string,
    options: { method: 'GET' | 'POST'; body?: unknown },
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${officialTrueApiBase(connection.apiBaseUrl)}${path}`, {
        method: options.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.crypto.decrypt(connection.apiTokenEncrypted)}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload: unknown = raw;
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = raw;
      }
      if (!response.ok) {
        const record = asRecord(payload);
        throw new BadGatewayException(
          text(record.error_message) || text(record.message) || `True API вернул HTTP ${response.status}.`,
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(
        error instanceof Error && error.name === 'AbortError'
          ? 'Честный знак не ответил за 30 секунд.'
          : 'Не удалось связаться с True API Честного знака.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async releaseRejectedBatch(
    batchId: string,
    items: Array<{ id: string; operation: KizCirculationOperation; productCostKopecks: number | null }>,
    statuses: string[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.kizCirculationBatch.update({
        where: { id: batchId },
        data: { status: KizCirculationBatchStatus.REJECTED, crptStatus: 'PREFLIGHT_CHANGED', processedAt: new Date() },
      });
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const remoteStatus = statuses[index] || null;
        await tx.kizCirculationItem.update({
          where: { id: item.id },
          data: {
            batchId: null,
            remoteStatus,
            status: checkedItemStatus(item.operation, remoteStatus ?? '', item.productCostKopecks, null),
          },
        });
      }
    });
  }
}

function resolveKizSyncWindow(dto: SyncKizCirculationDto) {
  const hasFrom = Boolean(dto.periodFrom);
  const hasTo = Boolean(dto.periodTo);
  if (hasFrom !== hasTo) {
    throw new BadRequestException('Для выгрузки укажите обе даты периода: «с» и «по».');
  }
  if (!dto.periodFrom || !dto.periodTo) {
    return {
      from: new Date(Date.now() - 366 * 24 * 60 * 60 * 1000),
      to: null,
      periodFrom: null,
      periodTo: null,
    };
  }

  // ADDED: границы соответствуют календарным дням московского склада, а не UTC контейнера.
  const from = new Date(`${dto.periodFrom}T00:00:00.000+03:00`);
  const to = new Date(`${dto.periodTo}T23:59:59.999+03:00`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
    throw new BadRequestException('Дата начала выгрузки не может быть позже даты окончания.');
  }
  const inclusiveDays = Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (inclusiveDays > 366) {
    throw new BadRequestException('За один раз можно выгрузить не более 366 дней.');
  }
  return {
    from,
    to,
    periodFrom: dto.periodFrom,
    periodTo: dto.periodTo,
  };
}

function checkedItemStatus(
  operation: KizCirculationOperation,
  remoteStatus: string,
  productCostKopecks: number | null,
  error: string | null,
) {
  if (error || !remoteStatus) return KizCirculationItemStatus.ERROR;
  if (operation === KizCirculationOperation.RETIRE) {
    if (['RETIRED', 'WRITTEN_OFF'].includes(remoteStatus)) return KizCirculationItemStatus.ALREADY_APPLIED;
    if (remoteStatus === 'INTRODUCED') {
      return productCostKopecks ? KizCirculationItemStatus.READY : KizCirculationItemStatus.NEEDS_REVIEW;
    }
  } else {
    if (remoteStatus === 'INTRODUCED') return KizCirculationItemStatus.ALREADY_APPLIED;
    if (['RETIRED', 'WRITTEN_OFF'].includes(remoteStatus)) return KizCirculationItemStatus.READY;
  }
  return KizCirculationItemStatus.NEEDS_REVIEW;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.map(asRecord) : [asRecord(value)];
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim();
}
