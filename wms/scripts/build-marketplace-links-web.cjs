// FIX: extend the deployed catalog without replacing its existing application graph.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
function build(input,output){
 const cache={},files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
 const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];let main=files['assets/'+entry];
 const ast=ts.createSourceFile('runtime.js',main,ts.ScriptTarget.Latest,true);
 const screen=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ED'&&n.getText(ast).includes('catalog-panel'));
 if(!screen)throw Error('Catalog runtime drift');
 let catalog=screen.getText(ast);
 function once(s,a,b){if(s.split(a).length!==2)throw Error('Unique anchor missing: '+a);return s.replace(a,b);}
 catalog=once(catalog,'M?e.jsx("p",{className:"form-error",children:M}):null','d&&e.jsx(__MarketplaceLinks.MarketplaceProductLinks,{session:t,connections:R,canWrite:s}),M?e.jsx("p",{className:"form-error",children:M}):null');
 main=main.slice(0,screen.getStart(ast))+catalog+main.slice(screen.end);
 const source=fs.readFileSync(path.join(__dirname,'../apps/web/src/components/catalog/MarketplaceProductLinks.tsx'),'utf8').replace(/^import .*;\r?\n/gm,'');
 const code=`const React=x;const {useEffect,useRef,useState}=x;
 function fetchProductLinks(accessToken,id){return z('/marketplace-connections/'+encodeURIComponent(id)+'/product-links',{accessToken});}
 function confirmProductLink(accessToken,id,row,skuId,reason){return z('/marketplace-connections/'+encodeURIComponent(id)+'/product-links/'+encodeURIComponent(row.id)+'/confirm',{accessToken,method:'POST',body:{skuId,updatedAt:row.updatedAt,reason}});}
 `+source;
 main+='\n'+esbuild.buildSync({stdin:{contents:code,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__MarketplaceLinks',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
 cache['assets/'+entry]=main;
 let fbsChanges=0;
 const graph=new Set(),pending=['index.html'];while(pending.length){const n=pending.pop();if(graph.has(n))continue;graph.add(n);for(const token of files[n].match(/[\w.$-]{1,240}\.js/g)||[]){const next='assets/'+token;if(files[next]&&!graph.has(next))pending.push(next);}}
 for(const n of graph){let s=files[n];if(!s.includes('Нет сопоставленных товаров'))continue;s=once(s,'Нет сопоставленных товаров','Нет товаров для выбранных условий');s=once(s,'Проверьте штрихкоды и артикулы товаров в WMS и Wildberries.','Проверьте фильтры, выбранный кабинет и сверку карточек WB и Ozon в каталоге товаров.');cache[n]=s;fbsChanges++;}
 if(fbsChanges!==1)throw Error('Expected one FBS chunk');
 const result=repair(files,entry,entry,'marketplace-links-20261010');
 for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
 return Object.keys(result);
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(...process.argv.slice(2))));
