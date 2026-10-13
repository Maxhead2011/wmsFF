import type {Prisma} from '@prisma/client';

// FIX: warehouse-only capability. Never change cabinet or marketplace stock visibility.
export async function confirmedUnplacedFboBoxes(db:Prisma.TransactionClient,
 request:{clientId:string;warehouseId:string|null},boxIds:string[]):Promise<Set<string>>{
 if(process.env.WMS_FBO_UNPLACED_PICKING_ENABLED!=='true'||!request.warehouseId||!boxIds.length)return new Set();
 // Committed receipt movement proves physical acceptance; current availability and receipt
 // approval/channel restrictions are still checked by loadFboFbsAvailability before picking.
 const receipts=await db.stockMovement.findMany({where:{clientId:request.clientId,warehouseId:request.warehouseId,
  boxId:{in:[...new Set(boxIds)]},type:'RECEIPT',status:'AVAILABLE',quantity:{gt:0}},distinct:['boxId'],select:{boxId:true}});
 return new Set(receipts.flatMap(r=>r.boxId?[r.boxId]:[]));
}
