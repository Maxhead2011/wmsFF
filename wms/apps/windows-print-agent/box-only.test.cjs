const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
// TEST: execute the queue with a replaced printer function and no network calls.
test('only explicit box-only jobs omit the second label; ordinary FBS remains strict',()=>{
 const file=path.join(process.env.AGENT_TEST_ROOT||__dirname,'LOGOFF-FBS-Print-Agent.ps1').replace(/'/g,"''");
 const ps=`$ErrorActionPreference='Stop'
. '${file}' -LibraryOnly
$script:prints=0
function Print-OneLabel {param($bytes,$printer,$width,$height) $script:prints++}
function Sync-PrintResults {param($kind)}
function Invoke-DurablePrint {param($cfg,$kind,$id,$action) & $action}
function Invoke-WmsApi {param($method,$url,$body) if($url.EndsWith('/heartbeat')){return @{labelWidthMm=58;labelHeightMm=40}};if($url.EndsWith('/claim')){return $script:job}}
$cfg=@{stationId='fake';printerName='FAKE';labelWidthMm=58;labelHeightMm=40}
$script:job=@{id='one';source='TSD_KIZ_BOX_LABELS';labelCount=1;productName='';stickerBase64='AQID';sortingLabel=$null}
Invoke-AgentQueueCycle $cfg
if($script:prints -ne 1){throw 'Box-only must print once'}
$script:job.source='FBS'
$failed=$false;try{Invoke-AgentQueueCycle $cfg}catch{$failed=$true}
if(-not $failed -or $script:prints -ne 1){throw 'Missing FBS pair must fail before printing'}
$script:job.source='TSD_KIZ_BOX_LABELS';$script:job.productName='PALLET';$script:job.labelCount=2;$script:job.sortingLabel=@{contentType='image/png';imageBase64='BAUG'}
Invoke-AgentQueueCycle $cfg
if($script:prints -ne 3){throw 'Box with pallet must print two labels'}
`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr);
});
