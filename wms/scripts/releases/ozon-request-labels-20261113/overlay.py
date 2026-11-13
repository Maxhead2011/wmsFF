"""Exact web overlay preserving the deployed runtime and a single action bridge."""
import json
import re
import sys
from pathlib import Path

source, output = map(Path, sys.argv[1:3])
files = ['request-supply-buttons-20261111.js', 'request-supply-action-20261111-stay.js',
         'request-supply-fbs-20261111-stay.js', 'pvz-loss-host-root-20261109-stay.js']
renamed = {'assets/' + f: 'assets/' + f.removesuffix('.js') + '-ozon.js' for f in files}

def replace(text, old, new, count=1):
    assert text.count(old) == count, (old, text.count(old))
    return text.replace(old, new)

def write(name, text):
    target = output / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(text.encode('utf-8'))

for old, new in renamed.items():
    text = (source / old).read_text(encoding='utf-8')
    if 'buttons' in old:
        text = replace(text, 'le&&Ye(c)&&c.wbSupplyIds?.length?e.jsxs("details",{className:"request-action-menu__group request-supply-labels"',
                       'le&&Ye(c)?e.jsxs("details",{className:"request-action-menu__group request-supply-labels"')
    elif 'action' in old:
        # FIX: exact request scope for both supported label marketplaces; WB-only delivery.
        text = '''export function requestSupplyOrders(target, orders) {
 const {request,action}=target;
 const linked=orders.filter(order=>order.request?.id===request.id);
 const expected=request.fbsCompletion?.totalOrders;
 if(!linked.length||(expected&&linked.length!==expected))throw Error('Не удалось загрузить полный состав заявки FBS.');
 if(linked.some(order=>!['WILDBERRIES','OZON'].includes(order.marketplace)))throw Error('Печать стикеров доступна для заявок WB и Ozon.');
 if(action!=='deliver')return linked;
 if(linked.some(order=>order.marketplace!=='WILDBERRIES'))throw Error('Эта передача доступна только для WB.');
 if(!request.fbsCompletion?.completed||linked.some(order=>!order.supplyId||order.supplierStatus!=='confirm'))throw Error('Для передачи все заказы заявки должны быть собраны и готовы к отправке в WB.');
 const key=order=>JSON.stringify([order.connectionId,order.supplyId]);
 const supplies=new Set(linked.map(key));
 if(orders.some(order=>order.marketplace==='WILDBERRIES'&&supplies.has(key(order))&&order.request?.id!==request.id))throw Error('В поставку WB входят заказы из другой заявки. Проверьте состав поставки.');
 return linked;
}
let pending=null;
export function getTarget(){return pending;}
export function setTarget(target){pending=target;}
'''
    else:
        text = text.replace('Загружаю поставку WB…', 'Загружаю стикеры и действия заявки…')
        text = text.replace('"aria-label":"Поставка WB"', '"aria-label":"Стикеры и действия заявки"')
    write(new, text)

html = (source / 'index.html').read_text(encoding='utf-8')
match = re.search(r'<script type="importmap">(.*?)</script>', html, re.S)
mapping = json.loads(match[1])
for old, new in renamed.items():
    for key, value in list(mapping['imports'].items()):
        if value == '/' + old:
            mapping['imports'][key] = '/' + new
    mapping['imports']['/' + old] = '/' + new
html = html.replace(match[1], json.dumps(mapping, ensure_ascii=False, separators=(',', ':')), 1)
old = 'assets/' + files[-1]
html = html.replace('src="/' + old + '"', 'src="/' + renamed[old] + '"')
write('index.html', html)
