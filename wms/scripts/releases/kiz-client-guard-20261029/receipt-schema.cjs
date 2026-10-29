// FIX: additive, restartable deployment; concurrent indexes never hold a transaction across live writes.
const fs=require('node:fs'),{PrismaClient}=require('@prisma/client');
const migration=process.argv.find(v=>v.startsWith('--migration='))?.slice(12);
const apply=process.argv.includes('--apply');
if(!migration)throw new Error('--migration=/absolute/path/migration.sql required');
const sql=fs.readFileSync(migration,'utf8').replace(/^--.*$/gm,'');
const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
const p=new PrismaClient();
const fields={clientId:['text',true],identity:['text',true],firstReceivedAt:['timestamp with time zone',false],
 firstBoxCode:['text',false],firstWarehouseId:['text',false],productName:['text',false],barcode:['text',false],
 skuId:['text',false],operationKey:['text',false],sourceDocument:['text',false],userId:['text',false],
 source:['text',true],createdAt:['timestamp with time zone',true]};
const normalize=s=>s.toLowerCase().replace(/"/g,'').replace(/public\./g,'').replace(/\s+/g,' ').trim();
async function tableCheck(){
 const rows=await p.$queryRawUnsafe(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull FROM pg_attribute a WHERE a.attrelid=to_regclass('"KizClientRegistry"') AND a.attnum>0 AND NOT a.attisdropped`);
 if(!rows.length)return false;
 for(const [name,[type,required]] of Object.entries(fields)){
  const r=rows.find(r=>r.attname===name);
  const equivalent=r&&(r.type===type||type==='timestamp with time zone'&&/^timestamp\(6\) with time zone$/.test(r.type));
  if(!equivalent||r.attnotnull!==required)throw new Error('Registry schema mismatch: '+name);
 }
 const pk=await p.$queryRawUnsafe(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='"KizClientRegistry"'::regclass AND contype='p'`);
 if(pk.length!==1||normalize(pk[0].definition)!=='primary key (clientid, identity)')throw new Error('Registry primary key mismatch');
 return true;
}
async function indexCheck(name,table,statement){
 const rows=await p.$queryRawUnsafe(`SELECT i.indisvalid,i.indisready,t.relname AS table_name,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid WHERE x.oid=to_regclass($1)`, '"'+name+'"');
 if(!rows.length)return false;
 const r=rows[0];if(!r.indisvalid||!r.indisready||r.table_name!==table)throw new Error('Existing index needs inspection: '+name);
 // pg_get_indexdef inserts casts and parentheses; check fields/operator classes and predicate separately.
 const expected=normalize(statement),actual=normalize(r.definition);
 for(const token of ['clientId','kiz','value','payload','text_pattern_ops','receipt_scan','ACCEPTED'].filter(x=>expected.includes(x.toLowerCase())))
  if(!actual.includes(token.toLowerCase()))throw new Error('Index definition mismatch: '+name+' / '+token);
 return true;
}
(async()=>{
 const result={apply,table:false,indexes:[]};
 result.table=await tableCheck();
 if(!result.table&&apply){await p.$executeRawUnsafe(statements[0].replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS '));result.table=await tableCheck();}
 for(const statement of statements.slice(1)){
  const m=/^CREATE INDEX "([^"]+)" ON "([^"]+)"/.exec(statement);if(!m)throw new Error('Unexpected migration statement');
  let valid=await indexCheck(m[1],m[2],statement);
  if(!valid&&apply){await p.$executeRawUnsafe(statement.replace('CREATE INDEX ','CREATE INDEX CONCURRENTLY IF NOT EXISTS '));valid=await indexCheck(m[1],m[2],statement);}
  result.indexes.push({name:m[1],valid});
 }
 if(apply&&(!result.table||result.indexes.some(x=>!x.valid)))throw new Error('Incomplete schema apply');
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());
