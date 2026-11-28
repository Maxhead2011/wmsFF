// FIX: preserve the deployed service; add only the paired recovery branch.
const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'../../..'),w=path.resolve(process.argv[2]);
const ts=require(path.join(root,'node_modules/typescript')),dir='modules/warehouse';
const out=path.join(w,'api-payload',dir);fs.mkdirSync(out,{recursive:true});
const name='storage-locations.service.js';let service=fs.readFileSync(path.join(w,'base-api',dir,name),'utf8');
const start=service.indexOf('async restoreTsdPalletBox('),anchor='        const items = this.parseRestoreItems(body.items);',at=service.indexOf(anchor,start);
if(start<0||at<0)throw Error('Published method drift');
const branch=`        // FIX: own-WMS unique physical pairs; legacy sold behavior remains unchanged.
        const pairs = require('./pallet-recovery-pairs');
        if (pairs.palletRecoveryPairsEnabled()) {
            const result = await pairs.restorePairedPalletBox(this.prisma,pallet,boxCode,idempotencyKey,body.items,user,this.balances);
            await this.placeBox(pallet,result.box.code,'TSD',user);
            return this.tsdPalletResponse(pallet.id,'Короб '+boxCode+' восстановлен по парам ШК + КИЗ: '+result.quantity+' шт.',result.alreadyApplied);
        }
`;
service=service.slice(0,at)+branch+service.slice(at);fs.writeFileSync(path.join(out,name),service);
fs.writeFileSync(path.join(out,'pallet-recovery-pairs.js'),ts.transpileModule(fs.readFileSync(path.join(root,'apps/api/src',dir,'pallet-recovery-pairs.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
for(const n of fs.readdirSync(out))fs.copyFileSync(path.join(out,n),path.join(w,'base-api',dir,n));console.log('Prepared exact recovery delta');
