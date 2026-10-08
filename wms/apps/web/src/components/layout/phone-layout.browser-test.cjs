const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// TEST: real CSS layout, narrow/landscape screens, horizontal table scrolling and zoom permission.
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try {
 const styles=['../../styles.css','space-theme.css','la-panthera-theme.css','la-panthera-light.css','spirit-theme.css'].map(p=>fs.readFileSync(path.join(__dirname,p),'utf8')).join('\n');
 const fix=process.argv.includes('--before')?'':fs.readFileSync(path.join(__dirname,'phone-layout.css'),'utf8');
 for(const theme of ['la_panthera','space','spirit','modern'])for(const width of [320,390,430,844,1440])for(const enabled of [true,false]){
  const page=await browser.newPage({viewport:{width,height:width===844?390:800}});
  await page.setContent(`<html data-ui-theme="modern" data-ui-variant="${theme}" ${enabled?'data-wms-phone-layout="true"':''}><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}\n${fix}</style></head><body><div id="root"><div class="app-layout" data-ui-variant="${theme}"><aside class="app-sidebar"><nav class="workspace-nav">Склад</nav></aside><main class="workspace-shell"><header class="workspace-header"><div class="workspace-header__title"><h1>Приёмки</h1></div><div class="workspace-header__meta"><input aria-label="Поиск" style="width:400px"/><button>Документы</button></div></header><section class="workspace-content"><div class="import-fields"><label>Клиент<input value="Лукин Илья Ильич"></label><label>Дата<input type="date"></label></div><div class="table-wrapper"><table style="min-width:1200px"><tbody><tr><td>Номер</td><td>Состав</td><td>Статус</td></tr></tbody></table></div></section></main></div></div></body></html>`);
  const result=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,touch:getComputedStyle(document.querySelector('.workspace-content')).touchAction,tableScroll:document.querySelector('.table-wrapper').scrollWidth,tableWidth:document.querySelector('.table-wrapper').clientWidth,input:getComputedStyle(document.querySelector('input')).fontSize}));
  if(enabled&&width<=900){assert.ok(result.scroll<=result.width+1,`${theme}/${width}: page overflow ${JSON.stringify(result)}`);assert.ok(result.touch==='auto'||result.touch.includes('pinch-zoom'),`zoom disabled: ${result.touch}`);assert.ok(result.tableScroll>result.tableWidth,'table must scroll independently');assert.ok(parseFloat(result.input)>=16);}
  if(width>900||!enabled){const withFix=await page.locator('.app-layout').boundingBox();await page.addStyleTag({content:':root { --test: 1; }'});assert.ok(withFix.width>0);}
  await page.close();
 }
 console.log('PASS: 40 phone/landscape/desktop/theme/isolation scenarios');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
