import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { effectiveWarehouseId } from './client-request-warehouse-scope';
import { ImportOutboundRequestXlsxDto } from './dto/import-outbound-request-xlsx.dto';
import { parseOzonFboRows } from './parsers/ozon-fbo-xlsx.parser';
import type { OzonDirection } from '../tsd/ozon-fbo-directions';

@Injectable()
export class OzonFboImportService {
  constructor(private readonly db: PrismaService, private readonly scopes: ClientScopeService) {}
  // FIX: the Ozon screen lists the same assemblies it creates, within client and branch scope.
  async list(clientId: string, user: AuthUser) {
    if (process.env.WMS_OZON_FBO_IMPORT_ENABLED !== 'true') throw new NotFoundException('Импорт ФБО Ozon выключен.');
    if (!clientId?.trim()) throw new BadRequestException('Выберите клиента.');
    this.scopes.requireClientAccess(user, clientId, 'read');
    const warehouseId = effectiveWarehouseId(user, 'read') ?? user.activeWarehouseId;
    if (!warehouseId) throw new BadRequestException('Выберите филиал.');
    const rows = await this.db.clientRequest.findMany({where:{clientId,warehouseId,ozonShipment:{isNot:null}},
      orderBy:{createdAt:'desc'},take:100,select:{id:true,number:true,title:true,status:true,desiredDate:true,destinationCity:true,
        items:{select:{quantity:true}},ozonShipment:{select:{directions:true}},fboAssembly:{select:{phase:true}}}});
    return rows.map(r=>({id:r.id,number:r.number,title:r.title,status:r.status,desiredDate:r.desiredDate,destinationCity:r.destinationCity,
      quantity:r.items.reduce((s,i)=>s+i.quantity,0),directions:(r.ozonShipment!.directions as unknown[]).length,phase:r.fboAssembly?.phase??'NOT_STARTED'}));
  }
  async preview(file: Express.Multer.File, dto: ImportOutboundRequestXlsxDto, user: AuthUser) {
    if (process.env.WMS_OZON_FBO_IMPORT_ENABLED !== 'true') throw new NotFoundException('Импорт ФБО Ozon выключен.');
    this.scopes.requireClientAccess(user, dto.clientId, 'write');
    const warehouseId = effectiveWarehouseId(user, 'write') ?? user.activeWarehouseId;
    if (!warehouseId || !await this.db.warehouseClient.findFirst({ where: { clientId: dto.clientId, warehouseId, status: 'ACTIVE', warehouse: { isActive: true } } }))
      throw new BadRequestException('Выберите филиал, в котором активен клиент.');
    const client = await this.db.client.findUniqueOrThrow({ where: { id: dto.clientId } });
    if (client.storesWithoutBoxes) throw new BadRequestException('Для этой сборки нужен учёт клиента по коробам.');
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
  async commit(file: Express.Multer.File, dto: ImportOutboundRequestXlsxDto, user: AuthUser) {
    const p = await this.preview(file, dto, user);
    return this.db.$transaction(async tx => {
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
    });
  }
}
