# TEST: run on Windows with Edge installed.
$ErrorActionPreference = 'Stop'
$css = (Resolve-Path "$PSScriptRoot/../src/components/client-requests/request-action-menus.css").Path
$temp = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid()))
$page = Join-Path $temp.FullName 'menu.html'
$html = @"
<meta charset="utf-8"><style>$(Get-Content $css -Raw)</style>
<div class="client-request-table__warehouse-cell"><div class="client-request-actions"><div class="request-action-menu"><button>Онлайн</button><button>Остатки и короба</button><details class="request-action-menu__group"><summary>Документы</summary><div>Файл</div></details><details class="request-action-menu__group"><summary>Ещё</summary></details></div></div></div>
<output></output><script>
const cell=document.querySelector('.client-request-table__warehouse-cell'), grid=document.querySelector('.request-action-menu'), summary=document.querySelector('summary');
let count=0;
for(const style of ['light','dark']) for(const [width,size,cols] of [[257,14,2],[190,14,1],[257,20,1],[400,20,2]]) {
 document.documentElement.dataset.uiVariant='la_panthera';document.documentElement.dataset.uiStyle=style;
 cell.style.cssText='font:'+size+'px Arial;width:'+width+'px';
 const range=document.createRange();range.selectNodeContents(summary);
 if(getComputedStyle(grid).gridTemplateColumns.split(' ').length!==cols || parseFloat(getComputedStyle(summary).fontSize)!==size || range.getClientRects().length!==1 || summary.scrollWidth>summary.clientWidth) throw Error('menu layout');
 summary.parentElement.open=true;
 if(Math.abs(summary.parentElement.getBoundingClientRect().width-grid.getBoundingClientRect().width)>1)throw Error('open menu width');
 summary.parentElement.open=false;count++;
}
document.querySelector('output').textContent='PASS '+count;
</script>
"@
Set-Content $page $html -Encoding utf8
$edge=Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'
$result=& $edge --headless --disable-gpu "--user-data-dir=$($temp.FullName)/profile" --dump-dom ([uri]$page).AbsoluteUri 2>$null | Out-String
if($result -notmatch '<output>PASS 8</output>'){throw 'Request menu layout regression'}
'PASS 8'
