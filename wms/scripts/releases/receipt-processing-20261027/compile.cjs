const fs=require('fs'),cp=require('child_process'),path=require('path'),ts=require('../../../node_modules/typescript');
const root=process.argv[2],repo=path.resolve(__dirname,'../../../..'),src=repo+'/wms/apps/api/src';
const config=ts.readConfigFile(repo+'/wms/apps/api/tsconfig.json',ts.sys.readFile).config;
const opts=ts.parseJsonConfigFileContent(config,ts.sys,repo+'/wms/apps/api').options;
const changed=cp.execFileSync('git',['diff','--name-only','--','wms/apps/api/src'],{cwd:repo,encoding:'utf8',maxBuffer:20000000}).trim().split('\n').filter(Boolean);
const added=cp.execFileSync('git',['ls-files','--others','--exclude-standard','wms/apps/api/src'],{cwd:repo,encoding:'utf8',maxBuffer:20000000}).trim().split('\n').filter(Boolean);
const records=[];
for(const f of [...changed,...added]){
 const name=f.replace('wms/apps/api/src/','').replace(/\.ts$/,'.js');
 const emit=s=>ts.transpileModule(s,{fileName:f,compilerOptions:opts}).outputText.replaceAll('\r\n','\n');
 const newer=emit(fs.readFileSync(repo+'/'+f,'utf8'));let old=null;
 if(!added.includes(f))old=emit(cp.execFileSync('git',['show','HEAD:'+f],{cwd:repo,encoding:'utf8',maxBuffer:20000000}));
 records.push({name,old,newer});
}
fs.writeFileSync(root+'/compiled-delta.json',JSON.stringify(records));

