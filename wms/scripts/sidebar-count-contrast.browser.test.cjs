const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// TEST: computed sidebar badge colors must remain readable through the theme cascade.
const root=path.resolve(__dirname,'../apps/web/src');
function lum(rgb){const c=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage();
for(const style of ['light','dark'])for(const variant of ['la_panthera']){
await page.setContent(`<html data-ui-style="${style}" data-ui-theme="modern" data-ui-variant="${variant}"><body><div class="app-layout" data-ui-theme="modern" data-ui-variant="${variant}"><aside class="app-sidebar"><div class="app-sidebar__footer"><span>Доступно разделов</span><strong>37</strong></div></aside></div></body></html>`);
await page.addStyleTag({path:path.join(root,'styles.css')});
for(const file of fs.readdirSync(path.join(root,'components/layout')).filter(n=>n.endsWith('-theme.css')))await page.addStyleTag({path:path.join(root,'components/layout',file)});
for(const file of ['la-panthera-light.css','la-panthera-light-tuning.css'])await page.addStyleTag({path:path.join(root,'components/layout',file)});
const colors=await page.locator('.app-sidebar__footer strong').evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
const a=lum(colors.fg),b=lum(colors.bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);console.log(variant,colors,ratio);assert.ok(ratio>=4.5,variant+' badge contrast '+ratio);
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
