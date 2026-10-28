# FIX: atomic local preparation, fail closed if the published anchors changed.
from pathlib import Path
import json,sys,difflib
r=Path(sys.argv[1]);changes={}
def once(s,a,b):
 assert s.count(a)==1,repr(a[:160])
 return s.replace(a,b,1)
for name,v in json.loads((r/'compiled.json').read_text(encoding='utf8')).items():
 p=r/'api/modules/marketplace-connections'/f'{name}.js'
 if v['old'] is None:
  assert not p.exists();changes[p]=v['next'];continue
 s=p.read_text(encoding='utf8');a=v['old'].splitlines(True);b=v['next'].splitlines(True)
 for g in difflib.SequenceMatcher(None,a,b,autojunk=False).get_grouped_opcodes(1):
  old=''.join(a[g[0][1]:g[-1][2]]);new=''.join(b[g[0][3]:g[-1][4]])
  if old.startswith('const fbs_monitor_routing_1 = '):
   anchor='const fbs_monitor_routing_1 = require("./fbs-monitor-routing");\n'
   s=once(s,anchor,anchor+'const fbs_monitor_product_identity_1 = require("./fbs-monitor-product-identity");\nconst marketplace_product_links_1 = require("./marketplace-product-links");\n')
   continue
  # Published runtime already normalizes BigInt through its verified DTO helper.
  if 'chrtId: event.chrtId == null ? null : Number(event.chrtId),' in new and 'claimed.push' not in new:
   existing='chrtId: event.chrtId == null ? null : (0, wb_stock_observations_1.wbStockCheckDto)({ chrtId: event.chrtId }).chrtId,'
   old=old.replace('chrtId: event.chrtId,',existing)
   new=new.replace('chrtId: event.chrtId == null ? null : Number(event.chrtId),',existing)
  s=once(s,old,new)
 changes[p]=s
p=r/'api/modules/marketplace-connections/marketplace-connections.service.js';s=p.read_text(encoding='utf8')
anchor='    async autoSyncFbsStocksForClientFresh(clientId, healthCycle) {\n'
s=once(s,anchor,anchor+'''        // FIX: reconcile before capturing the stock plan; read-only screens never enter here.
        if (await this.stockControl.isEnabled(clientId)) {
            await require('./wb-terminal-auto-reservations').reconcileTerminalAutoReservations(this.prisma, clientId,
                (apiKey, ids) => this.readWbStatusesForConnection(apiKey, ids));
        }
''')
changes[p]=s
for p,s in changes.items():p.write_bytes(s.encode('utf8'))
print('Prepared exact four-module API delta; web, schema, TSD, ledger and sold WMS unchanged')
