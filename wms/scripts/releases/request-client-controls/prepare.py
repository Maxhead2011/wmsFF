"""Build the three-file web overlay from the published PR824 assets."""
from pathlib import Path
import json
import re
import sys

root = Path(sys.argv[1])
source = root / 'web-base'
output = root / 'web/payload'
(output / 'assets').mkdir(parents=True, exist_ok=True)
old_requests = 'assets/compact-request-tools-20261101.js'
old_workspace = 'assets/fbo-progress-lamoda-20261030.js'
requests = 'assets/request-client-controls-20261101.js'
workspace = 'assets/fbo-client-controls-20261101.js'

def once(text, original, replacement):
    if text.count(original) != 1:
        raise ValueError(f'Unexpected production anchor: {original}')
    return text.replace(original, replacement)

panel = (source / old_requests).read_text(encoding='utf8')
panel = once(panel, 'if(Je==="status")return __BatchFeatures.compareRequestStatus', 'if(Je==="client")return (__clientNames.compare(n.client.name,l.client.name)||n.number-l.number)*(xs==="asc"?1:-1);if(Je==="status")return __BatchFeatures.compareRequestStatus')
option = 'e.jsx("option",{value:"number",children:"По номеру"})'
panel = once(panel, option, option+',e.jsx("option",{value:"client",children:"По клиенту"})')
for direction, label in [('asc','От А до Я'),('desc','От Я до А')]:
    prefix = 'value:"'+direction+'",children:'
    panel = once(panel,prefix+'Je==="status"',prefix+'Je==="client"?"'+label+'":Je==="status"')
panel = once(panel,'className:"secondary-button",style:{marginInlineStart:"auto"}','className:"primary-button",style:{marginInlineStart:"auto",backgroundColor:"#1754ad",color:"#fff"}')
panel = once(panel,'className:"secondary-button","aria-haspopup":"dialog"', 'className:"primary-button",title:"Открыть привязку поставки Wildberries","aria-haspopup":"dialog"')
# Export the existing form so both entry points use the same permissions and binding API.
panel = 'const __clientNames=new Intl.Collator("ru",{numeric:true,sensitivity:"base"});\n'+panel+'\nexport const WbRequestSupplyWindow=__MarketButtons.WbSupplyWindow;\n'
host = (source / old_workspace).read_text(encoding='utf8')
actions = 'e("div",{className:d?"fbo-inline-execution__actions":"online-execution-modal__actions",children:'
close = 'e("button",{type:"button",className:"icon-button"'
start = host.index(actions+close)
end = host.index('})})',start)+2
button = host[start+len(actions):end]
host = once(host,actions+button,'r("div",{className:d?"fbo-inline-execution__actions":"online-execution-modal__actions",children:[(!l.marketplace||l.marketplace==="WILDBERRIES")&&e(WbRequestSupplyWindow,{requestId:l.requestId,accessToken:a},l.requestId),'+button+']')
host = 'import {WbRequestSupplyWindow} from "/assets/admin-tiles-20261019-4.js";\n'+host
html = (source / 'index.html').read_text(encoding='utf8')
raw = re.search(r'<script type="importmap">(.*?)</script>',html,re.S)[1]
mapping = json.loads(raw)
for old,new in [(old_requests,requests),(old_workspace,workspace)]:
    keys = [k for k,v in mapping['imports'].items() if v == '/'+old]
    assert keys
    for k in keys+[('/'+old)]:
        mapping['imports'][k] = '/'+new
for name,data in [(requests,panel),(workspace,host),('index.html',once(html,raw,json.dumps(mapping,ensure_ascii=False,separators=(',',':'))))]:
    (output/name).write_bytes(data.encode('utf8'))
