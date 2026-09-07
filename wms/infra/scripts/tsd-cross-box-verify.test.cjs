// TEST: release comparison must stop new failures and any unrelated artifact replacement.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cross-box-gate-'));
 const a='a'.repeat(64),b='b'.repeat(64),lines=[];
 for(const m of ['stock-operations.service','tsd-transfer-kiz-recount','tsd-admin-box-recount'])for(const [d,e]of[['src','ts'],['dist','js']])lines.push(`/app/apps/api/${d}/modules/stock/${m}.${e}`);
 const report={numPassedTests:10,numFailedTests:0,testResults:[{name:'suite',status:'passed',assertionResults:[{fullName:'test',status:'passed'}]}]};
 fs.writeFileSync(path.join(dir,'full-baseline.json'),JSON.stringify(report));fs.writeFileSync(path.join(dir,'full-candidate.json'),JSON.stringify(report));
 fs.writeFileSync(path.join(dir,'api-before.sha256'),lines.slice(0,4).map(p=>a+'  '+p).join('\n'));
 fs.writeFileSync(path.join(dir,'api-candidate.sha256'),lines.map(p=>b+'  '+p).join('\n'));
 fs.writeFileSync(path.join(dir,'web-before.sha256'),a+'  /usr/share/nginx/html/index.html');
 fs.writeFileSync(path.join(dir,'web-candidate.sha256'),a+'  /usr/share/nginx/html/index.html\n'+b+'  /usr/share/nginx/html/downloads/logoff-tsd-admin-box-count-158.apk');
 fs.writeFileSync(path.join(dir,'apk.sha256'),b);
 return {dir,run:()=>spawnSync(process.execPath,[path.join(__dirname,'tsd-cross-box-verify.cjs'),dir],{encoding:'utf8'}),cleanup:()=>fs.rmSync(dir,{recursive:true})};
}
test('accepts only reviewed patch and additive APK',()=>{const f=fixture();try{const r=f.run();assert.equal(r.status,0,r.stderr)}finally{f.cleanup()}});
test('rejects newly failing tests',()=>{const f=fixture();try{fs.writeFileSync(path.join(f.dir,'full-candidate.json'),JSON.stringify({numPassedTests:10,numFailedTests:1,testResults:[{name:'suite',status:'failed',assertionResults:[]}]}));assert.notEqual(f.run().status,0)}finally{f.cleanup()}});
test('rejects changed existing web files and bad APK digest',()=>{for(const file of ['web-candidate.sha256','apk.sha256']){const f=fixture();try{fs.appendFileSync(path.join(f.dir,file),'bad');assert.notEqual(f.run().status,0)}finally{f.cleanup()}}});
test('rejects a seventh changed API module',()=>{const f=fixture();try{fs.appendFileSync(path.join(f.dir,'api-candidate.sha256'),'\n'+'c'.repeat(64)+'  /app/apps/api/dist/other.js');assert.notEqual(f.run().status,0)}finally{f.cleanup()}});
