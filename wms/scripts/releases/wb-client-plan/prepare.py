# -*- coding: utf-8 -*-
"""Prepare a narrow overlay from fresh live files; does not publish or write business data."""
import json, re, sys
from pathlib import Path

base, out = map(Path, sys.argv[1:3])
root = Path(__file__).resolve().parents[3]

def once(s, old, new):
    assert s.count(old) == 1, (old, s.count(old))
    return s.replace(old, new)

def save(name, value):
    p = out / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(value.encode('utf8'))

s = (base / 'client-requests.service.js').read_text(encoding='utf8')
s = once(s, 'const guard = (dto.fboExcel', 'const clientPlan = require("./wb-client-plan").isWbClientPlan(dto);\n        const guard = (dto.fboExcel')
s = once(s, '(!availability.canCommit || !availability.lines.length)', '(!availability.lines.length || availability.lines.some(l => !l.skuId) || (!clientPlan && !availability.canCommit))')
s = once(s, 'payload: { clientDecisions:', 'payload: { formationMode: clientPlan ? "WB_CLIENT_PLAN" : "AVAILABLE", clientDecisions:')
save('api/modules/client-requests/client-requests.service.js', s)
save('api/modules/client-requests/wb-client-plan.js', (root / 'apps/api/dist/modules/client-requests/wb-client-plan.js').read_text(encoding='utf8'))
s = (base / 'dto/create-client-request.dto.js').read_text(encoding='utf8')
s += '\n__decorate([(0, class_validator_1.IsOptional)(), (0, class_validator_1.IsIn)(["WB_CLIENT_PLAN"]), __metadata("design:type", String)], CreateClientRequestDto.prototype, "fboFormationMode", void 0);\n'
save('api/modules/client-requests/dto/create-client-request.dto.js', s)
s = (base / 'client-request-xlsx.service.js').read_text(encoding='utf8')
s = once(s, 'canCommit: errorsCount === 0 && lines.length > 0,', 'canCommit: errorsCount === 0 && lines.length > 0,\n            wbClientPlanEnabled: process.env.WMS_FBO_EXCEL_PICK_CHECK_ENABLED === "true",\n            clientPlanHasParseErrors: parsed.issues.some(issue => issue.severity === "error"),')
save('api/modules/client-requests/client-request-xlsx.service.js', s)
s = (base / 'requests.js').read_text(encoding='utf8')
s = once(s, 'function ni({clients:s,session:t,onCreated:d}){', 'function __wbPlanLine(l){return !!l.skuId&&Number.isSafeInteger(l.requestedQuantity)&&l.requestedQuantity>0&&!l.needsRelabel&&!l.relabelTargetBarcode}function ni({clients:s,session:t,onCreated:d}){')
s = once(s, '[be,ie]=o.useState(!1);if(o.useEffect', '[be,ie]=o.useState(!1),[wbPlan,setWbPlan]=o.useState(false);if(o.useEffect')
s = once(s, 'E.current+=1,V(null),m([]),C({}),Q(""),N(null)', 'E.current+=1,V(null),m([]),C({}),Q(""),N(null),setWbPlan(false)')
s = once(s, 'te.filter(J=>J.skuId&&Ws(J))', 'te.filter(J=>J.skuId&&(wbPlan?__wbPlanLine(J):Ws(J)))')
s = once(s, '!ae||!G||j.length===0||j.length!==te.length', '!ae||!G||j.length===0||j.length!==te.length||(wbPlan&&(!G.wbClientPlanEnabled||G.clientPlanHasParseErrors))')
s = once(s, 'title:y||G.title,fboExcel:true,', 'title:y||G.title,fboExcel:true,fboFormationMode:wbPlan?"WB_CLIENT_PLAN":undefined,')
s = once(s, 'A=te.some(j=>!Ws(j))', 'A=te.some(j=>wbPlan?!__wbPlanLine(j):!Ws(j))||(wbPlan&&(!G?.wbClientPlanEnabled||G?.clientPlanHasParseErrors))')
s = once(s, 'e.jsxs("div",{className:"client-request-xlsx-actions",children:[', 'G?.wbClientPlanEnabled?e.jsxs("label",{children:[e.jsx("input",{type:"checkbox",checked:wbPlan,disabled:be,onChange:j=>setWbPlan(j.target.checked)}),"WB: сформировать по заявке клиента, включая дефицит",e.jsx("small",{children:"Все указанные количества сохранятся. Недостающий товар потребуется принять до завершения сборки."})]}):null,e.jsxs("div",{className:"client-request-xlsx-actions",children:[')
anchor='onClick:()=>void S(),children:[e.jsx(Ks,{size:16,"aria-hidden":"true"}),e.jsx("span",{children:be?"Создаю":"Создать заявку"})]'
s=once(s,anchor,anchor.replace('be?"Создаю":"Создать заявку"','be?"Создаю":wbPlan?"Сформировать по заявке клиента":"Создать заявку"'))
s=once(s,'function $(){b(""),K(""),H(""),ce(null),V(null),m([]),C({}),se(j=>j+1)}','function $(){setWbPlan(false),b(""),K(""),H(""),ce(null),V(null),m([]),C({}),se(j=>j+1)}')
s=once(s,'w&&(E.current+=1,ce(w),N(null),V(null),m([]),Q(""))','w&&(setWbPlan(false),E.current+=1,ce(w),N(null),V(null),m([]),Q(""))')
new='/assets/wb-client-plan-20261118.js'
save('web'+new,s)
h=(base/'index.html').read_text(encoding='utf8')
m=re.search(r'<script type="importmap">(.*?)</script>',h,re.S)
imports=json.loads(m[1]);old=json.loads((base/'web-module.json').read_text())['path']
for k,v in list(imports['imports'].items()):
    if v==old: imports['imports'][k]=new
imports['imports'][old]=new
save('web/index.html',once(h,m[1],json.dumps(imports,separators=(',',':'))))
print('Prepared API4/web2 overlay; not published.')
