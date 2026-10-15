const {PrismaClient}=require('@prisma/client'),fs=require('fs'),assert=require('assert/strict');const db=new PrismaClient();
(async()=>{await db.$transaction(async tx=>{
 await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(20261015,230000)");
 const exists=await tx.$queryRawUnsafe("SELECT to_regclass('\"WmsReconciliationCase\"')::text AS name");assert.equal(exists[0].name,null,'Queue table already exists; inspect migration state before retrying');
 const sql=fs.readFileSync('/app/apps/api/prisma/migrations/20261015230000_reconciliation_queue/migration.sql','utf8');
 for(const statement of sql.replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()))await tx.$executeRawUnsafe(statement);
 });console.log('Additive queue schema applied');})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
