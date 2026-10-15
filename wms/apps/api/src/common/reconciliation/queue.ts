import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

export type ReconciliationJob = {
  clientId: string; requestId: string; warehouseId: string | null; entityId: string;
  cause: 'PRINT_CONFIRMED' | 'DONE_PACKING' | 'SHIPMENT_CONFIRMED';
  label: string; evidence: unknown; run: () => Promise<unknown>;
};
type Database = { $queryRaw<T = unknown>(sql: Prisma.Sql): Promise<T>; $executeRaw(sql: Prisma.Sql): Promise<number> };
export function version(value: unknown): string {
  const canonical = (v: any): any => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : typeof v === 'bigint' ? v.toString() : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export const jobKey = (j: Pick<ReconciliationJob,'clientId'|'entityId'|'cause'>) => version([j.clientId,j.entityId,j.cause]);
export function reasonCode(error: unknown) {
  const text = error instanceof Error ? error.message : '';
  if (text.includes('Не определена заявка или филиал')) return 'MISSING_WAREHOUSE';
  if (text.includes('физическое списание')) return 'MISSING_PHYSICAL_EVIDENCE';
  if (text.includes('Недостаточно') || text.includes('недостаточно')) return 'PACKING_SHORTAGE';
  return 'REVIEW_REQUIRED';
}
export const retryDelay = (attempts: number) => Math.min(6*60*60_000, 5*60_000 * 2 ** Math.min(7,Math.max(0,attempts-1)));

// FIX: durable scheduling only. The existing stock service still owns all physical checks.
export async function runReconciliationJobs(db: Database, jobs: ReconciliationJob[], limit = 50) {
  if (!jobs.length) return {attempted:0,failed:0};
  const byKey = new Map(jobs.map(j=>[jobKey(j),j]));
  const rows = [...byKey].map(([key,j])=>({key,clientId:j.clientId,requestId:j.requestId,warehouseId:j.warehouseId,entityId:j.entityId,cause:j.cause,label:j.label,version:version(j.evidence)}));
  for(let offset=0;offset<rows.length;offset+=500) {
    const json = JSON.stringify(rows.slice(offset,offset+500));
    await db.$executeRaw(Prisma.sql`INSERT INTO "WmsReconciliationCase" ("key","clientId","requestId","warehouseId","entityId","cause","label","evidenceVersion")
      SELECT x.key,x."clientId",x."requestId",x."warehouseId",x."entityId",x.cause,x.label,x.version
      FROM jsonb_to_recordset(${json}::jsonb) AS x(key text,"clientId" text,"requestId" text,"warehouseId" text,"entityId" text,cause text,label text,version text)
      ON CONFLICT ("key") DO UPDATE SET "evidenceVersion"=EXCLUDED."evidenceVersion", "nextAttemptAt"=NOW(), "attempts"=0,
        "requestId"=EXCLUDED."requestId", "warehouseId"=EXCLUDED."warehouseId", "label"=EXCLUDED."label", "resolvedAt"=NULL, "updatedAt"=NOW()
      WHERE "WmsReconciliationCase"."evidenceVersion"<>EXCLUDED."evidenceVersion"
        AND ("WmsReconciliationCase"."leaseUntil" IS NULL OR "WmsReconciliationCase"."leaseUntil"<NOW())`);
  }
  const ids=[...byKey.keys()];
  const due=await db.$queryRaw<Array<{key:string;evidenceVersion:string}>>(Prisma.sql`SELECT "key","evidenceVersion" FROM "WmsReconciliationCase"
    WHERE "key" IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)) AND "nextAttemptAt"<=NOW() AND ("leaseUntil" IS NULL OR "leaseUntil"<NOW())
    ORDER BY "lastAttemptAt" ASC NULLS FIRST,"createdAt","key" LIMIT ${Math.min(100,Math.max(1,limit))}`);
  let attempted=0,failed=0;
  for(const row of due) {
    const job=byKey.get(row.key)!;
    if(version(job.evidence)!==row.evidenceVersion) continue;
    const token=randomUUID();
    const claim=await db.$queryRaw<Array<{attempts:number}>>(Prisma.sql`UPDATE "WmsReconciliationCase" SET "leaseToken"=${token},"leaseUntil"=NOW()+INTERVAL '5 minutes',
      "attempts"="attempts"+1,"lastAttemptAt"=NOW(),"updatedAt"=NOW()
      WHERE "key"=${row.key} AND "evidenceVersion"=${row.evidenceVersion} AND "nextAttemptAt"<=NOW()
        AND ("leaseUntil" IS NULL OR "leaseUntil"<NOW()) RETURNING "attempts"`);
    if(!claim.length)continue;
    attempted++;
    let reason:string|null=null;
    try { await job.run(); } catch(error) { reason=reasonCode(error);failed++; }
    const delay=reason ? retryDelay(claim[0].attempts) : 6*60*60_000;
    await db.$executeRaw(Prisma.sql`UPDATE "WmsReconciliationCase" SET "leaseToken"=NULL,"leaseUntil"=NULL,"reasonCode"=${reason},
      "resolvedAt"=CASE WHEN ${reason}::text IS NULL THEN NOW() ELSE NULL END,"nextAttemptAt"=NOW()+${delay}*INTERVAL '1 millisecond',"updatedAt"=NOW()
      WHERE "key"=${row.key} AND "leaseToken"=${token}`);
  }
  return {attempted,failed};
}
