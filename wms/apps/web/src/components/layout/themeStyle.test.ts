import {describe,it,expect} from 'vitest';
import {readThemeStyle,saveThemeStyle,themeStyleKey} from './themeStyle';
// TEST: preferences are isolated per user, default to Dark and tolerate unavailable storage.
describe('la_panthera style preference',()=>{
 // TEST: new selections must survive reload rather than silently falling back to Dark.
 it.each(['winx','disney'])('restores %s',style=>{expect(readThemeStyle('a',{getItem:()=>style,setItem:()=>{}})).toBe(style);});
 const storage=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
 it('defaults to the existing Dark appearance',()=>expect(readThemeStyle('a',storage())).toBe('dark'));
 it('persists Light only for its user',()=>{const s=storage();saveThemeStyle('a','light',s);expect(readThemeStyle('a',s)).toBe('light');expect(readThemeStyle('b',s)).toBe('dark');saveThemeStyle('a','dark',s);expect(readThemeStyle('a',s)).toBe('dark');});
 it('ignores invalid values and storage errors',()=>{const s=storage();s.setItem(themeStyleKey('a'),'invalid');expect(readThemeStyle('a',s)).toBe('dark');const denied={getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')}};expect(readThemeStyle('a',denied)).toBe('dark');expect(()=>saveThemeStyle('a','light',denied)).not.toThrow();});
});
