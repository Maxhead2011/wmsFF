import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.DURAK_QA_BROWSER||'msedge'});
const errors=[],failures=[];
await mkdir('build/qa',{recursive:true});
try {
  for(const width of [1440,768,375]) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
    const base=process.env.DURAK_QA_URL||'http://127.0.0.1:4197/durak/';
    await page.goto(base);
    const release=await (await page.request.get(new URL('release.json',base).href)).json();
    if(release.windows){
      // TEST: verify actual download headers without downloading gigabytes during every UI run.
      await page.locator('#download').waitFor({state:'visible'});
      const url=await page.locator('#download').getAttribute('href');
      assert.equal(new URL(url).origin,new URL(base).origin);
      const head=await page.request.head(url);
      assert.equal(head.status(),200);
      assert.equal(Number(head.headers()['content-length']),release.windows.bytes);
    }else await page.locator('#download-status').filter({hasText:'готовится'}).waitFor();
    await page.screenshot({path:`build/qa/lobby-${width}.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Lobby overflows');
    await page.getByRole('button',{name:'Сесть за стол'}).click();
    await page.locator('#hand button').first().waitFor();
    await page.screenshot({path:`build/qa/table-${width}.png`,fullPage:true});
    assert.equal(await page.locator('#hand button img').count(),6);
    assert.equal(await page.locator('#hand img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),true,'Card art did not load');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Table overflows');
    for(let turn=0;turn<6;turn++) {
      const playable=page.locator('#hand button:not(:disabled)');
      if(await playable.count()) await playable.first().click();
      else if(await page.locator('#take').isEnabled()) await page.locator('#take').click();
      else if(await page.locator('#pass').isEnabled()) await page.locator('#pass').click();
      // TEST: a bounded UI wait observes the bot, not production traffic or credentials.
      await page.waitForTimeout(900);
    }
    await page.locator('#new-game').click();await page.locator('#restart-dialog').waitFor({state:'visible'});
    await page.getByRole('button',{name:'Продолжить игру',exact:true}).click();
    assert.equal(await page.locator('#restart-dialog').isVisible(),false);
    await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  await writeFile('build/qa/results.json',JSON.stringify({viewports:[1440,768,375],errors,failures,gameMoves:true,cardImages:true,overflow:false,visualBaseline:'not established'},null,2));
  console.log('BROWSER_QA_PASS');
}finally{await browser.close();}
