import {ConflictException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {clientKizPrefixes} from './kiz-client-registry';

// FIX: exclusive UTF-8 prefix bound for PostgreSQL text_pattern_ops, without LIKE wildcards.
export function prefixEnd(prefix:string):string {
 const points=Array.from(prefix);
 while(points.length){const last=points.pop()!.codePointAt(0)!;
  if(last<0x10ffff)return points.join('')+String.fromCodePoint(last===0xd7ff?0xe000:last+1);
 }
 throw new Error('Unbounded KIZ prefix');
}
type Kind='marks'|'shipments'|'history'|'tasks'|'bindings';
export async function shipmentPrefixIds(tx:any,request:any,keys:string[],kind:Kind,take:number):Promise<string[]> {
 const prefixes=[...new Set(keys.flatMap(clientKizPrefixes))];
 if(!prefixes.length)return [];
 // Table/column fragments are static; all client data remains parameterized.
 const table=Prisma.raw({marks:'"ProductMark"',shipments:'"ShippedKizHistory"',history:'"FboAssemblyUnit"',tasks:'"FbsTsdAssembly"',bindings:'"FboAssemblyUnit"'}[kind]);
 const col=Prisma.raw(kind==='marks'?'m."value"':'m."kiz"');
 const scope=kind==='history'||kind==='bindings'
  ? Prisma.sql`EXISTS (SELECT 1 FROM "ClientRequest" r WHERE r.id=m."requestId" AND r."clientId"=${request.clientId} ${kind==='history'?Prisma.sql`AND r.status='DONE'`:Prisma.empty})`
  : Prisma.sql`m."clientId"=${request.clientId}`;
 const extra=kind==='history'?Prisma.sql`AND m.state <> 'RETURNED'`
  :kind==='bindings'?Prisma.sql`AND m."requestId" <> ${request.id} AND m."activeMarkId" IS NOT NULL`
  :kind==='tasks'?Prisma.sql`AND m.status IN ('IN_PROGRESS','COMPLETED','RETURN_REQUIRED')`:Prisma.empty;
 // LATERAL keeps each prefix an indexed range rather than a hundreds-term OR filter.
 const rows: {id:string}[]=await tx.$queryRaw(Prisma.sql`
  SELECT DISTINCT hit.id FROM unnest(${prefixes}::text[],${prefixes.map(prefixEnd)}::text[]) p(lo,hi)
  CROSS JOIN LATERAL (SELECT m.id FROM ${table} m
   WHERE ${col} ~>=~ p.lo AND ${col} ~<~ p.hi AND ${scope} ${extra} LIMIT ${take}) hit
  LIMIT ${take}`);
 if(rows.length>=take)throw new ConflictException('Слишком много записей истории КИЗ. Требуется разбор администратором.');
 return rows.map(row=>row.id);
}
