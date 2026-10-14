import {describe,it,expect} from 'vitest';
import {magicEnabled,nextWallpaperIndex,wallpapers,welcomeStyle} from './magicAppearanceState';
// TEST: host boundary, complete collections and random no-repeat contract.
describe('magic appearance',()=>{
 it('isolates our host from sold and lookalike domains',()=>{
  expect(magicEnabled('wms.logoff.pro')).toBe(true);
  for(const host of ['sold.logoff.pro','wms.logoff.pro.example','example.com',''])expect(magicEnabled(host)).toBe(false);
 });
 it('includes all supplied images once',()=>{
  expect(wallpapers('winx')).toHaveLength(13);expect(wallpapers('disney')).toHaveLength(20);
  expect(new Set([...wallpapers('winx'),...wallpapers('disney')]).size).toBe(33);
 });
 it('never repeats the visible wallpaper including random endpoints',()=>{
  for(const count of [13,20])for(let previous=0;previous<count;previous++)for(const random of [0,.01,.5,.99,1]){
   const next=nextWallpaperIndex(count,previous,random);expect(next).not.toBe(previous);expect(next).toBeGreaterThanOrEqual(0);expect(next).toBeLessThan(count);
  }
  expect(nextWallpaperIndex(1,0)).toBe(0);
 });
 it('uses only confirmed identity/name for welcome',()=>{
  expect(welcomeStyle({id:'d65d6258-d4e8-4bc1-b1cf-583d1a1e4c82',name:'Элеонора'})).toBe('winx');
  expect(welcomeStyle({id:'another',name:' София '})).toBeNull();
  expect(welcomeStyle({id:'another',name:'София другая'})).toBeNull();
  expect(welcomeStyle({id:'another',name:'Соня'})).toBeNull();
 });
});

// TEST: production Sofia login is stored under a different display name.
it('recognizes Sofia by verified account ID',()=>{expect(welcomeStyle({id:'f89c0efe-dcd2-4dfa-9cea-e35c0c492f83',name:'Sonya'})).toBe('disney');});
