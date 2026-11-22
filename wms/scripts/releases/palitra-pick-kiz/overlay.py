"""Apply the four reviewed edits to the deployed JS, preserving other runtime changes."""
from pathlib import Path
def prepare(root):
    src=root/'api-live'
    dst=root/'api-payload'
    def patch(name,anchor,replacement):
        path=src/(name+'.js')
        text=path.read_bytes().decode()
        assert text.count(anchor)==1,name
        output=dst/(name+'.js');output.parent.mkdir(parents=True,exist_ok=True)
        output.write_bytes(text.replace(anchor,replacement).encode())
    helper="require('../../common/palitra-pick-kiz')"
    enabled=helper+".palitraPickEnabled"
    bind=helper+".bindNewPickMark"
    a='require("./fbo-known-kiz").requireKnownFboKiz(previous);'
    patch('modules/tsd/fbo-two-stage.service',a,
          f"if (!previous && {enabled}(r.clientId)) {{const created=await {bind}(tx,{{clientId:r.clientId,skuId,boxId,warehouseId:r.warehouseId,kiz}},r.id); await clientKizReview.refreshClientKizClaim(tx,guardInput,created); return created;}}\n        "+a)
    a='const mark = dto.kiz ? await exactMark(tx, dto.kiz) : null;'
    patch('modules/tsd/fbo-unboxed-picking',a,
          f"const mark = dto.kiz && {enabled}(r.clientId) ? await require('../../common/kiz-client-review').clientPhysicalMark(tx,r.clientId,dto.kiz) ?? await {bind}(tx,{{clientId:r.clientId,skuId:line.skuId,boxId:null,warehouseId:r.warehouseId,kiz:dto.kiz}},r.id) : dto.kiz ? await exactMark(tx,dto.kiz) : null;")
    a='const mark = await (0, kiz_client_review_1.clientPhysicalMark)(tx, fresh.clientId, pick.kiz);'
    patch('modules/marketplace-connections/ozon-fbs-pick-workflow',a,a[:-1]+
          f" ?? ({enabled}(fresh.clientId) ? await {bind}(tx,{{clientId:fresh.clientId,skuId:line.skuId,boxId:pick.boxId,warehouseId:await service.resolveFbsTsdExpectedWarehouseId(fresh),kiz:pick.kiz}},fresh.requestId) : null);")
    a="// FIX: another unit's registered KIZ is not evidence of a stale record."
    patch('modules/marketplace-connections/marketplace-connections.service',a,
          f"if ({enabled}(task.clientId)) {{ const bound=await {bind}(tx,{{clientId:task.clientId,skuId:task.skuId,boxId:task.boxId,warehouseId:await this.resolveFbsTsdExpectedWarehouseId(task),kiz}},task.requestId); await tx.fbsTsdAssembly.update({{where:{{id:task.id}},data:{{kiz,wbMetaStatus:'PENDING',errorMessage:null}}}}); return {{mode:'CREATED',id:bound.id}}; }}\n                    "+a)
