"""FIX: apply only unique compiled anchors to the verified live baseline."""
import pathlib,json,difflib,hashlib,sys
r=pathlib.Path(sys.argv[1]);proof={};failures=[]
for entry in json.loads((r/'delta-files.json').read_text()):
 rel=entry['path'];after=(r/'after'/rel).read_text(encoding='utf-8')
 if entry['status']=='A':
  assert not (r/'candidate'/rel).exists(),rel
  result=after;original=''
 else:
  before=(r/'before'/rel).read_text(encoding='utf-8');original=(r/'api'/rel).read_bytes().decode('utf-8');result=original
  for g in reversed(list(difflib.SequenceMatcher(None,before.splitlines(True),after.splitlines(True)).get_grouped_opcodes(2))):
   a=before.splitlines(True);b=after.splitlines(True)
   old=''.join(a[g[0][1]:g[-1][2]]);new=''.join(b[g[0][3]:g[-1][4]])
   if result.count(old)!=1 and result.count(old.replace('\n','\r\n'))==1:
    result=result.replace(old.replace('\n','\r\n'),new.replace('\n','\r\n'),1);continue
   if result.count(old)!=1:
    # FIX: reviewed adaptations retain all published routes, scope and stock behavior.
    if len([line for line in new.splitlines(True) if line not in old.splitlines(True)])==1 and [line for line in new.splitlines(True) if line not in old.splitlines(True)][0].startswith('const ') and 'require(' in [line for line in new.splitlines(True) if line not in old.splitlines(True)][0]:
     added=[line for line in new.splitlines(True) if line not in old.splitlines(True)]
     assert len(added)==1 and added[0].startswith('const '),rel
     marker='Object.defineProperty(exports, "__esModule", { value: true });'
     assert result.count(marker)==1
     result=result.replace(marker,marker+'\n'+added[0],1);continue
    if rel.endswith('administration-internal-api.service.js'):
     start=result.index("id: 'clients',");end=result.index("id: 'contracts',",start);section=result[start:end]
     section=section.replace("'/clients/:clientId/product-display']","'/clients/:clientId/product-display', '/clients/:clientId/stores']")
     assert section.count('routeCount: 10,')==1
     section=section.replace('routeCount: 10,','routeCount: 14,')
     result=result[:start]+section+result[end:];continue
    if rel.endswith('client-requests.service.js') and 'const stores =' in new:
     marker="        const progressLabels = await require('../tsd/fbo-progress-status').fboProgressLabels"
     assert result.count(marker)==1
     result=result.replace(marker,"        const stores = await request_store_context_1.requestStoreContexts(this.prisma, requests);\n        for (const request of requests) if (stores.has(request.id)) Object.assign(request, stores.get(request.id));\n"+marker,1);continue
    if rel.endswith('marketplace-connections.controller.js') and 'async listFbsOrders' in old:
     start=result.index('    async listFbsOrders(');end=result.index('\n    }',start);section=result[start:end]
     assert section.count('const result = view')==1 and 'allBranches' in section and 'displayWarehouseId' in section
     section=section.replace('const result = view','const scoped = view',1).replace('        return { ...result,','        const result = this.stores ? await this.stores.decorateOrders(clientId, scoped, user) : scoped;\n        return { ...result,',1)
     result=result[:start]+section+result[end:];continue
    if rel.endswith('marketplace-connections.module.js'):
     marker='imports: [auth_module_1.AuthModule, logistics_module_1.LogisticsModule, client_notifications_module_1.ClientNotificationsModule]'
     assert result.count(marker)==1
     result=result.replace(marker,marker.replace('auth_module_1.AuthModule,','auth_module_1.AuthModule, clients_module_1.ClientsModule,'),1);continue
    if rel.endswith('fbo-two-stage.service.js') and 'storeContexts' in new:
     marker='        return { alternativePickingSupported: require("./fbo-alternative-picking").alternativeFboPickingEnabled(),'
     assert result.count(marker)==1
     result=result.replace(marker,'        const storeContexts = await request_store_context_1.requestStoreContexts(tx, [r]);\n'+marker.replace('return {','return { ...storeContexts.get(r.id),'),1);continue
    if rel.endswith('tsd-payload.parser.js'):
     start=result.index('    parseReceiptPayload(payload)');end=result.index('    parseInventoryPayload',start);section=result[start:end]
     assert section.count('            clientId,')==1
     section=section.replace('            clientId,','            clientId,\n            storeId: this.optionalStringValue(payload.storeId),',1)
     result=result[:start]+section+result[end:];continue
    failures.append({'path':rel,'anchor':old,'replacement':new});continue
   result=result.replace(old,new,1)
 out=r/'api-payload'/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(result.encode('utf-8'))
 proof[rel]={'before':hashlib.sha256(original.encode()).hexdigest(),'after':hashlib.sha256(result.encode()).hexdigest()}
(r/'anchor-failures.json').write_text(json.dumps(failures,ensure_ascii=False,indent=2),encoding='utf-8')
(r/'api-delta-proof.json').write_text(json.dumps(proof,indent=2))
print('Modules:',len(proof),'unmatched anchors:',len(failures))
if failures:raise SystemExit(1)
