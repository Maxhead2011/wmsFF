import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { InventoryLockService } from '../common/inventory/inventory-lock.service';
import { ClientScopeService } from '../modules/auth/client-scope.service';
import type { AuthUser } from '../modules/auth/auth.types';
import { StockBalancesService } from '../modules/stock/stock-balances.service';
import { StockOperationsService } from '../modules/stock/stock-operations.service';
import { readFbsPickedStockProof } from '../modules/stock/fbs-picked-stock-proof';

// FIX: a current physical confirmation is mandatory; old marks alone cannot restore stock.
export function validateDoubleConsumptionRepair(input: {
  available: number; physical: number; duplicate: number; unprotectedMarks: number;
  activePlacedBox: boolean; laterRecount: boolean; activeWork: boolean; fullyPickedBeforeClosing: boolean;
}) {
  if (![input.available,input.physical,input.duplicate,input.unprotectedMarks].every(n=>Number.isInteger(n)&&n>=0) ||
      input.duplicate === 0 || !input.activePlacedBox || input.laterRecount || input.activeWork ||
      !input.fullyPickedBeforeClosing || input.available + input.duplicate !== input.physical ||
      input.unprotectedMarks < input.physical) {
    throw new Error('Корректировка заблокирована: нужны совпадающие движения, физический пересчёт, свободные КИЗы и отсутствие поздних корректировок/активной работы.');
  }
  return input.duplicate;
}

type Options = { boxCode: string; movementIds: string[]; physical: number; userId: string; apply: boolean; digest?: string };

// FIX: preview and apply share every check; SERIALIZABLE aborts on concurrent warehouse changes.
export async function repairDoubleConsumption(db: PrismaClient, options: Options) {
  return db.$transaction(async tx => {
    if (!options.apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const operator = await tx.user.findUnique({ where: { id: options.userId },
      select: { id:true, status:true, roles: { select: { role: { select: { code:true } } } } } });
    if (!operator || operator.status !== 'ACTIVE' || !operator.roles.some(r=>r.role.code==='ADMIN')) {
      throw new Error('Требуется активный администратор.');
    }
    const ids = [...new Set(options.movementIds)].sort();
    if (!ids.length || ids.length !== options.movementIds.length) throw new Error('Нужны уникальные ID ошибочных движений.');
    const repaired = await tx.stockMovement.count({where:{idempotencyKey:{in:ids.map(id=>`repair-fbs-double:${id}`)}}});
    if (repaired === ids.length) return {status:'ALREADY_APPLIED'};
    if (repaired) throw new Error('Часть движений уже исправлена. Получите новый снимок.');
    const moves = await tx.stockMovement.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}});
    if (moves.length !== ids.length) throw new Error('Не все движения найдены.');
    const first=moves[0];
    const box=first.boxId ? await tx.box.findUnique({where:{id:first.boxId},include:{storagePlacement:true}}) : null;
    if (!box || box.code!==options.boxCode || !box.warehouseId) throw new Error('Короб или филиал не совпадает.');
    if (moves.some(m=>m.clientId!==box.clientId || m.warehouseId!==box.warehouseId || m.boxId!==box.id ||
      m.skuId!==first.skuId || m.status!=='AVAILABLE' || m.quantity>=0 ||
      !['PICK','SHIP'].includes(m.type) || !m.idempotencyKey?.startsWith(`manual-status-done:${m.sourceDocument}:`))) {
      throw new Error('Движения не являются повторным списанием одной позиции одного короба.');
    }
    let fullyPickedBeforeClosing=true;
    const proofIds:string[]=[];
    for (const requestId of [...new Set(moves.map(m=>m.sourceDocument!))]) {
      const request=await tx.clientRequest.findUnique({where:{id:requestId},include:{items:true}});
      if(!request || request.status!=='DONE' || request.clientId!==box.clientId) throw new Error('Заявка не завершена или изменён клиент.');
      const proofs=await readFbsPickedStockProof(tx,request,box.warehouseId);
      const requested=request.items.filter(i=>i.skuId===first.skuId).reduce((s,i)=>s+i.quantity,0);
      const relevant=proofs.filter(p=>p.skuId===first.skuId);
      const picked=relevant.reduce((s,p)=>s+p.quantity,0);
      const closing=moves.filter(m=>m.sourceDocument===requestId);
      const currentProofIds=relevant.flatMap(p=>p.movementIds);
      const after=await tx.stockMovement.count({where:{id:{in:currentProofIds},createdAt:{gte:new Date(Math.min(...closing.map(m=>m.createdAt.getTime())))}}});
      fullyPickedBeforeClosing &&= requested>0 && picked>=requested && !after && closing.reduce((s,m)=>s-m.quantity,0)<=requested;
      proofIds.push(...currentProofIds);
    }
    const earliest=new Date(Math.min(...moves.map(m=>m.createdAt.getTime())));
    const balances=await tx.stockBalance.findMany({where:{boxId:box.id,skuId:first.skuId}});
    if(balances.some(b=>b.warehouseId!==box.warehouseId || b.clientId!==box.clientId)) throw new Error('Неоднозначные измерения остатка.');
    const available=balances.filter(b=>b.status==='AVAILABLE').reduce((s,b)=>s+b.quantity,0);
    const laterRecount=(await tx.stockMovement.count({where:{boxId:box.id,skuId:first.skuId,type:'INVENTORY_ADJUSTMENT',createdAt:{gt:earliest}}}))>0 ||
      (await tx.inventoryAuditBox.count({where:{boxId:box.id,updatedAt:{gt:earliest}}}))>0;
    const activeWork=(await tx.fbsTsdAssembly.count({where:{OR:[{boxId:box.id},{reservedBoxId:box.id}],status:{notIn:['COMPLETED','CANCELLED']}}}))>0 ||
      (await tx.clientRequestBoxSelection.count({where:{boxId:box.id,requestItem:{request:{status:{notIn:['DONE','CANCELLED','REJECTED']}}}}}))>0;
    const marks=await tx.productMark.findMany({where:{boxId:box.id,skuId:first.skuId,clientId:box.clientId,status:'AVAILABLE'},orderBy:{id:'asc'}});
    let unprotectedMarks=0;
    for(const mark of marks) {
      const identity=mark.value.match(/^01\d{14}21.{13}/)?.[0];
      if(!identity) continue;
      const protectedCount=(await tx.fbsTsdAssembly.count({where:{kiz:{startsWith:identity}}})) +
        (await tx.shippedKizHistory.count({where:{kiz:{startsWith:identity}}})) +
        (await tx.fbsWebKizStickerPrint.count({where:{kiz:{startsWith:identity}}})) +
        (await tx.fbsAssemblyAttemptHistory.count({where:{taskSnapshot:{path:['kiz'],string_starts_with:identity}}}));
      if(!protectedCount) unprotectedMarks++;
    }
    const duplicate=moves.reduce((s,m)=>s-m.quantity,0);
    validateDoubleConsumptionRepair({available,physical:options.physical,duplicate,unprotectedMarks,
      activePlacedBox:!['archived','deleted'].includes(box.status) && Boolean(box.storagePlacement),
      laterRecount,activeWork,fullyPickedBeforeClosing});
    const snapshot={boxId:box.id,boxCode:box.code,clientId:box.clientId,warehouseId:box.warehouseId,skuId:first.skuId,
      available,physical:options.physical,duplicate,movementIds:ids,proofIds:proofIds.sort(),
      balances:balances.map(b=>({id:b.id,quantity:b.quantity,status:b.status,updatedAt:b.updatedAt})),
      marks:marks.map(m=>({id:m.id,updatedAt:m.updatedAt})),placement:box.storagePlacement};
    const digest=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    if(!options.apply) return {status:'PREVIEW',digest,snapshot};
    if(options.digest!==digest) throw new Error('Снимок изменился. Повторите анализ.');
    const adapter=Object.assign(Object.create(tx),{$transaction:async(callback:(transaction:Prisma.TransactionClient)=>unknown)=>callback(tx)}) as PrismaService;
    const scopes=new ClientScopeService();
    const service=new StockOperationsService(adapter,scopes,new StockBalancesService(adapter,scopes),undefined,undefined,new InventoryLockService(adapter));
    const user={id:operator.id,roleCodes:['ADMIN'],permissionCodes:['stock:write'],clientScopeMode:'LIMITED',
      clientIds:[box.clientId],writableClientIds:[box.clientId],activeWarehouseId:box.warehouseId,
      warehouseIds:[box.warehouseId],writableWarehouseIds:[box.warehouseId]} as AuthUser;
    let counted=available;
    for(const move of moves) {
      counted-=move.quantity;
      await service.adjustInventoryToCounted({clientId:box.clientId,skuId:first.skuId,boxCode:box.code,
        countedQuantity:counted,status:'AVAILABLE',idempotencyKey:`repair-fbs-double:${move.id}`,
        comment:`Исправление доказанного повторного списания ${move.id}; физический остаток подтверждён Константином; снимок ${digest}`},user);
    }
    await tx.auditLog.create({data:{userId:operator.id,action:'REPAIR_FBS_DOUBLE_CONSUMPTION',entity:'Box',entityId:box.id,
      payload:JSON.parse(JSON.stringify({digest,...snapshot,after:counted}))}});
    return {status:'APPLIED',boxCode:box.code,before:available,after:counted,delta:duplicate,digest};
  },{isolationLevel:'Serializable',timeout:30000});
}

if(require.main===module) {
  const args=process.argv.slice(2);
  const value=(name:string)=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)??'';
  const db=new PrismaClient();
  repairDoubleConsumption(db,{boxCode:value('box'),movementIds:value('movements').split(',').filter(Boolean),
    physical:Number(value('physical')),userId:value('user'),apply:args.includes('--apply'),digest:value('digest')})
    .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
}
