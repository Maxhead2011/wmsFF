// TEST: verify the real entry point, installer and packaged duplicate queue.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.env.AGENT_TEST_ROOT||__dirname;
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
test('duplicate capability is distributed and installed with the agent',()=>{
 assert.ok(fs.existsSync(path.join(root,'KizDuplicate.ps1')));
 assert.match(read('AgentLifecycle.ps1'),/'KizDuplicate\.ps1'/);
 if(!process.env.AGENT_TEST_ROOT)assert.match(read('Build-Package.ps1'),/'KizDuplicate\.ps1'/);
});
test('main polling loop invokes the isolated duplicate queue before series continue',()=>{
 const main=read('LOGOFF-FBS-Print-Agent.ps1');
 assert.match(main,/\. \(Join-Path \$PSScriptRoot 'KizDuplicate\.ps1'\)/);
 const loop=main.slice(main.indexOf('while (-not'));
 assert.match(loop,/Invoke-AgentKizDuplicateCycle \$cfg/);
 assert.ok(loop.indexOf('Invoke-AgentKizDuplicateCycle')<loop.indexOf('Invoke-PrintSeriesCycle'));
});
for(const failure of [false,true])test(`actual agent loads duplicate handler and isolates failure=${failure}`,()=>{
 const script=`$ErrorActionPreference='Stop'
. '${root.replace(/'/g,"''")}/LOGOFF-FBS-Print-Agent.ps1' -LibraryOnly
$script:paths=@();$script:prints=0;$script:errors=0
function Write-AgentError {param($stage,$errorRecord) if($stage -ne 'kiz-duplicate'){throw 'wrong error stage'};$script:errors++}
function Print-OneLabel {param($bytes,$printer,$width,$height) if($width -ne 58 -or $height -ne 40){throw 'wrong dimensions'};$script:prints++}
function Invoke-WmsApi {param($method,$url,$body)
 $script:paths+= $url
 if(${failure?'$true':'$false'}){throw 'queue unavailable'}
 if($url.EndsWith('/claim')){return @{id='job';contentType='image/png';widthMm=58;heightMm=40;imageBase64='iVBORw0KGgo='}}
}
Invoke-AgentKizDuplicateCycle @{stationId='stable-id';printerName='test';labelWidthMm=58;labelHeightMm=40}
if($script:paths[0] -ne '/print/kiz-duplicates/stations/stable-id/heartbeat'){throw 'missing capability heartbeat'}
if($script:prints -ne ${failure?0:1} -or $script:errors -ne ${failure?1:0}){throw 'incorrect isolated queue result'}
if($script:paths.Count -ne ${failure?1:3}){throw 'unexpected requests'}
$script:paths=@()
Invoke-AgentKizDuplicateCycle @{stationId='stable-id';labelWidthMm=100;labelHeightMm=150}
if($script:paths.Count){throw 'unsupported printer advertised'}
`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(r.status,0,r.stdout+r.stderr);
});
