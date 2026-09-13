// TEST: execute the actual Windows PowerShell HTTP code against a local fake WMS only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const agent=fs.readFileSync(path.join(__dirname,'LOGOFF-FBS-Print-Agent.ps1'),'utf8');
const setup=fs.readFileSync(path.join(__dirname,'Setup-Agent.ps1'),'utf8');
test('Windows PowerShell preserves Cyrillic WMS login, password and station body',async()=>{
 const calls=[];const server=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{calls.push({url:req.url,body:JSON.parse(Buffer.concat(chunks).toString('utf8')),type:req.headers['content-type']});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.endsWith('/login')?{accessToken:'test-token'}:{ok:true}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const commonPath=path.join(__dirname,'WmsApi.ps1');
  const code=fs.existsSync(commonPath)?fs.readFileSync(commonPath,'utf8'):agent.slice(agent.indexOf('function Read-Config'),agent.indexOf('function Print-OneLabel'));
  const script=`$ErrorActionPreference='Stop'\n${code}\nfunction Read-Config { return @{server='http://127.0.0.1:${server.address().port}';login='Склад';password='Пароль-тест'} }\nInvoke-WmsApi Post '/diagnostic' @{name='Печать Москва'} | Out-Null`;
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});let error='';child.stderr.on('data',d=>error+=d);const timer=setTimeout(()=>child.kill(),20000);const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timer);assert.equal(exit,0,error);
  assert.equal(calls[0].body.email,'Склад');assert.equal(calls[0].body.password,'Пароль-тест');assert.equal(calls[1].body.name,'Печать Москва');assert.match(calls[0].type,/charset=utf-8/i);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('setup and background agent share the UTF-8 transport',()=>{
 assert.match(setup,/WmsApi\.ps1/);assert.match(agent,/WmsApi\.ps1/);
 assert.doesNotMatch(setup,/Invoke-RestMethod/);
});
test('agent prints the server sorting image instead of inventing another label',()=>{
 assert.match(agent,/job\.sortingLabel\.imageBase64/);assert.doesNotMatch(agent,/WMS REQUEST|DrawString|\$lines =/);
});

for (const persistent of [false,true]) {
 test(`expired login token retries once; persistent failure=${persistent}`,async()=>{
  // TEST: a rejected token must not trigger unbounded recursive requests.
  let logins=0,requests=0;
  const server=http.createServer((req,res)=>{
   req.resume();res.setHeader('Content-Type','application/json');
   if(req.url.endsWith('/login')){logins++;res.end(JSON.stringify({accessToken:'fresh'}));return;}
   requests++;res.statusCode=persistent||requests===1?401:200;res.end(JSON.stringify({ok:res.statusCode===200}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
   const script=`$ErrorActionPreference='Stop'\n${fs.readFileSync(path.join(__dirname,'WmsApi.ps1'),'utf8')}\nfunction Read-Config { return @{server='http://127.0.0.1:${server.address().port}';login='test';password='test'} }\n$script:token='expired'\nInvoke-WmsApi Post '/diagnostic' @{} | Out-Null`;
   const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});
   child.stdout.resume();child.stderr.resume();const timer=setTimeout(()=>child.kill(),20000);
   const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timer);
   assert.equal(exit,persistent?1:0);assert.equal(requests,2);assert.equal(logins,1);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 });
}
