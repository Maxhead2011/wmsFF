const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
// TEST: real GDI page rendering through a fake spooler; never touches a physical printer.
test('series produces one spool document with ordered pages; ACK retry never reprints',()=> {
 const module=path.join(process.env.AGENT_TEST_ROOT||__dirname,'PrintSeries.ps1').replace(/'/g,"''");
 const ps=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
. '${module}'
. '${path.join(process.env.AGENT_TEST_ROOT||__dirname,'JobJournal.ps1').replace(/'/g,"''")}'
$journal=Join-Path ([IO.Path]::GetTempPath()) ('logoff-series-test-'+[guid]::NewGuid().ToString('N'))
Initialize-PrintJournal @{server='https://test.invalid';stationId='station'} $journal
$script:prints=0; $script:pages=0
function New-SeriesPrintDocument {
 $d=[pscustomobject]@{DocumentName='';PrinterSettings=[pscustomobject]@{PrinterName='';IsValid=$true;Copies=0};PrintController=$null;OriginAtMargins=$false;DefaultPageSettings=[Drawing.Printing.PageSettings]::new();Handler=$null}
 $d | Add-Member ScriptMethod add_PrintPage {param($h) $this.Handler=$h}
 $d | Add-Member ScriptMethod remove_PrintPage {param($h) $this.Handler=$null}
 $d | Add-Member ScriptMethod Dispose {}
 $d | Add-Member ScriptMethod Print {
  $script:prints++
  $bitmap=[Drawing.Bitmap]::new(600,400); $g=[Drawing.Graphics]::FromImage($bitmap)
  try { do { $e=[Drawing.Printing.PrintPageEventArgs]::new($g,[Drawing.Rectangle]::new(0,0,600,400),[Drawing.Rectangle]::new(0,0,600,400),$this.DefaultPageSettings);$this.Handler.Invoke($this,$e);$script:pages++ }while($e.HasMorePages) }finally{$g.Dispose();$bitmap.Dispose()}
 }
 return $d
}
$b=[Drawing.Bitmap]::new(600,400);$ms=[IO.MemoryStream]::new();$b.Save($ms,[Drawing.Imaging.ImageFormat]::Png);$png=[Convert]::ToBase64String($ms.ToArray());$ms.Dispose();$b.Dispose()
$job=@{id='series:test';widthMm=60;heightMm=40;pages=@(@{value='1';imageBase64=$png},@{value='2';imageBase64=$png},@{value='3';imageBase64=$png})}
Print-LabelSeries $job 'fake'
if($script:prints -ne 1 -or $script:pages -ne 3){throw 'Expected one document and three pages'}
$job.pages[2].imageBase64='invalid'
try{Print-LabelSeries $job 'fake';throw 'Expected validation error'}catch{if($_.Exception.Message -eq 'Expected validation error'){throw}}
if($script:prints -ne 1){throw 'Partial series printed'}
$script:claims=0;$script:acks=0;$script:physical=0
function Print-LabelSeries {param($job,$printer) $script:physical++}
function Invoke-WmsApi {param($method,$url,$body)
 if($url.EndsWith('/heartbeat')){return @{ready=$true}}
 if($url.EndsWith('/claim')){$script:claims++;if($script:claims -eq 1){return @{id='series:test'}};return $null}
 if($url.EndsWith('/result')){$script:acks++;if($script:acks -eq 1){throw 'network failure'};return @{ok=$true}}
}
$cfg=@{stationId='station';printerName='fake'}
try{Invoke-PrintSeriesCycle $cfg | Out-Null}catch{}
Invoke-PrintSeriesCycle $cfg | Out-Null
if($script:physical -ne 1 -or $script:acks -ne 2){throw 'ACK retry duplicated print'}
Write-Output 'PASS'
`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/PASS/);
});
