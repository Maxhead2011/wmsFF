"""Overlay the two UI changes on the verified deployed web bundle."""
from pathlib import Path
import json, re, sys, shutil
index, bundle, dest = map(Path, sys.argv[1:])
assets = dest / "assets"
assets.mkdir(parents=True, exist_ok=True)
html = index.read_text(encoding="utf8")
match = re.search(r'<script type="importmap">(.*?)</script>', html, re.S)
imports = json.loads(match[1])
old = '/assets/ozon-planned-components-20261127.js'
new = '/assets/ozon-plan-button-20261128.js'
assert old not in imports['imports']
imports['imports'][old] = new
src = bundle.read_text(encoding="utf8")
anchor = 'disabled: busy || data.differences.length > 0, onClick: edit'
assert src.count(anchor) == 1
(assets / Path(new).name).write_bytes(src.replace(anchor, 'type: "button", className: "primary-button", '+anchor).encode())
css = 'storage-zone-statistics.css'
shutil.copyfile(Path(__file__).resolve().parents[3] / 'apps/web/src/components/warehouse' / css, assets / 'zone-cards-20261128.css')
assert html.count('</head>') == 1
(dest/'index.html').write_bytes(html.replace(match[1],json.dumps(imports,ensure_ascii=False,separators=(',',':'))).replace('</head>','<link rel="stylesheet" href="/assets/zone-cards-20261128.css"></head>').encode())
