import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { clientKizFilter, clientKizIdentity } from './kiz-client-registry';

const palitra = 'e8597352-0b93-442c-9582-c694620a9695';
export const palitraPickEnabled = (clientId: string) =>
  clientId === palitra && process.env.WMS_PALITRA_PICK_KIZ === 'true';

interface PickInput {
  clientId: string; skuId: string; boxId?: string | null; warehouseId?: string | null; kiz: string;
}

// FIX: label an existing piece only when its physical box has unmarked capacity.
export async function checkNewPickMark(tx: any, input: PickInput) {
  const {clientId, skuId, boxId, warehouseId, kiz} = input;
  const identity = clientKizIdentity(kiz);
  if (clientId !== palitra || !identity || !warehouseId) throw new ConflictException('Для привязки КИЗ подтвердите товар и исходный короб.');
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'sorting-kiz:'+identity}))::text`);
  if (boxId) {
  const boxes = await tx.$queryRaw(Prisma.sql`SELECT id FROM "Box" WHERE id=${boxId} AND "clientId"=${clientId} AND "warehouseId"=${warehouseId} AND status='active' FOR UPDATE`);
  if (boxes.length !== 1) throw new ConflictException('Исходный короб недоступен в филиале заявки.');
  } else {
    const locked = await tx.$queryRaw(Prisma.sql`SELECT s.id FROM "Sku" s JOIN "Client" c ON c.id=s."clientId" WHERE s.id=${skuId} AND c.id=${clientId} AND c."storesWithoutBoxes" FOR UPDATE OF s`);
    if (locked.length !== 1) throw new ConflictException('Источник без короба недоступен.');
  }
  const gtin = identity.slice(2,16);
  const codes = [gtin];
  for (const length of [13,12,8]) if (gtin.slice(-length).padStart(14,'0') === gtin) codes.push(gtin.slice(-length));
  const matches = await tx.barcode.findMany({where:{value:{in:codes},sku:{clientId}},select:{skuId:true}});
  if (!matches.length || matches.some((m:{skuId:string})=>m.skuId!==skuId)) throw new ConflictException('GTIN из КИЗ не соответствует однозначно выбранному товару.');
  const fields={clientId,skuId,boxId:boxId??null,status:'AVAILABLE'};
  const quantity = await tx.stockBalance.aggregate({where:{...fields,warehouseId,...(boxId?{}:{palletId:null})},_sum:{quantity:true}});
  const marked = await tx.productMark.count({where:{...fields,...(boxId?{}:{OR:[{stockMovement:{warehouseId}},{stockMovementId:null}]})}});
  if ((quantity._sum.quantity??0)<=marked) throw new ConflictException('В этом коробе нет доступной единицы товара без КИЗ.');
  const history=clientKizFilter(identity,'kiz');
  if (await tx.productMark.findFirst({where:clientKizFilter(identity),select:{id:true}}) ||
      await tx.shippedKizHistory.findFirst({where:history,select:{id:true}}) ||
      await tx.fboAssemblyUnit.findFirst({where:history,select:{id:true}}) ||
      await tx.fbsTsdAssembly.findFirst({where:history,select:{id:true}})) throw new ConflictException('Этот КИЗ уже зарегистрирован или использован в сборке.');
  if (boxId) return null;
  const movement = await tx.stockMovement.findFirst({where:{...fields,warehouseId,palletId:null,quantity:{gt:0}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}});
  if (!movement) throw new ConflictException('Отсутствует складское движение, подтверждающее источник без короба.');
  return movement.id as string;
}

export async function bindNewPickMark(tx:any,input:PickInput,requestId:string) {
  if (!palitraPickEnabled(input.clientId)) return null;
  const stockMovementId=await checkNewPickMark(tx,input);
  return tx.productMark.create({data:{clientId:input.clientId,skuId:input.skuId,boxId:input.boxId,value:input.kiz.trim(),
    stockMovementId,status:'AVAILABLE',sourceDocument:`PICK:${requestId}`},include:{box:true,sku:true}});
}
