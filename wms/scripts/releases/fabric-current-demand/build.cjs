const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(process.argv[2], 'modules', 'warehouse');
const target = path.join(dir, 'fabric-rolls.js');
const anchor = '  // Confirmed shipment facts';
const original = fs.readFileSync(target, 'utf8');
if (original.split(anchor).length !== 2 || original.includes('./fabric-demand')) throw Error('Unexpected fabric runtime');
fs.copyFileSync(path.join(__dirname, 'fabric-demand.js'), path.join(dir, 'fabric-demand.js'));
fs.writeFileSync(target, original.replace(anchor, "  await require('./fabric-demand').addFabricDemand(this.db,id,byId,groups);\n" + anchor));
const modules = path.dirname(dir);
function patch(file, before, after) {
  const target = path.join(modules, file);
  const src = fs.readFileSync(target, 'utf8');
  if (before.includes('\n') && src.includes('\r\n')) before = before.replaceAll('\n', '\r\n');
  if (src.split(before).length !== 2) throw Error('Unexpected runtime: ' + file);
  fs.writeFileSync(target, src.replace(before, () => after));
}
fs.copyFileSync(path.join(__dirname, 'fabric-ozon-done.js'), path.join(dir, 'fabric-ozon-done.js'));
const accounting = 'warehouse/fabric-shipment-accounting.js';
patch(accounting,'clientId,userId=null){','clientId,userId=null,completedRequestId=null){');
patch(accounting,' const result=planShipments', " const ozone=require('./fabric-ozon-done');\n if(completedRequestId)await ozone.enrollOzon(tx,clientId,completedRequestId);\n events.push(...await ozone.ozonShipments(tx,clientId,skus));\n const result=planShipments");
patch(accounting,'if(c.taskId&&!fabricCreditMatches(c,e))','if(c.taskId&&!fabricCreditMatches(c,e)&&!require("./fabric-ozon-done").matchesOzonCut(c,e))');
patch(accounting,'if(!rolls.length)continue;', "if(!rolls.length && e.marketplace!=='OZON')continue;");
patch('stock/stock-operations.service.js','syncFabricShipments(tx,input.request.clientId,input.user.id)','syncFabricShipments(tx,input.request.clientId,input.user.id,input.request.id)');
patch('marketplace-connections/ozon-packed-auto-done.js','    return true;', "    await require('../warehouse/fabric-shipment-accounting').syncFabricShipments(tx,request.clientId,null,request.id);\n    return true;");
const recovery = "managerComment: dto.comment ?? 'Заявка сдана; списание ранее уже было выполнено.',\n                    },\n                });";
patch('stock/stock-operations.service.js', recovery, recovery + "\n                await require('../warehouse/fabric-shipment-accounting').syncFabricShipments(tx,request.clientId,user.id,request.id);");
