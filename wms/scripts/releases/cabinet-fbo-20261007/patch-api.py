from pathlib import Path
import json,difflib
r=Path(__file__).parent
for n in json.loads((r/'api-changes.json').read_text(encoding='utf8')):
 new=(r/'compiled-new'/n).read_text(encoding='utf8');p=r/'candidate-api'/n;p.parent.mkdir(parents=True,exist_ok=True)
 if not (r/'compiled-old'/n).exists():p.write_text(new,encoding='utf8');continue
 old=(r/'compiled-old'/n).read_text(encoding='utf8');live=(r/'api-base'/n).read_text(encoding='utf8');changes=[]
 if n=='modules/tsd/fbo-two-stage.service.js':
  def replace(a,b):
   global live
   assert live.count(a)==1,('FBO anchor',live.count(a),a[:100]);live=live.replace(a,b,1)
  replace('        const route = [];', '        const route = [];\n        const requiresPlacement = require("../../common/stock/wb-order-stock-lifecycle").wbOrderStockLifecycleEnabled() && r.client.stockBalanceMode === "PALLET_SORT";')
  replace('        for (const box of prioritized) {', '        for (const box of prioritized) {\n            if (requiresPlacement && !box.storagePlacement) continue;')
  start=new.index('        const waitingBySku = new Map();');end=new.index('        return { requestId:',start)
  pending=new[start:end]
  replace('        return { localRouteEnabled:', pending+'        return { pendingPlacementQuantity, localRouteEnabled:')
  before="phase: assembly?.phase ?? 'NOT_STARTED', lines, route,"
  after="phase: assembly?.phase ?? 'NOT_STARTED', lines: lines.map(l => { const pending = Math.min(l.remaining, waitingBySku.get(l.skuId) ?? 0); waitingBySku.set(l.skuId, (waitingBySku.get(l.skuId) ?? 0) - pending); return { ...l, pendingPlacementQuantity: pending }; }), route,"
  replace(before,after)
  anchor='                    const palletCode = location.storagePlacement?.pallet.code ?? location.pallet?.code;'
  replace(anchor,'''                    if (require("../../common/stock/wb-order-stock-lifecycle").wbOrderStockLifecycleEnabled() && r.client.stockBalanceMode === 'PALLET_SORT' && !location.storagePlacement)
                        throw new common_1.ConflictException('Товар принят, ожидает размещения на палет-сорте. Разместите короб и обновите маршрут ФБО.');
'''+anchor)
  p.write_text(live,encoding='utf8');print(n,'additive runtime placement gates');continue
 if n=='modules/stock/stock.controller.js':
  anchor='    async downloadStorageOverviewXlsx('
  start=new.index('    recordCabinetExport(');end=new.index(anchor,start)
  method=new[start:end].replace('common_2.', 'common_1.')
  assert live.count(anchor)==1
  live=live.replace(anchor,method+anchor,1)
  anchor='const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");'
  assert live.count(anchor)==1
  live=live.replace(anchor,'const cabinet_stock_export_dto_1 = require("./dto/cabinet-stock-export.dto");\n'+anchor,1)
  anchor='exports.StockController = StockController'
  pos=live.rfind(anchor);assert pos>0
  decorate='''__decorate([
    (0, common_1.Post)('cabinet-export-audit'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [cabinet_stock_export_dto_1.CabinetStockExportDto, Object, Object]),
    __metadata("design:returntype", void 0)
], StockController.prototype, "recordCabinetExport", null);
'''
  live=live[:pos]+decorate+live[pos:];p.write_text(live,encoding='utf8');print(n,'additive route');continue
 for g in difflib.SequenceMatcher(None,old.splitlines(True),new.splitlines(True),autojunk=False).get_grouped_opcodes(1):
  a,b=g[0][1],g[-1][2];c,d=g[0][3],g[-1][4]
  before=''.join(old.splitlines(True)[a:b]);after=''.join(new.splitlines(True)[c:d])
  if live.count(before)!=1:
   (r/(Path(n).stem+'-unmatched.txt')).write_text(before,encoding='utf8');raise Exception('Runtime anchor mismatch '+n+' '+str(live.count(before)))
  changes.append((before,after))
 for before,after in reversed(changes):live=live.replace(before,after,1)
 p.write_text(live,encoding='utf8');print(n,len(changes),'verified blocks')
