export type ThemeStyle = 'dark' | 'light' | 'winx' | 'disney';
type StyleStorage = Pick<Storage,'getItem'|'setItem'>;
export function themeStyleKey(userId:string) { return `logoff-wms-ui-style:la_panthera:${userId}`; }
// FIX: no cross-user writes, and private-browser storage failures cannot break navigation.
export function readThemeStyle(userId:string,storage?:StyleStorage):ThemeStyle {
 try { const value=(storage??window.localStorage).getItem(themeStyleKey(userId)); return value==='light'||value==='winx'||value==='disney'?value:'dark'; } catch { return 'dark'; }
}
export function saveThemeStyle(userId:string,style:ThemeStyle,storage?:StyleStorage) {
 try { (storage??window.localStorage).setItem(themeStyleKey(userId),style); } catch { /* Keep the selection for this session. */ }
}
