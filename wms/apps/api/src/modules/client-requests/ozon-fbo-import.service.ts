import {supplyOrders,type SupplyIntegration} from './ozon-supply-policy';
import { fboProgressLabels } from '../tsd/fbo-progress-status';
import { requestStoreContexts } from '../clients/request-store-context';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestStatus } from '@prisma/client';
import {unboxedFboEnabled} from '../tsd/fbo-unboxed-picking';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { effectiveWarehouseId } from './client-request-warehouse-scope';
import { OzonFboImportDto } from './dto/ozon-fbo-import.dto';
import { parseOzonFboRows } from './parsers/ozon-fbo-xlsx.parser';
import type { OzonDirection } from '../tsd/ozon-fbo-directions';

@Injectable()
export class OzonFboImportService {
  constructor(private readonly db: PrismaService, private readonly scopes: ClientScopeService) {}
  // FIX: scope candidates to this client; never fall back across an internal user's branch.
  async warehouses(clientId: string, user: AuthUser, mode: 'read' | 'write' = 'write') {
    if (process.env.WMS_OZON_FBO_IMPORT_ENABLED !== 'true') throw new NotFoundException('Импорт ФБО Ozon выключен.');
    if (!clientId?.trim()) throw new BadRequestException('Выберите клиента.');
    this.scopes.requireClientAccess(user, clientId, mode);
    const scoped = effectiveWarehouseId(user, mode);
    const fixed = scoped ?? (!(user.roleCodes ?? []).includes('CLIENT') ? user.activeWarehouseId : null);
    const rows = await this.db.warehouseClient.findMany({where: {
      clientId, status: 'ACTIVE', warehouse: {isActive: true}, ...(fixed ? {warehouseId: fixed} : {}),
    }, select: {warehouseId: true, warehouse: {select: {name: true}}}, orderBy: {warehouseId: 'asc'}});
    return rows.map(row => ({id: row.warehouseId, name: row.warehouse.name}));
  }
  // FIX: file and link imports share the same client/branch authorization.
  async resolveWarehouse(clientId: string, user: AuthUser, mode: 'read' | 'write', selected?: string) {
    const choices = await this.warehouses(clientId, user, mode);
    const scoped = effectiveWarehouseId(user, mode);
    const cabinet = (user.roleCodes ?? []).includes('CLIENT');
    const requested = selected?.trim() || scoped || (!cabinet ? user.activeWarehouseId : null);
    if (requested) {
      if (!choices.some(row => row.id === requested)) throw new BadRequestException('Выбранный филиал недоступен для этого клиента.');
      return requested;
    }
    if (cabinet && choices.length === 1) return choices[0].id;
    throw new BadRequestException(choices.length ? 'Выберите филиал.' : 'У клиента нет активного филиала.');
  }
  // FIX: the Ozon screen lists the same assemblies it creates, within client and branch scope.
  async list(clientId: string, user: AuthUser, selectedWarehouseId?: string, view: string = 'active', allClients?: string, beforeNumber?: string) {
    if (process.env.WMS_OZON_FBO_IMPORT_ENABLED !== 'true') throw new NotFoundException('Импорт ФБО Ozon выключен.');
    if (allClients !== undefined && allClients !== 'true' && allClients !== 'false') throw new BadRequestException('Неизвестный режим списка сборок.');
    // FIX: opt-in affects reads only; imports keep their explicit client/branch requirements.
    const all = allClients === 'true' && process.env.WMS_MARKETPLACE_WORKSPACES_ENABLED === 'true';
    if (!all && !clientId?.trim()) throw new BadRequestException('Выберите клиента.');
    if (beforeNumber !== undefined && (!all || typeof beforeNumber !== 'string' || !/^[1-9]\d*$/.test(beforeNumber) || !Number.isSafeInteger(Number(beforeNumber)))) throw new BadRequestException('Некорректный номер страницы сборок.');
    let clientFilter: ReturnType<ClientScopeService['resolveClientFilter']> = clientId;
    let warehouseId: string | undefined;
    if (all) {
      clientFilter = this.scopes.resolveClientFilter(user, clientId?.trim() || undefined);
      const fixed = effectiveWarehouseId(user, 'read') ?? (!(user.roleCodes ?? []).includes('CLIENT') ? user.activeWarehouseId : null);
      const selected = selectedWarehouseId?.trim();
      if (fixed && selected && fixed !== selected) throw new BadRequestException('Выбранный филиал недоступен в текущем контуре.');
      warehouseId = fixed || selected || undefined;
    } else {
      this.scopes.requireClientAccess(user, clientId, 'read');
      warehouseId = await this.resolveWarehouse(clientId, user, 'read', selectedWarehouseId);
    }
    // FIX: filter before take; completed packing alone does not mean handover.
    if (view !== 'active' && view !== 'completed') throw new BadRequestException('Неизвестный список сборок.');
    const closed = [ClientRequestStatus.DONE, ClientRequestStatus.CANCELLED, ClientRequestStatus.REJECTED];
    const rows = await this.db.clientRequest.findMany({where:{clientId:clientFilter,warehouseId,ozonShipment:{isNot:null},
      ...(beforeNumber !== undefined ? {number:{lt:Number(beforeNumber)}} : {}),
      status: view === 'completed' ? {in:closed} : {notIn:closed}},
      orderBy:all?{number:'desc'}:{createdAt:'desc'},take:100,select:{id:true,clientId:true,number:true,title:true,status:true,desiredDate:true,destinationCity:true,
        ...(all?{clientId:true,createdAt:true,client:{select:{name:true,code:true}},warehouse:{select:{name:true}}}:{}),
        items:{select:{quantity:true,...(all?{name:true,barcode:true}:{})}},ozonShipment:{select:{directions:true,integration:true}},fboAssembly:{select:{phase:true}}}});
    const progressLabels = await fboProgressLabels(this.db, rows.map(r => r.id));
    // FIX: resolve shops only after the existing client/warehouse filters.
    const stores = await requestStoreContexts(this.db, rows);
    return rows.map(r=>({...stores.get(r.id),id:r.id,number:r.number,title:r.title,status:r.status,fboProgressLabel:progressLabels[r.id],desiredDate:r.desiredDate,destinationCity:r.destinationCity,
      ...(all?{clientId:r.clientId,clientName:r.client?.name??null,clientCode:r.client?.code??null,warehouseName:r.warehouse?.name??null,createdAt:r.createdAt,
        itemCount:r.items.length,itemsPreview:r.items.slice(0,3).map(i=>({name:i.name??null,barcode:i.barcode??null,quantity:i.quantity}))}:{}),
      editDeadlines:r.ozonShipment?.integration?supplyOrders(r.ozonShipment.integration as SupplyIntegration).map(o=>({orderId:o.orderId,orderNumber:o.orderNumber,editDeadlineAt:o.editDeadlineAt??null,checkedAt:o.checkedAt})):[],
      quantity:r.items.reduce((s,i)=>s+i.quantity,0),directions:(r.ozonShipment!.directions as unknown[]).length,phase:r.fboAssembly?.phase??'NOT_STARTED'}));
  }
  async preview(file: Express.Multer.File, dto: OzonFboImportDto, user: AuthUser) {
    if (process.env.WMS_OZON_FBO_IMPORT_ENABLED !== 'true') throw new NotFoundException('Импорт ФБО Ozon выключен.');
    this.scopes.requireClientAccess(user, dto.clientId, 'write');
    const warehouseId = await this.resolveWarehouse(dto.clientId, user, 'write', dto.warehouseId);
    const client = await this.db.client.findUniqueOrThrow({ where: { id: dto.clientId } });
    if (client.storesWithoutBoxes && !unboxedFboEnabled()) throw new BadRequestException('Для этой сборки нужен учёт клиента по коробам.');
    if (!dto.destinationCity?.trim()) throw new BadRequestException('Укажите место общей отгрузки.');
    if (!file?.buffer?.length || file.buffer.length > 10 * 1024 * 1024) throw new BadRequestException('Нужен Excel-файл до 10 МБ.');
    let parsed: ReturnType<typeof parseOzonFboRows>;
    try {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      parsed = parseOzonFboRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }));
    } catch (e) { throw new BadRequestException(e instanceof Error ? e.message : 'Не удалось прочитать Excel.'); }
    const matches = await this.db.barcode.findMany({ where: { value: { in: [...new Set(parsed.map(l => l.barcode))] }, sku: { clientId: dto.clientId } }, include: { sku: true } });
    const directions: OzonDirection[] = [];
    for (const line of parsed) {
      const found = matches.filter(m => m.value === line.barcode);
      if (new Set(found.map(m => m.skuId)).size !== 1) throw new BadRequestException(`Строка ${line.row}: ШК ${line.barcode} не найден однозначно у выбранного клиента.`);
      let d = directions.find(d => d.name === line.direction);
      if (!d) { d = { name: line.direction, items: [] }; directions.push(d); }
      const item = d.items.find(i => i.skuId === found[0].skuId);
      if (item) item.quantity += line.quantity;
      else d.items.push({ skuId: found[0].skuId, barcode: line.barcode, quantity: line.quantity });
    }
    const items: Array<{ skuId: string; barcode: string; name: string; quantity: number }> = [];
    for (const d of directions) for (const line of d.items) {
      const item = items.find(i => i.skuId === line.skuId);
      if (item) item.quantity += line.quantity;
      else items.push({ ...line, name: matches.find(m => m.skuId === line.skuId)!.sku.name });
    }
    if (items.length > 1000) throw new BadRequestException('Не больше 1000 товаров в одной сборке.');
    // FIX: retrying the same customer allocation does not create a second reservation.
    const importKey = createHash('sha256').update(JSON.stringify([dto.clientId, warehouseId, dto.desiredDate ?? null, dto.destinationCity.trim(),
      directions.map(d => [d.name, d.items.map(i => [i.skuId, i.quantity]).sort()]).sort()])).digest('hex');
    return { warehouseId, importKey, directions, items, totalQuantity: items.reduce((s, i) => s + i.quantity, 0) };
  }
  async commit(file: Express.Multer.File, dto: OzonFboImportDto, user: AuthUser) {
    const p = await this.preview(file, dto, user);
    return this.db.$transaction(tx => this.createPrepared(tx,p,file,dto,user));
  }
  // FIX: link import creates demand and external ownership in the same transaction.
  async createPrepared(tx: any, p: Awaited<ReturnType<OzonFboImportService['preview']>>, file: Express.Multer.File, dto: OzonFboImportDto, user: AuthUser) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.importKey}))`;
      const prior = await tx.ozonFboShipment.findUnique({ where: { importKey: p.importKey }, include: { request: true } });
      if (prior) return { request: prior.request, directions: p.directions, existing: true };
      const request = await tx.clientRequest.create({ data: {
        clientId: dto.clientId, warehouseId: p.warehouseId, type: 'OUTBOUND', status: 'SUBMITTED', priority: dto.priority ?? 'NORMAL',
        title: dto.title?.trim() || `ФБО Ozon · ${p.directions.length} направлений`,
        comment: `Создано из Excel: ${file.originalname}. ФБО Ozon, ${p.totalQuantity} шт.`,
        destinationCity: dto.destinationCity.trim(), deliveryAddress: dto.deliveryAddress,
        desiredDate: dto.desiredDate ? new Date(dto.desiredDate) : undefined, createdByUserId: user.id,
        items: { create: p.items },
        ozonShipment: { create: { importKey: p.importKey, directions: p.directions } },
        files: { create: { clientId: dto.clientId, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.buffer.length, content: Uint8Array.from(file.buffer), uploadedByUserId: user.id } },
        events: { create: { clientId: dto.clientId, eventType: 'CREATED', title: 'Единая сборка ФБО Ozon из файла клиента', statusTo: 'SUBMITTED', createdByUserId: user.id } },
      } });
      return { request, directions: p.directions, existing: false };
  }
}
