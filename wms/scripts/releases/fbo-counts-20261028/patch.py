# FIX: add only verified new handlers; preserve all other deployed methods and metadata.
from pathlib import Path
import json,sys
r=Path(sys.argv[1])
for n,v in json.loads((r/'compiled.json').read_text(encoding='utf-8')).items():
 s=(r/'api-base'/n).read_text(encoding='utf-8')
 def rep(a,b):
  global s
  assert s.count(a)==1,(n,a[:100]);s=s.replace(a,b,1)
 if n.endswith('administration-internal-api.service.js'):
  rep('routeCount: 57,','routeCount: 58,')
  a="logic: ['Создаёт и изменяет заявки.',"
  rep(a,a+" 'Считает активные заявки FBO WB/Ozon с учётом доступа и филиала.',")
 elif n.endswith('client-requests.service.js'):
  method=v['next'].split('    async activeFboCounts(user) {',1)[1].split('    async list(query, user) {',1)[0]
  rep('    async list(query, user) {','    async activeFboCounts(user) {'+method+'    async list(query, user) {')
 elif n.endswith('client-requests.controller.js'):
  rep('    boxOverlaps(user) {','    activeFboCounts(user) { return this.clientRequests.activeFboCounts(user); }\n    boxOverlaps(user) {')
  anchor="__decorate([\n    (0, common_1.Get)('box-overlaps'),"
  extra="""__decorate([(0, common_1.Get)('fbo-active-counts'), __param(0, (0, current_user_decorator_1.CurrentUser)()), __metadata("design:type", Function), __metadata("design:paramtypes", [Object]), __metadata("design:returntype", void 0)], ClientRequestsController.prototype, "activeFboCounts", null);\n"""
  rep(anchor,extra+anchor)
 else:raise AssertionError(n)
 p=r/'candidate-current'/n;p.write_bytes(s.encode())
 out=r/'api/payload'/n;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(s.encode())
