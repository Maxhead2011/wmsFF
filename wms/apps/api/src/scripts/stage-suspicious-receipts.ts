import {PrismaClient} from '@prisma/client';
import {holdLegacyBarcode} from '../modules/tsd/receipt-barcode-legacy';

// FIX: explicit, audited import of the four reported receipt mistakes. Dry-run rolls back.
const targets = [
  {boxCode:'FFL_LKB0610_038', barcode:'18'},
  {boxCode:'FFL_LKB0610_132', barcode:'18'},
  {boxCode:'FFL_LKB0610_235', barcode:'7459'},
  {boxCode:'FFL_LKB0610_315', barcode:'08123282'},
];
async function main(){
  const [clientId,warehouseId,actorId,mode]=process.argv.slice(2);
  if(!clientId||!warehouseId||!actorId||!['--dry-run','--apply'].includes(mode)) throw new Error('Usage: stage-suspicious-receipts <clientId> <warehouseId> <ownerId> --dry-run|--apply');
  if(process.env.WMS_RECEIPT_BARCODE_REVIEW_ENABLED!=='true') throw new Error('Deploy and enable barcode review before staging receipts.');
  const prisma=new PrismaClient();
  const results:unknown[]=[];
  const rollback=new Error('DRY_RUN_ROLLBACK');
  try {
    const actor=await prisma.user.findUnique({where:{id:actorId},include:{roles:{include:{role:true}}}});
    if(!actor||actor.status!=='ACTIVE'||actor.isDemo||!actor.roles.some(r=>r.role.code==='OWNER')) throw new Error('An active non-demo OWNER is required.');
    try {
      await prisma.$transaction(async tx=>{
        for(const target of targets){
          const matches=await tx.tsdOperation.findMany({where:{operationType:'receipt_scan',status:'ACCEPTED',
            createdAt:{gte:new Date('2026-10-06T21:00:00Z'),lt:new Date('2026-10-07T21:00:00Z')},AND:[
              {payload:{path:['clientId'],equals:clientId}},
              {payload:{path:['boxCode'],equals:target.boxCode}},
              {payload:{path:['barcode'],equals:target.barcode}},
            ]}});
          if(matches.length!==1||Number((matches[0].payload as any).quantity)!==1) throw new Error(`Expected exactly one original unit: ${target.boxCode}`);
          const issue=await holdLegacyBarcode(tx,matches[0].id,warehouseId,actorId);
          results.push({...target,originalOperationId:matches[0].id,reviewId:issue.id});
        }
        if(mode==='--dry-run')throw rollback;
      },{isolationLevel:'Serializable',timeout:30000});
    } catch(error){if(error!==rollback)throw error;}
    process.stdout.write(JSON.stringify({mode,committed:mode==='--apply',results},null,2)+'\n');
  }finally{await prisma.$disconnect();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Staging failed');process.exitCode=1;});
