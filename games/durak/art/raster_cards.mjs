import {createRequire} from 'node:module';
import {readdir,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const sharp=require(process.argv[2]||'sharp');
const source=new URL('../web/cards/',import.meta.url),out=new URL('./output/cards/',import.meta.url);
await mkdir(out,{recursive:true});
const names=(await readdir(source)).filter(n=>/^(?:[6-9TJQKA][CDHS]|1B)\.svg$/.test(n));
if(names.length!==37)throw new Error(`Expected 36 faces and a back, got ${names.length}`);
// FIX: format conversion only; preserve the public-domain print artwork.
for(const name of names) await sharp(fileURLToPath(new URL(name,source)),{density:200}).resize(512,717).png().toFile(fileURLToPath(new URL(name.replace('.svg','.png'),out)));
console.log('CARD_RASTER_READY',names.length);
