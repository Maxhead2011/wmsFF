const fs=require('fs'),path=require('path'),cp=require('child_process'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),repo=path.resolve(__dirname,'../../../..');
const files=['common/kiz-client-review'];
const config=ts.readConfigFile(repo+'/wms/apps/api/tsconfig.json',ts.sys.readFile),parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,repo+'/wms/apps/api');
for(const [label,ref] of [['before','1021a396^'],['after','1021a396']]){
 const overrides=new Map(files.map(name=>{const p='wms/apps/api/src/'+name+'.ts';return[path.resolve(repo,p).toLowerCase(),cp.execFileSync('git',['show',ref+':'+p],{cwd:repo,encoding:'utf8'})]}));
 const options={...parsed.options,outDir:root+'/'+label,incremental:false},host=ts.createCompilerHost(options),read=host.readFile;host.readFile=p=>overrides.get(path.resolve(p).toLowerCase())??read(p);
 const program=ts.createProgram(parsed.fileNames,options,host);for(const name of files)program.emit(program.getSourceFile(repo+'/wms/apps/api/src/'+name+'.ts'));
}
fs.writeFileSync(root+'/delta-files.json',JSON.stringify(files));
