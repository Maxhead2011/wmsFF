// TEST: cold production entry, without replacing the application or mocking its modules.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(process.argv[2]),candidate=process.argv.includes('--candidate');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[],cores=new Set();let passed=0;
try{for(let attempt=0;attempt<3;attempt++){
 const context=await browser.newContext();
 if(candidate)await context.route('https://wms.logoff.pro/',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'index.html'))}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/\/assets\/(receipt-progress|ozon-label-history-core)-20261030\.js$/.test(r.url()))cores.add(r.url());});
 await page.goto('https://wms.logoff.pro/#login');await page.getByRole('button',{name:'Войти',exact:true}).waitFor({timeout:20000});
 await page.waitForTimeout(1500);assert.equal(errors.length,0,errors.join('\n'));assert.equal(cores.size,1,'Only one application entry may execute');passed++;
 await page.reload();await page.getByRole('button',{name:'Войти',exact:true}).waitFor();await page.waitForTimeout(500);assert.equal(errors.length,0,errors.join('\n'));passed++;
 await context.close();
}fs.writeFileSync(path.join(root,candidate?'candidate-browser.json':'public-browser.json'),JSON.stringify({passed,errors,cores:[...cores]}));console.log({passed,errors,cores:[...cores]});
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
