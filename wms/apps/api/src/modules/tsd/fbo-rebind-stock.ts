// FIX: a physical recount may already include a mark whose old box link is stale.
// Reconcile the old ledger, but do not add a second unit over unmarked target stock.
export async function reuseCountedFboStock(tx:any,r:any,skuId:string,boxId:string,source:any,physicalBalance:any):Promise<boolean>{
 if(process.env.WMS_KIZ_CLIENT_GUARD_ENABLED!=='true'||!source||!physicalBalance||
   (source.boxId===boxId&&source.status==='AVAILABLE'))return false;
 const where={clientId:r.clientId,warehouseId:r.warehouseId,skuId,boxId,status:'AVAILABLE'};
 const quantity=(await tx.stockBalance.aggregate({where,_sum:{quantity:true}}))._sum.quantity??0;
 const marked=await tx.productMark.count({where:{clientId:r.clientId,skuId,boxId,status:'AVAILABLE'}});
 return quantity>0&&quantity>marked;
}
