"""Patch the WB panel actually selected by the Requests list."""
from pathlib import Path
import json
import re
import sys

root = Path(sys.argv[1])
base = root / 'web-base'
out = root / 'web/payload'
(out / 'assets').mkdir(parents=True, exist_ok=True)
html = (base/'index.html').read_text(encoding='utf8')
raw = re.search(r'type="importmap">(.*?)</script>', html, re.S)[1]
mapping = json.loads(raw)
old = mapping['imports']['/assets/admin-tiles-20261019-4.js']
new = '/assets/wb-binding-request-entry-20261101.js'
js = (base/old.lstrip('/')).read_text(encoding='utf8')

def once(text, before, after):
    assert text.count(before) == 1, before
    return text.replace(before, after)

assert 'props.initial.marketplace==="OZON"?__OnlinePanel.FboTwoStagePanel:LegacyWbBi' in js
# FIX: keep the existing legacy close control intact; mount the shared form for this request.
anchor = 'e.jsx("div",{className:"online-execution-modal__actions",style:{display:"flex",gap:8},children:'
start = js.index(anchor,js.index('function LegacyWbBi'))
end = js.index('})]}),e.jsx(Ii,{plan:a',start)
close = js[start+len(anchor):end]
assert close.startswith('e.jsx("button",') and '"Закрыть"' in close and 'onClick:u' in close
wb = '(!a.marketplace||a.marketplace==="WILDBERRIES")&&e.jsx(__MarketButtons.WbSupplyWindow,{requestId:a.requestId,accessToken:t},a.requestId)'
js = once(js,anchor+close,anchor.replace('e.jsx("div"','e.jsxs("div"')+'['+wb+','+close+']')
old_label=json.dumps('Поставка ВБ',ensure_ascii=True)
old_label=re.sub(r'\\u[0-9a-f]{4}',lambda m:'\\u'+m[0][2:].upper(),old_label)
js = once(js,'r(!0)}},'+old_label+'),t.createElement("dialog"', 'r(!0)}},"Заявка ВБ"),t.createElement("dialog"')
(out/new.lstrip('/')).write_bytes(js.encode())
for key in [k for k,v in mapping['imports'].items() if v==old]+[old]:
    mapping['imports'][key]=new
(out/'index.html').write_bytes(once(html,raw,json.dumps(mapping,ensure_ascii=False,separators=(',',':'))).encode())
