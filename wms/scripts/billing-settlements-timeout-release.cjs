// FIX: replace only two verified source-equivalent live modules; reject unreviewed runtime drift.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
// Both pins exactly match the full source build recorded for PR463; no unrelated runtime differences.
const pins={'billing-settlements.service':'5b7479f33f65a6a57a4d0b23f11943ea97c747250b87bd63850c2d35a86d2c26','billing-settlements.policy':'88e6929b4b3751702b10fb271c49080b71a6b1cba8fc3085b26a1fdfc582bebe'};
function replacement(live,next,name){if(sha(live)!==pins[name])throw Error('Unreviewed settlements runtime drift');return next}
function build(base,compiled,out){if(fs.existsSync(out))throw Error('Fresh output required');const files={};for(const name of Object.keys(pins)){
 const file='modules/billing/'+name+'.js';
 const live=fs.readFileSync(base+'/'+file,'utf8'),next=replacement(live,fs.readFileSync(compiled+'/'+file,'utf8'),name);
 new Function(next);const p=out+'/api/'+file;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,next);files[file]={before:sha(live),after:sha(next)};
 }fs.writeFileSync(out+'/proof.json',JSON.stringify(files,null,2));console.log(JSON.stringify({apiFiles:Object.keys(files)}));}
module.exports={replacement,build};if(require.main===module)build(...process.argv.slice(2));
