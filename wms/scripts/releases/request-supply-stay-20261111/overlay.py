"""Build an overlay from the verified PR999 web assets."""
import json
import re
import sys
from pathlib import Path

source, output = map(Path, sys.argv[1:3])
assets = 'assets/'
root = assets + 'pvz-loss-host-root-20261109.js'
fbs = assets + 'request-supply-fbs-20261111.js'
bridge = assets + 'request-supply-action-20261111.js'
renamed = {file: file.removesuffix('.js') + '-stay.js' for file in (root, fbs, bridge)}


def replace(text, old, new, count=1):
    assert text.count(old) == count, old
    return text.replace(old, new)


def write(file, value):
    target = output / file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(value.encode('utf-8'))


text = (source / root).read_text(encoding='utf-8')
host = '''
function RequestSupplyHost({session}) {
  const [target, setTarget] = x.useState(null);
  x.useEffect(() => {
    const update = event => setTarget(event.detail);
    window.addEventListener("request-supply-open", update);
    return () => window.removeEventListener("request-supply-open", update);
  }, []);
  return target ? e.jsx(x.Suspense, {
    fallback: e.jsx("p", {role:"status",children:"Загружаю поставку WB…"}),
    children: e.jsx(L5, {session,requestTarget:target,closeRequestSupply:()=>setTarget(null)})
  }) : null;
}
'''
old = 'children:e.jsx(D5,{session:n,onOpenFbsOrders:()=>r("fbs"),focusRequestId:d,onFocusRequestHandled:u})'
new = 'children:e.jsxs(x.Fragment,{children:[e.jsx(D5,{session:n,onOpenFbsOrders:()=>{const target=__readRequestSupply();if(target){__clearRequestSupply(null);window.dispatchEvent(new CustomEvent("request-supply-open",{detail:target}));return;}r("fbs")},focusRequestId:d,onFocusRequestHandled:u}),e.jsx(RequestSupplyHost,{session:n})]})'
write(renamed[root], 'import {getTarget as __readRequestSupply,setTarget as __clearRequestSupply} from "/' + renamed[bridge] + '";\n' + replace(text, old, new) + '\n' + host)
text = (source / fbs).read_text(encoding='utf-8')
text = replace(text, '/' + bridge, '/' + renamed[bridge])
text = replace(text, '()=>__getSupplyTarget()?"WILDBERRIES":null', '()=>s.requestTarget?"WILDBERRIES":null')
text = replace(text, 'setDisplayMode:l,branches:x}){const __fbsRoot', 'setDisplayMode:l,branches:x,requestTarget,closeRequestSupply}){const handledRequest=c.useRef(null);const __fbsRoot')
text = replace(text, 'const target=__getSupplyTarget();', 'const target=requestTarget;')
text = replace(text, 'if(!target||!__fbsRoot.current', 'if(!target||handledRequest.current===target||!__fbsRoot.current')
text = replace(text, '__setSupplyTarget(null);', 'handledRequest.current=target;', 2)
text = replace(text, 'target.action==="print"?"print":true);', 'target.action==="print"?"print":true,closeRequestSupply);')
text = replace(text, 'async function ga(o,all=false)', 'async function ga(o,all=false,onComplete)')
text = replace(text, '?"Ozon":"WB");return;}const bytes=', '?"Ozon":"WB");onComplete?.();return;}const bytes=')
text = replace(text, 'result.warnings.join(" "));return;', 'result.warnings.join(" "));else onComplete?.();return;')
dialog = re.search(r'Ge\?e\.jsx\(gi,\{accessToken:s\.accessToken,clientId:f,state:Ge,.*?onSubmit:ma\}\):null', text).group()
recovery = 'as?e.jsx(yi,{rescanOrders:as.rescanOrders,cancelledOrders:as.cancelledOrders,onClose:()=>{ds(null);closeRequestSupply()}}):'
panel = 'requestTarget?e.jsxs("section",{ref:__fbsRoot,"aria-label":"Поставка WB",children:[' + dialog.replace('onCancel:()=>xe(null)', 'onCancel:()=>{xe(null);closeRequestSupply()}') + ',!Ge?(' + recovery + 'e.jsxs(e.Fragment,{children:[e.jsx("p",{role:Ae||U.status==="error"?"alert":"status",children:Ae||(U.status==="error"?U.error:Js)||"Загружаю поставку WB…"}),e.jsx("button",{type:"button",className:"icon-text-button",onClick:closeRequestSupply,children:"Закрыть"})]})):null]}):'
anchor = 'a?e.jsxs("section",{ref:__fbsRoot,className:"fbs-panel"'
write(renamed[fbs], replace(text, anchor, panel + anchor))
write(renamed[bridge], (source / bridge).read_text(encoding='utf-8'))
html = (source / 'index.html').read_text(encoding='utf-8')
match = re.search(r'<script type="importmap">(.*?)</script>', html, re.S)
imports = json.loads(match[1])
for old, new in renamed.items():
    for key, value in list(imports['imports'].items()):
        if value == '/' + old:
            imports['imports'][key] = '/' + new
    imports['imports']['/' + old] = '/' + new
html = html.replace(match[1], json.dumps(imports, ensure_ascii=False, separators=(',', ':')), 1)
html = replace(html, 'src="/' + root + '"', 'src="/' + renamed[root] + '"')
write('index.html', html)

