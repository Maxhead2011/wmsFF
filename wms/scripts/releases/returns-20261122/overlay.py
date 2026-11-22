from pathlib import Path
import re, shutil, json, hashlib, sys
root=Path(__file__).resolve().parents[3]
work=Path(sys.argv[1])
candidate=work/'candidate2'
def replace(path, old, new):
 s=path.read_text(encoding='utf-8');assert s.count(old)==1,(str(path),old,s.count(old));path.write_text(s.replace(old,new),encoding='utf-8')
replace(candidate/'app.module.js','imports: [','imports: [require("./modules/returns/returns.module").ReturnsModule,')
p=candidate/'modules/stock/storage-overview.service.js'
needle='const relevantMovementWhere = storageRelevantMovementWhere(query.clientId);'
replace(p,needle,needle+'''\n        const returnBoxes = process.env.WMS_RETURNS_PROCESSING_ENABLED === 'true'
            ? await this.prisma.returnUnit.findMany({where:{clientId:query.clientId,receivedAt:{not:null}},select:{boxId:true},distinct:['boxId']}) : [];
''')
needle='status: { in: [client_1.StockStatus.AVAILABLE, client_1.StockStatus.PACKING, client_1.StockStatus.SHIPPING] },'
replace(p,needle,"...(returnBoxes.length ? {OR:[{"+needle+"},{status:client_1.StockStatus.QUARANTINE,boxId:{in:returnBoxes.map(b=>b.boxId)}}]} : {"+needle+"}),")
p=candidate/'modules/administration/administration-internal-api.service.js'
replace(p,"prefixes: ['/stock'],","prefixes: ['/stock', '/returns'],")
replace(p,'routeCount: 24, // FIX: include the client stock export audit route.','routeCount: 29, // FIX: return processing routes.')
for name in ['returns.service','returns.module','returns.controller','returns.dto','returns-policy']:
 src=root/'apps/api/dist/modules/returns'/f'{name}.js';dst=candidate/'modules/returns'/src.name;dst.parent.mkdir(exist_ok=True);shutil.copyfile(src,dst)
manifest=json.loads((work/'baseline/manifest.json').read_text(encoding='utf-8'))
files=manifest['artifacts']['api-runtime.tar.gz']['files']
changed=[p.relative_to(candidate).as_posix() for p in candidate.rglob('*') if p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()!=files.get(p.relative_to(candidate).as_posix())]
(work/'allowed.json').write_text(json.dumps(changed,indent=2))
schema=(work/'prisma/schema.prisma').read_text(encoding='utf-8')
source=(root/'apps/api/prisma/schema.prisma').read_text(encoding='utf-8')
for model,fields in {
 'Client':'  returnBatches ReturnBatch[]\n  returnUnits ReturnUnit[]\n',
 'Warehouse':'  returnBatches ReturnBatch[]\n',
 'User':'  returnBatchesCreated ReturnBatch[] @relation("ReturnBatchCreator")\n  returnBatchesCompleted ReturnBatch[] @relation("ReturnBatchCompleter")\n  returnUnitsScanned ReturnUnit[]\n',
 'Sku':'  returnUnits ReturnUnit[]\n', 'Box':'  returnUnits ReturnUnit[]\n'
}.items():
 assert schema.count('model '+model+' {')==1
 schema=schema.replace('model '+model+' {','model '+model+' {\n'+fields,1)
schema+='\n'+source[source.index('// FIX: physically inspected marketplace returns'):]
(work/'schema.prisma').write_text(schema,encoding='utf-8')
print(changed)
