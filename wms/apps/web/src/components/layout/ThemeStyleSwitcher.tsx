import * as React from 'react';
import {readThemeStyle,saveThemeStyle,type ThemeStyle} from './themeStyle';
import {isMagicStyle, magicEnabled} from './magicAppearanceState';
import {MagicAppearance} from './MagicAppearance';
// FIX: keyed by user, with host isolation and cleanup on theme change/logout.
export function ThemeStyleSwitcher({userId, workspaceId = ''}:{userId:string; workspaceId?:string}) {
 const enabled = magicEnabled(window.location.hostname);
 const [selected,setStyle]=React.useState<ThemeStyle>(()=>readThemeStyle(userId));
 const style = !enabled && isMagicStyle(selected) ? 'dark' : selected;
 React.useLayoutEffect(()=>{
  document.documentElement.dataset.uiStyle=isMagicStyle(style)?'light':style;
  if(isMagicStyle(style)) document.documentElement.dataset.uiMagic=style;
  return ()=>{delete document.documentElement.dataset.uiStyle; delete document.documentElement.dataset.uiMagic;};
 },[style]);
 return <><label className="ui-theme-switcher ui-style-switcher" title="Выбрать стиль оформления">
  <span>Стиль оформления</span>
  <select aria-label="Стиль оформления" value={style} onChange={event=>{
   const value=event.target.value;
   const next:ThemeStyle=value==='light'||(enabled&&(value==='winx'||value==='disney'))?value:'dark';
   setStyle(next);saveThemeStyle(userId,next);
  }}><option value="dark">Dark</option><option value="light">Light</option>
  {enabled&&<><option value="winx">Winx</option><option value="disney">Disney</option></>}
  </select>
 </label>{isMagicStyle(style)&&<MagicAppearance key={style} style={style} workspaceId={workspaceId}/>}</>;
}
