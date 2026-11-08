// TEST: prove the browser guard rejects the regressions it protects against.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(process.argv[2]);fs.mkdirSync(root,{recursive:true});
const original=path.resolve(__dirname,'../apps/web/src');
for(const mutation of ['missing-import','single-column','missing-ozon-style']) {
 const source=path.join(root,mutation,'src');
 fs.cpSync(path.join(original,'components'),path.join(source,'components'),{recursive:true});
 fs.mkdirSync(path.join(source,'lib'),{recursive:true});
 fs.copyFileSync(path.join(original,'lib/marketplaceWorkspace.ts'),path.join(source,'lib/marketplaceWorkspace.ts'));
 const file=path.join(source,'components/layout',mutation==='missing-import'?'marketplace-surfaces.css':'compact-operational-controls.css');
 let css=fs.readFileSync(file,'utf8');
 if(mutation==='missing-import')css=css.replace("@import './compact-operational-controls.css';",'');
 if(mutation==='single-column')css=css.replaceAll('repeat(2,minmax(0,1fr))','1fr');
 if(mutation==='missing-ozon-style')css=css.replaceAll('FBO Ozon','BROKEN Ozon');
 fs.writeFileSync(file,css);
 const proof=path.join(root,mutation,'result','controls-check.json');
 fs.mkdirSync(path.dirname(proof),{recursive:true});fs.writeFileSync(proof,'{"passed":24}');
 const result=spawnSync(process.execPath,[path.join(__dirname,'check_compact_controls.cjs'),path.join(root,mutation,'result'),'--source'],{env:{...process.env,CONTROLS_SOURCE_ROOT:source},encoding:'utf8'});
 assert.equal(result.status,1,mutation+' must be rejected');
 assert.match(result.stderr,/AssertionError/,mutation+' must fail a visual assertion, not infrastructure');
 assert(!fs.existsSync(proof),'failed check must remove stale success proof');
 console.log('PASS rejects',mutation);
}
