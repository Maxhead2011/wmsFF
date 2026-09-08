import {mkdir,copyFile,writeFile,stat,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {archiveHash} from './archive-hash.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(process.argv[2]||join(root,'build','site'));
const within=relative(join(root,'build'),out);
if(!within || within.startsWith('..') || resolve(out)===resolve(root)) throw new Error('Output must be a dedicated folder under games/durak/build');
await mkdir(join(out,'web','cards'),{recursive:true});await mkdir(join(out,'core'),{recursive:true});
for(const name of ['app.mjs','match.mjs','style.css','card-finish.css']) await copyFile(join(root,'web',name),join(out,'web',name));
await copyFile(join(root,'web','index.html'),join(out,'index.html'));
await copyFile(join(root,'core','rules.mjs'),join(out,'core','rules.mjs'));
await copyFile(join(root,'art','cards','CREDITS.md'),join(out,'CARD-ART-LICENSE.txt'));
for(const name of await readdir(join(root,'web','cards'))) if(/\.svg$/.test(name)) await copyFile(join(root,'web','cards',name),join(out,'web','cards',name));
const release={version:'2026-09-08',browser:{modes:['simple','throw-in','transfer'],multiplayer:false},windows:null};
// FIX: a Windows download is added only when a real archive was provided to this build.
if(process.argv[3]) {
  const archive=resolve(process.argv[3]),size=(await stat(archive)).size;
  if(size<10000000) throw new Error('Archive is too small for the Unreal client');
  await mkdir(join(out,'downloads'),{recursive:true});
  await copyFile(archive,join(out,'downloads','LOGOFF-Durak-Windows.zip'));
  release.windows={url:'./downloads/LOGOFF-Durak-Windows.zip',bytes:size,sizeLabel:`${(size/1024**3).toFixed(2)} ГБ`,sha256:await archiveHash(archive)};
}
await writeFile(join(out,'release.json'),JSON.stringify(release,null,2)+'\n');
console.log(JSON.stringify({out,release},null,2));
