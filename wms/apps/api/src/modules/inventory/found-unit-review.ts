import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { physicalKizIdentity } from '../../common/kiz-physical-identity';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';

export const foundUnitEnabled = () => process.env.WMS_INVENTORY_FOUND_UNIT_ENABLED === 'true';
// FIX: caller owns a serializable transaction. This corrects ownership only, never quantity.
export async function confirmFoundUnit(tx: Prisma.TransactionClient, auditId: string,
  input: { kiz: string; reason: string; confirmed: boolean }, user: AuthUser) {
  if (!foundUnitEnabled() || user.isDemo || !user.roleCodes.some(r => ['ADMIN','OWNER'].includes(r)))
    throw new ForbiddenException('Подтверждение найденной единицы доступно администратору и собственнику.');
  const stop = (message: string): never => { throw new ConflictException(message); };
  const identity = physicalKizIdentity(input.kiz);
  if (!input.confirmed || input.reason.trim().length < 10 || !identity) stop('Отсканируйте КИЗ, укажите причину и подтвердите физическое наличие.');
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`sorting-kiz:${identity}`}))`);
  const audit = await tx.inventoryAuditBox.findUniqueOrThrow({ where: { id: auditId }, include: { session: true, lines: true } });
  new ClientScopeService().requireClientAccess(user, audit.clientId, 'write');
  if (!user.permissionCodes.includes('system:admin') && !user.writableWarehouseIds?.includes(audit.session.warehouseId!))
    throw new ForbiddenException('Нет доступа к филиалу.');
  const proofId = `inventory-found-unit:${auditId}:${identity}`;
  const proof = await tx.auditLog.findUnique({ where: { id: proofId } });
  if (proof) return { confirmed: true, alreadyApplied: true };
  if (audit.session.type !== 'BOX_CHECK' || !['ACTIVE','REVIEW'].includes(audit.session.status) ||
      !['MATCHED','MISMATCH'].includes(audit.status) || !audit.completedAt) stop('Нужен завершённый актуальный пересчёт на разборе.');
  const latest = await tx.inventoryAuditBox.findFirst({ where: { boxId: audit.boxId }, orderBy: [{ startedAt:'desc' },{ id:'desc' }] });
  if (latest?.id !== audit.id) stop('Есть более новый пересчёт короба.');
  const prefixes = [identity, ']d2'+identity, ']D2'+identity].map(p => p.replace(/[\\%_]/g,'\\$&'));
  const marks = await tx.productMark.findMany({ where: { clientId:audit.clientId,
    OR:prefixes.map(prefix => ({ value:{ startsWith:prefix } })) } });
  const matches = marks.filter(m => physicalKizIdentity(m.value) === identity);
  if (matches.length !== 1) stop('КИЗ не найден однозначно. Требуется проверка приёмки.');
  const mark = matches[0];
  if (mark.status !== 'AVAILABLE' || !mark.boxId || mark.boxId === audit.boxId || mark.updatedAt >= audit.startedAt)
    stop('Привязка КИЗ изменилась или единица недоступна.');
  for (const boxId of [mark.boxId!,audit.boxId].sort())
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Box" WHERE id=${boxId} FOR UPDATE`);
  const boxes = await tx.box.findMany({ where:{ id:{ in:[mark.boxId!,audit.boxId] } } });
  if (boxes.length !== 2 || boxes.some(b => b.clientId !== audit.clientId || b.warehouseId !== audit.session.warehouseId || !['active','receiving'].includes(b.status)))
    stop('Изменилась принадлежность или состояние короба.');
  const line = audit.lines.find(l => l.skuId === mark.skuId);
  if (!line || line.countedQuantity < 1) stop('Товар отсутствует в фактическом пересчёте.');
  const scans = await tx.auditLog.findMany({ where:{ action:'INVENTORY_KIZ_SCAN',entityId:auditId,createdAt:{gte:audit.startedAt} } });
  const scanned = scans.map(s=>s.payload as Prisma.JsonObject).filter(s=>s.roundStartedAt===audit.startedAt.toISOString() &&
    s.clientId===audit.clientId && s.boxId===audit.boxId && s.skuId===mark.skuId && s.lineId===line!.id && typeof s.kiz==='string');
  const identities = new Set(scanned.map(s=>physicalKizIdentity(s.kiz as string)));
  if (!identities.has(identity) || identities.size !== line!.countedQuantity) stop('Неполные физические сканы товара. Нужен пересчёт.');
  const balances = await tx.stockBalance.findMany({ where:{ boxId:{in:[mark.boxId!,audit.boxId]},skuId:mark.skuId } });
  if (balances.some(b=>b.clientId!==audit.clientId || b.warehouseId!==audit.session.warehouseId || b.quantity<0 || b.quantity>0&&b.status!=='AVAILABLE'))
    stop('Есть резерв или недоступный остаток.');
  if (balances.some(b=>b.boxId===mark.boxId&&b.quantity!==0)) stop('В исходном коробе есть остаток. Используйте обычную актуализацию.');
  if (balances.filter(b=>b.boxId===audit.boxId&&b.status==='AVAILABLE').reduce((s,b)=>s+b.quantity,0)!==line!.countedQuantity)
    stop('Фактическое количество целевого товара ещё не подтверждено.');
  const whereKiz = { OR:prefixes.map(prefix=>({kiz:{startsWith:prefix}})) };
  const [fbo,fbs,shipped,wbShipment,activeFbo,reserved,counting,moved] = await Promise.all([
    tx.fboAssemblyUnit.findFirst({where:{OR:[{markId:mark.id},...whereKiz.OR]}}),
    tx.fbsTsdAssembly.findFirst({where:whereKiz}),
    tx.shippedKizHistory.findFirst({where:whereKiz}),
    tx.wbOrderShipment.findFirst({where:whereKiz}),
    tx.fboAssemblyUnit.findFirst({where:{skuId:mark.skuId,state:{in:['PICKED','PACKED']},
      assembly:{phase:{not:'COMPLETED'},request:{status:{notIn:['DONE','CANCELLED']}}},
      OR:[{sourceBoxId:{in:[mark.boxId!,audit.boxId]}},{targetBoxId:{in:[mark.boxId!,audit.boxId]}}]}}),
    tx.fbsTsdAssembly.findFirst({where:{clientId:audit.clientId,status:{in:['RESERVED','RESCAN_REQUIRED','IN_PROGRESS','RETURN_REQUIRED']},
      AND:[{OR:[{skuId:mark.skuId},{sourceSkuId:mark.skuId}]},{OR:[{boxId:{in:[mark.boxId!,audit.boxId]}},{reservedBoxId:{in:[mark.boxId!,audit.boxId]}}]}]}}),
    tx.inventoryAuditBox.findFirst({where:{boxId:mark.boxId!,status:'COUNTING'}}),
    tx.stockMovement.findFirst({where:{boxId:{in:[mark.boxId!,audit.boxId]},skuId:mark.skuId,createdAt:{gt:audit.startedAt},
      OR:[{idempotencyKey:null},{idempotencyKey:{notIn:audit.lines.map(l=>`web-inventory:${l.id}`)}}]}}),
  ]);
  if (fbo || fbs || shipped || wbShipment) stop('У КИЗ есть история сборки или отгрузки. Требуется отдельный разбор возврата.');
  if (activeFbo || reserved || counting || moved) stop('Есть активная сборка, пересчёт или движение после скана. Обновите проверку.');
  const changed = await tx.productMark.updateMany({where:{id:mark.id,boxId:mark.boxId,status:mark.status,updatedAt:mark.updatedAt},
    data:{boxId:audit.boxId,stockMovementId:null}});
  if (changed.count!==1) stop('КИЗ изменился параллельно. Повторите проверку.');
  await tx.auditLog.create({data:{id:proofId,userId:user.id,action:'INVENTORY_FOUND_UNIT_CONFIRMED',entity:'InventoryAuditBox',entityId:auditId,
    payload:JSON.parse(JSON.stringify({reason:input.reason.trim(),identity,previousMark:mark,balances,targetBoxId:audit.boxId,
      roundStartedAt:audit.startedAt,evidenceIds:scans.map(s=>s.id),quantityChanged:0,historicalShipmentsPreserved:true}))}});
  return {confirmed:true,alreadyApplied:false};
}
