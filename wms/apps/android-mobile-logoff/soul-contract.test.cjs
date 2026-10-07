const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
// TEST: a two-stage FBO response must not fall through to the legacy empty screen.
test('online assembly renders the server FBO plan before legacy assembly',()=>{
 const ui=read('app/src/main/java/pro/logoff/wms/mobile/ui/OnlineAssemblyFragment.java');
 assert.ok(ui.includes('map(plan.get("fbo"))'));
 assert.ok(ui.indexOf('renderFboAssembly(content, fbo)') < ui.indexOf('renderRegularAssembly(content, plan)'));
 for(const field of ['plannedNeeded','picked','packed','lines','boxes','pickedUnits']) assert.ok(ui.includes(`fbo.get("${field}")`));
});
// TEST: unknown server settings cannot silently be converted into defaults by the UI.
test('client settings use typed controls and verified DTO fields',()=>{
 const policy=read('app/src/main/java/pro/logoff/wms/mobile/ui/ClientSettingsPolicy.java');
 const ui=read('app/src/main/java/pro/logoff/wms/mobile/ui/ClientEditorFragment.java');
 const dto=read('../api/src/modules/clients/dto/create-client.dto.ts');
 for(const field of ['storageAccountingEnabled','storesWithoutBoxes','onlineReceiptVisibleToClient','fbsCalculatorEnabled','relabelingEnabled','clientKind','stockBalanceMode','logisticsInvoiceMode','storageBillingMode']){
  assert.ok(policy.includes(`"${field}"`));assert.match(dto,new RegExp(`\\b${field}[?!]:`));
 }
 assert.ok(ui.includes('ClientSettingsPolicy.supported'));assert.ok(ui.includes('settingsInput()'));
 assert.ok(ui.includes('flags.clear()'));assert.ok(ui.includes('choices.clear()'));
});
// TEST: catalogue editing must use native UI, fresh reads and existing protected endpoints.
test('catalog editor is native and scoped',()=>{
 const api=read('app/src/main/java/pro/logoff/wms/mobile/network/MobileApi.java');
 assert.ok(api.includes('@PATCH("skus/{id}")'));
 const ui=read('app/src/main/java/pro/logoff/wms/mobile/ui/SkuEditorFragment.java');
 for(const guard of ['skus:write','currentScope','generation','SkuEditPolicy.matches','skuDetails(id)'])assert.ok(ui.includes(guard));
 assert.ok(read('app/src/main/java/pro/logoff/wms/mobile/ui/NativeModuleFragment.java').includes('SkuEditorFragment.create'));
});
// TEST: editing client details requires a fresh authenticated read and server write permission.
test('client editor uses scoped existing client API',()=>{
 const api=read('app/src/main/java/pro/logoff/wms/mobile/network/MobileApi.java');
 assert.ok(api.includes('@PATCH("clients/{id}")'));
 const ui=read('app/src/main/java/pro/logoff/wms/mobile/ui/ClientEditorFragment.java');
 assert.ok(ui.includes('clients:write'));assert.ok(ui.includes('ClientEditPolicy.delta'));assert.ok(ui.includes('ClientEditPolicy.matches'));assert.ok(ui.includes('epoch==generation'));
});
// TEST: financial writes require server preview and durable identity before sending.
test('financial actions use existing guarded server mutations',()=>{
 const api=read('app/src/main/java/pro/logoff/wms/mobile/network/MobileApi.java');
 for(const route of ['period-close/preview','period-close','period-close/corrections/preview','period-close/corrections'])assert.ok(api.includes(`@POST("billing/${route}")`));
 const ui=read('app/src/main/java/pro/logoff/wms/mobile/ui/FinancialActionsFragment.java');
 const persist=ui.slice(ui.indexOf('private void persist('),ui.indexOf('@SuppressWarnings("unchecked") private void sendSaved'));
 assert.ok(persist.indexOf('prefs.edit().putString')<persist.indexOf('sendSaved()'));
 assert.ok(ui.includes('previewHash'));assert.ok(ui.includes('operationKey'));assert.ok(ui.includes('sameScope'));
 assert.ok(ui.includes('epoch!=generation'));
 assert.ok(ui.includes('busy||pending()||!enabled||!validScope()'));
 assert.ok(ui.includes('prefs.edit().remove(user).commit()'));
});
// TEST: correction history is read-only and must not claim a date-filtered server result.
test('native correction history uses GET and bounded rendering',()=>{
 const api=read('app/src/main/java/pro/logoff/wms/mobile/network/MobileApi.java');
 assert.match(api,/@GET\("billing\/period-close\/corrections"\)/);
 assert.match(api,/Call<List<Map<String,Object>>> invoiceCorrections/);
 const ui=read('app/src/main/java/pro/logoff/wms/mobile/ui/SettlementsFragment.java');
 assert.match(ui,/invoiceCorrections\(client,from,to\)/);
 assert.match(ui,/Последние корректировки за все даты/);
 assert.match(ui,/CorrectionHistoryPresentation.page/);
});
// TEST: the isolated application cannot produce a sold tenant release.
test('LOGOFF-only build preserves application identity',()=>{
 const text=read('app/build.gradle.kts');
 assert.match(text,/applicationId = "pro.logoff.wms.mobile"/);
 assert.doesNotMatch(text,/create\("(?:ffullhab|dmitry)"\)/);
});
test('Soul is a native screen, reachable from home',()=>{
 const text=read('app/src/main/java/pro/logoff/wms/mobile/ui/SoulHomeFragment.java');
 assert.doesNotMatch(text,/WebView|loadUrl/);
 assert.match(read('app/src/main/java/pro/logoff/wms/mobile/MainActivity.java'),/new SoulHomeFragment\(\)/);
});
test('new financial API uses existing authenticated client',()=>{
 const text=read('app/src/main/java/pro/logoff/wms/mobile/network/MobileApi.java');
 assert.match(text,/@GET\("billing\/settlements"\)/);
 assert.match(text,/@GET\("billing\/period-close"\)/);
 assert.match(text,/Call<List<Map<String,Object>>> closedPeriods/);
 for(const name of ['clientId','periodFrom','periodTo']) assert.ok(text.includes(`@Query("${name}")`));
});
// TEST: lost command responses cannot enable automatic command replay.
test('OpenClaw persists job identity and only GETs when checking',()=>{
 const text=read('app/src/main/java/pro/logoff/wms/mobile/ui/OpenClawFragment.java');
 assert.ok(text.indexOf('.commit()')<text.indexOf('api.submitOpenClaw(body)'));
 assert.match(text,/api.openClawJob\(requestId\)/);
 assert.match(text,/if\(!allowed\|\|requestId!=null/);
 assert.doesNotMatch(read('app/src/main/java/pro/logoff/wms/mobile/ui/MoreFragment.java'),/AiChatFragment.newInstance/);
});
test('new financial views cancel old requests when client or period changes',()=>{
 const text=read('app/src/main/java/pro/logoff/wms/mobile/ui/SettlementsFragment.java');
 assert.match(text,/request!=generation/);
 assert.match(text,/current!=generation/);
 assert.match(text,/historyCall.cancel\(\)/);
 assert.match(text,/selectedClientId\(\)/);
});
test('camera is optional and screens cannot embed a website',()=>{
 assert.match(read('app/src/main/AndroidManifest.xml'),/android.hardware.camera" android:required="false"/);
 const root=path.join(__dirname,'app/src/main/java');
 for(const name of fs.readdirSync(root,{recursive:true})) if(name.endsWith('.java')) {
   assert.doesNotMatch(fs.readFileSync(path.join(root,name),'utf8'),/import android\.webkit\.|new WebView\(/,name);
 }
});
test('explicit server rejection releases pending input without replay',()=>{
 const text=read('app/src/main/java/pro/logoff/wms/mobile/ui/OpenClawFragment.java');
 assert.ok(text.includes('OpenClawResultPolicy.definitelyRejected(code)'));
 assert.ok(text.includes('input.setText(message)'));
});
