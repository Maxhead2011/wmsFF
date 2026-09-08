// TEST: only default APK and its metadata may change in the live web image.
const fs=require('node:fs'),assert=require('node:assert/strict');
function verify(before,after){
 const changed=[];assert.equal(before.size,after.size);
 for(const [p,h] of before){assert(after.has(p));if(after.get(p)!==h)changed.push(p)}
 assert.deepEqual(changed.sort(),['/usr/share/nginx/html/downloads/logoff-tsd.apk','/usr/share/nginx/html/downloads/logoff-tsd.json']);
 assert.equal(after.get('/usr/share/nginx/html/downloads/logoff-tsd.apk'),'8dc0a542d26f633fbf89895ff2a004fe6c5b77b3e6f3b62b2284f5a251122a96');
}
module.exports={verify};
if(require.main===module){
 const root=process.argv[2];const hashes=n=>new Map(fs.readFileSync(root+'/'+n,'utf8').trim().split('\n').map(l=>{const m=/^([a-f0-9]{64})\s+(.+)$/.exec(l);assert(m);return[m[2],m[1]]}));
 verify(hashes('before.sha256'),hashes('after.sha256'));console.log('ONLY_DEFAULT_APK_AND_METADATA_CHANGED');
}
