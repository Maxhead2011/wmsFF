// FIX: compile the exact source delta; never replace complete runtime services.
const fs=require('fs'),path=require('path'),cp=require('child_process'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),repo=path.resolve(__dirname,'../../../..');
const base='058b474a';
const changed=cp.execFileSync('git',['diff','--name-status',base,'--','wms/apps/api/src'],{cwd:repo,encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split('\t')).filter(x=>x[1]?.endsWith('.ts'));
const config=ts.readConfigFile(repo+'/wms/apps/api/tsconfig.json',ts.sys.readFile),parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,repo+'/wms/apps/api');
for(const label of ['before','after']){
 const overrides=new Map(changed.filter(x=>label==='after'||x[0]!=='A').map(([status,p])=>[path.resolve(repo,p).toLowerCase(),label==='before'?cp.execFileSync('git',['show',base+':'+p],{cwd:repo,encoding:'utf8'}):fs.readFileSync(path.resolve(repo,p),'utf8')]));
 const options={...parsed.options,outDir:root+'/'+label,incremental:false},host=ts.createCompilerHost(options),read=host.readFile;host.readFile=p=>overrides.get(path.resolve(p).toLowerCase())??read(p);
 const program=ts.createProgram(parsed.fileNames,options,host);
 for(const [status,p] of changed)if(label==='after'||status!=='A')program.emit(program.getSourceFile(path.resolve(repo,p)));
}
fs.writeFileSync(root+'/delta-files.json',JSON.stringify(changed.map(([status,p])=>({status,path:p.replace('wms/apps/api/src/','').replace(/\.ts$/,'.js')}))));
console.log('Compiled',changed.length,'API modules');
