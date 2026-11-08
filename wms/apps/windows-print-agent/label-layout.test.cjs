// TEST: execute production geometry in Windows PowerShell without sending a print job.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('Ozon landscape and portrait pages fit 70x120 media without distortion or clipping',()=>{
 const file=path.join(process.env.AGENT_TEST_ROOT||__dirname,'LabelLayout.ps1').replace(/'/g,"''");
 const ps=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
. '${file}'
foreach($size in @(@(1200,700),@(700,1200),@(800,1200),@(1200,800))){
 $r=Get-LabelFit $size[0] $size[1] 10 15 260 450
 $iw=$size[0];$ih=$size[1];if($r.Rotate){$iw=$size[1];$ih=$size[0]}
 if([Math]::Abs($r.Width/$r.Height-$iw/$ih) -gt 0.00001){throw 'Distorted label'}
 if($r.X -lt 10 -or $r.Y -lt 15 -or $r.X+$r.Width -gt 270.001 -or $r.Y+$r.Height -gt 465.001){throw 'Clipped label'}
}
$r=Get-LabelFit 1200 700 0 0 700 1200
if(-not $r.Rotate -or $r.Width -ne 700 -or $r.Height -ne 1200){throw 'Wrong Ozon orientation'}
try{Get-LabelFit 1 1 0 0 0 100;throw 'accepted empty area'}catch{if($_.Exception.Message -eq 'accepted empty area'){throw}}
'PASS'`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/PASS/);
});
