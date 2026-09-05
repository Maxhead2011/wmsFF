import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFbsAttemptHistory } from '../../common/shipment-history/fbs-attempt-history';

export type FbsPickedProof = { itemId: string; skuId: string; boxId: string | null; palletId: string | null; warehouseId: string; quantity: number; movementIds: string[] };
type Request = { id: string; clientId: string; items: Array<{id:string;skuId:string|null;quantity:number}> };

// FIX: net exact-task physical deductions against returns; status COMPLETED alone is not stock evidence.
export async function readFbsPickedStockProof(tx: Prisma.TransactionClient, request: Request, warehouseId?: string): Promise<FbsPickedProof[]> {
  if (!('fbsTsdAssembly' in tx)) return [];
  const live = await tx.fbsTsdAssembly.findMany({ where: {requestId:request.id,clientId:request.clientId,status:'COMPLETED'},
    select:{id:true,requestId:true,requestItemId:true,clientId:true,skuId:true,boxId:true,status:true,itemCount:true} });
  const tasks = new Map(live.filter(t=>t.id && t.status==='COMPLETED' && t.clientId===request.clientId).map(t=>[t.id,t]));
  for (const {task} of await readFbsAttemptHistory(tx,{requestId:request.id})) {
    if(task.clientId===request.clientId && task.status==='COMPLETED') tasks.set(task.id,task);
  }
  if (!tasks.size) return [];
  if (!warehouseId) throw new BadRequestException('Для проверки фактического отбора нужен филиал заявки.');
  const result:FbsPickedProof[]=[];
  const itemRemaining=new Map(request.items.map(i=>[i.id,i.quantity]));
  const taskList=[...tasks.values()];
  for(let offset=0;offset<taskList.length;offset+=100) {
    const batch=taskList.slice(offset,offset+100);
    const movements=await tx.stockMovement.findMany({where:{clientId:request.clientId,warehouseId,status:'AVAILABLE',
      OR:batch.map(t=>({idempotencyKey:{startsWith:`fbs-sticker-pick:${t.id}:`}}))},
      select:{id:true,clientId:true,warehouseId:true,skuId:true,boxId:true,palletId:true,status:true,quantity:true,idempotencyKey:true},
      orderBy:[{createdAt:'asc'},{id:'asc'}]});
    for(const task of batch) {
      const item=request.items.find(i=>i.id===task.requestItemId && i.skuId===task.skuId);
      if(!item) continue;
      const rows=movements.filter(m=>m.clientId===request.clientId && m.warehouseId===warehouseId && m.skuId===task.skuId &&
        m.status==='AVAILABLE' && m.idempotencyKey?.startsWith(`fbs-sticker-pick:${task.id}:`));
      // FIX: cancel the oldest physical pick even if its return entered a new box.
      const outstanding:Array<{row:(typeof rows)[number];quantity:number}>=[];
      for(const row of rows) {
        if(row.quantity<0) outstanding.push({row,quantity:-row.quantity});
        else {
          let returned=row.quantity;
          for(const picked of outstanding) {
            const cancelled=Math.min(returned,picked.quantity);
            picked.quantity-=cancelled;returned-=cancelled;
            if(!returned) break;
          }
        }
      }
      const groups=new Map<string,typeof outstanding>();
      for(const picked of outstanding){const key=JSON.stringify([picked.row.boxId,picked.row.palletId]);groups.set(key,[...(groups.get(key)??[]),picked]);}
      let taskRemaining=Math.max(1,task.itemCount);
      for(const group of groups.values()) {
        const net=group.reduce((sum,picked)=>sum+picked.quantity,0);
        const quantity=Math.min(net,taskRemaining,itemRemaining.get(item.id)??0);
        if(quantity<=0) continue;
        result.push({itemId:item.id,skuId:item.skuId!,boxId:group[0].row.boxId,palletId:group[0].row.palletId,warehouseId,quantity,movementIds:rows.map(m=>m.id)});
        taskRemaining-=quantity;itemRemaining.set(item.id,(itemRemaining.get(item.id)??0)-quantity);
      }
    }
  }
  return result;
}

// FIX: first remove a picked unit from its own saved source, then any obsolete selection for that item.
export function subtractPickedQuantities<T extends {requestItemId:string;quantity:number;boxId?:string|null}>(rows:T[], picked:Array<{itemId:string;quantity:number;boxId:string|null}>):T[] {
  const result=rows.map(row=>({...row}));
  for(const proof of picked){
    let remaining=proof.quantity;
    const candidates=result.filter(r=>r.requestItemId===proof.itemId).sort((a,b)=>Number(b.boxId===proof.boxId)-Number(a.boxId===proof.boxId));
    for(const row of candidates){const used=Math.min(remaining,row.quantity);row.quantity-=used;remaining-=used;if(!remaining)break;}
  }
  return result.filter(r=>r.quantity>0);
}
