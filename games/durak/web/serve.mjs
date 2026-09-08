import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve(process.argv[2]||'build/site');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.zip':'application/zip'};
// FIX: local QA only, confined to the generated static artifact; no WMS proxy or APIs.
http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!pathname.startsWith('/durak/')){res.writeHead(404);res.end();return;}
    const file=resolve(root,pathname.slice(7)||'index.html');
    if(!file.startsWith(root+sep)||!(await stat(file)).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
}).listen(4197,'127.0.0.1',()=>console.log('DURAK_PREVIEW http://127.0.0.1:4197/durak/'));
