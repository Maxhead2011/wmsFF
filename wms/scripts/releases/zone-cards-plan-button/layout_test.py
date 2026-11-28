"""TEST: check rendered zone geometry and long labels in Chromium."""
from pathlib import Path
import tempfile, subprocess, sys
repo = Path(__file__).resolve().parents[3]
folder = repo/'apps/web/src/components/warehouse'
css = (folder/'warehouse.css').read_text(encoding='utf8') + (folder/'storage-zone-statistics.css').read_text(encoding='utf8')
box = '<article><span>⌖</span><div><strong>Длинное название зоны размещения</strong><small>'+'CODE123'*9+'</small></div><dl><div><dt>Паллеты</dt><dd>13</dd></div><div><dt>Короба</dt><dd>433</dd></div></dl><button>×</button></article>'
unassigned = '<article class="is-unassigned"><span>⌖</span><div>Без зоны</div><dl><div>182</div><div>2934</div></dl></article>'
with tempfile.TemporaryDirectory(dir=sys.argv[2]) as tmp:
 for width, cols in [(1200,3),(720,2),(360,1)]:
  html=Path(tmp)/'zones.html'
  html.write_text(f'<meta charset=utf-8><style>{css}</style><section class="storage-zones__zone-statistics" style="width:{width}px"><div class="storage-zones__zone-statistics-grid">'+box*6+unassigned+'</div></section>'+'''<script>
const grid=document.querySelector('.storage-zones__zone-statistics-grid'), cards=[...grid.children], first=cards[0], rect=e=>e.getBoundingClientRect(), name=first.querySelector('small');
const count=cards.filter(c=>rect(c).top===rect(first).top).length;
if(count===COLS && rect(cards.at(-1)).bottom<=rect(first).top && rect(first.querySelector('dl')).top>=rect(name).bottom && name.scrollWidth<=name.clientWidth+1 && grid.scrollWidth<=grid.clientWidth+1) document.body.dataset.result="pass";
</script>'''.replace('COLS',str(cols)),encoding='utf8')
  proc=subprocess.run([sys.argv[1],'--headless','--disable-gpu','--no-first-run','--user-data-dir='+str(Path(tmp)/'profile'),'--dump-dom',html.resolve().as_uri()],capture_output=True,timeout=45)
  assert b'data-result="pass"' in proc.stdout, (width,proc.stdout[-300:])
  print(width,cols,'OK')
