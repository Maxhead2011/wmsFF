// Read-only timing summary. Never print operators, order IDs, KIZs or request bodies.
const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
(async()=>{
 const since=process.env.SINCE?new Date(process.env.SINCE):new Date(Date.now()-2*3600000);
 const rows=await db.$queryRaw`WITH samples AS (
   SELECT CASE WHEN payload#>>'{request,path}' LIKE '%/fbo%' THEN 'FBO' ELSE 'FBS' END AS flow,
     COALESCE(payload#>>'{request,body,action}',regexp_replace(payload#>>'{request,path}','^.*/','')) AS step,
     (payload#>>'{result,durationMs}')::numeric AS ms,
     payload#>>'{result,ok}'='true' AS ok
   FROM "TsdOperation" WHERE "operationType"='tsd_api_action' AND "createdAt">=${since}
     AND (payload#>>'{request,path}' LIKE '%/fbo%' OR payload#>>'{request,path}' LIKE '%/fbs%')
     AND payload#>>'{result,durationMs}' ~ '^[0-9]+$'
 ) SELECT flow,step,COUNT(*)::int AS samples,COUNT(*) FILTER(WHERE NOT ok)::int AS errors,
   ROUND(AVG(ms))::int AS "meanMs",percentile_cont(0.5) WITHIN GROUP(ORDER BY ms) AS "medianMs",
   percentile_cont(0.95) WITHIN GROUP(ORDER BY ms) AS "p95Ms"
 FROM samples GROUP BY flow,step ORDER BY flow,step`;
 console.log(JSON.stringify({since:since.toISOString(),readOnly:true,rows}));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1});
