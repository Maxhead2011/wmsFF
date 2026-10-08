import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { ReceiptRule } from './receipt-channel-policy';

type Db = Prisma.TransactionClient;
export type ReceiptStockIdentity = { id:string;code:string;clientId:string;warehouseId:string|null;status:string;indexed:boolean;receiptAt:Date|null;movementAt:Date|null };
type Setting = { key:string;value:any };
export const receiptStockIndexEnabled = () => process.env.WMS_RECEIPT_STOCK_INDEX_ENABLED === 'true';
const series = (code:string,at:Date) => `SERIES:${at.getUTCFullYear()}:${code.replace(/_[0-9]+$/, '')}`;
const receiptId = (client:string,warehouse:string,document:string) => createHash('sha256').update(JSON.stringify([client,warehouse,document])).digest('hex').slice(0,32);

// FIX: quantities remain in StockBalance; only stable receipt evidence is materialized.
// Approval and membership are read fresh, so revoke/assign needs no delayed cache invalidation.
export function indexedReceiptState(boxes:ReceiptStockIdentity[],settings:Setting[],scopes:Setting[],channels:boolean) {
  if(boxes.some(b=>!b.indexed))throw new ConflictException('Индекс доступности товара не готов. Повторите после восстановления индекса.');
  const byKey=new Map(settings.map(s=>[s.key,s.value]));
  const rules=new Map<string,ReceiptRule>(),pending:string[]=[];
  if(channels){
    for(const s of settings){
      if(!s.key.startsWith('receipt.channels.v1:'))continue;
      const rule=s.value as ReceiptRule,match=/^SERIES:(\d{4}):(.+)$/.exec(rule.sourceDocument);
      if(!match)continue;
      for(const box of boxes){
        if(box.clientId!==rule.clientId||box.warehouseId!==rule.warehouseId||['deleted','archived'].includes(box.status))continue;
        if(box.code!==match[2]&&!box.code.startsWith(match[2]+'_'))continue;
        if(series(box.code,box.movementAt??new Date(`${match[1]}-01-01T00:00:00Z`))===rule.sourceDocument)rules.set(box.id,rule);
      }
    }
    for(const box of boxes){
      const a=byKey.get(`receipt.membership.v1:${box.clientId}:${box.id}`);
      if(!a||a.clientId!==box.clientId||a.warehouseId!==box.warehouseId)continue;
      rules.delete(box.id);
      const policy=settings.find(s=>s.key.startsWith(`receipt.channels.v1:${box.clientId}:`)&&s.value.clientId===box.clientId&&s.value.warehouseId===a.warehouseId&&s.value.sourceDocument===a.series)?.value;
      if(policy)rules.set(box.id,policy);
    }
  }
  for(const box of boxes){
    if(!box.receiptAt||!box.warehouseId)continue;
    const scope=scopes.find(s=>s.value.clientId===box.clientId&&s.value.warehouseId===box.warehouseId)?.value;
    if(!scope)continue;
    const assignment=byKey.get(`receipt.membership.v1:${box.clientId}:${box.id}`);
    const sourceDocument=assignment?.clientId===box.clientId&&assignment?.warehouseId===box.warehouseId?assignment.series:series(box.code,box.receiptAt);
    const id=receiptId(box.clientId,box.warehouseId,sourceDocument);
    const saved=byKey.get(`receipt.approval.v1:${box.clientId}:${box.warehouseId}:${id}`);
    const available=saved?saved.available:scope.grandfatheredReceiptIds.includes(id);
    if(!available){
      pending.push(box.id);
      rules.set(box.id,{id,clientId:box.clientId,warehouseId:box.warehouseId,sourceDocument,fbs:true,fbo:true,protectedOrders:[],changedAt:'',revision:0,...rules.get(box.id),stockAvailable:false});
    }
  }
  return {rules,pending};
}

export async function readIndexedReceiptState(db:Db,clientId:string,warehouseId?:string|null,boxIds?:string[],channels=true) {
  if(boxIds&&!boxIds.length)return {rules:new Map<string,ReceiptRule>(),pending:[] as string[]};
  const scopePrefix=`receipt.approval.scope.v1:${clientId}:`;
  // FIX: read values under the same shared locks as pick transactions, after any writer commits.
  const scopes=process.env.WMS_RECEIPT_APPROVAL_ENABLED==='true'?await db.$queryRaw<Setting[]>(Prisma.sql`
    SELECT key,value FROM "SystemSetting"
    WHERE starts_with(key,${scopePrefix}) AND value->>'clientId'=${clientId}
      ${warehouseId?Prisma.sql`AND value->>'warehouseId'=${warehouseId}`:Prisma.empty}
    ORDER BY key FOR SHARE`):[];
  if(!channels&&!scopes.length)return {rules:new Map<string,ReceiptRule>(),pending:[] as string[]};
  const [boxes,settings]=await Promise.all([
    db.$queryRaw<ReceiptStockIdentity[]>(Prisma.sql`
      SELECT b.id,b.code,b."clientId",b."warehouseId",b.status,
        (i."boxId" IS NOT NULL) AS indexed,i."receiptAt",i."movementAt"
      FROM "Box" b LEFT JOIN "ReceiptStockIdentity" i ON i."boxId"=b.id
      WHERE b."clientId"=${clientId}
        ${warehouseId?Prisma.sql`AND b."warehouseId"=${warehouseId}`:Prisma.empty}
        ${boxIds?Prisma.sql`AND b.id IN (${Prisma.join(boxIds)})`:Prisma.empty}`),
    db.systemSetting.findMany({where:{OR:[
      ...(channels?[{key:{startsWith:`receipt.channels.v1:${clientId}:`}}]:[]),
      {key:{startsWith:`receipt.membership.v1:${clientId}:`}},
      ...(scopes.length?[{key:{startsWith:`receipt.approval.v1:${clientId}:`}}]:[]),
    ]},select:{key:true,value:true}}),
  ]);
  return indexedReceiptState(boxes,settings,scopes,channels);
}
