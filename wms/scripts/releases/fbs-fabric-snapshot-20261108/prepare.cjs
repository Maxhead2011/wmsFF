// FIX: overlay only reviewed hunks on the verified published runtime.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const changes=[],proof=[];
function patch(file,pairs){let s=read(root+'/api-base/'+file),base=s;for(const [a,b] of pairs){assert.equal(s.split(a).length,2,'unique anchor '+file+' '+a.slice(0,70));s=s.replace(a,b)}let inverse=s;for(const[a,b]of [...pairs].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);write(root+'/api-payload/'+file,s);changes.push(file);proof.push({file,hunks:pairs.length})}
const m='modules/marketplace-connections/';
patch(m+'marketplace-connections.service.js',[
 ['fabricReservationOrders, untouchedFabricReservation }','fabricReservationOrders, untouchedFabricReservation, decorateFabricReservationResponse }'],
 ['    async syncFbsPalletSortReservations(', '    // FIX: decorate scoped saved snapshots as well as live responses.\n    async decorateFbsFabricDisplay(clientId, response) { return decorateFabricReservationResponse(this.prisma, clientId, response); }\n    async syncFbsPalletSortReservations(']
]);
patch(m+'marketplace-connections.controller.js',[[
 'return { ...result, ...(process.env.WMS_FBS_NO_STOCK_TRANSFER_ENABLED',
 'const display = await this.connections.decorateFbsFabricDisplay?.(clientId, result) ?? result;\n        return { ...display, ...(process.env.WMS_FBS_NO_STOCK_TRANSFER_ENABLED'
]]);
for(const name of [m+'fbs-fabric-reservation','modules/warehouse/fabric-fbs-availability']){
 const text=ts.transpileModule(read('apps/api/src/'+name+'.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 write(root+'/api-payload/'+name+'.js',text);changes.push(name+'.js');
}
const colors=['black|white|green|red|ivory','black|white|green|red|ivory|blue'];
patch('modules/warehouse/fabric-rolls.js',[colors,["ivory:'Айвори / шампань'","ivory:'Айвори / шампань',blue:'Синий'"]]);
patch('modules/warehouse/fabric-shipment-accounting.js',[colors]);
patch('modules/warehouse/fabric-roll-storage.js',[["ivory:'айвори'","ivory:'айвори',blue:'синий'"]]);
for(const file of changes)assert.equal(ts.createSourceFile(file,read(root+'/api-payload/'+file),99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
write(root+'/api-changes.json',JSON.stringify(changes));write(root+'/overlay-proof.json',JSON.stringify({proof,existingBytesPreserved:true,apiFiles:changes.length,webUnchanged:true}));
console.log('Prepared API'+changes.length+'; web unchanged; exact inverse hunk proof passed');
