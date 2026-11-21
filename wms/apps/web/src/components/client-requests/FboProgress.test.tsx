import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {FboProgress} from './FboProgress';
const plan={needed:1092,picked:1092,packed:721,lines:[],route:[],boxes:[],wholeBoxes:[],pickedUnits:[],boxStatistics:{remainingWholeBoxes:8,pickedBoxes:24,packedBoxes:12,partialUnits:92,wholeBoxes:20}};
// TEST: summary history can be empty while server totals remain visible beneath both meters.
it('shows all four counts without inferring them from paginated history',()=>{
 const html=renderToStaticMarkup(<FboProgress plan={plan as any}/>);
 for(const text of ['Осталось упаковать целых коробов: 8','Отобрано коробов: 24','Упаковано коробов: 12','Частичный отбор — 92 ед.','Целыми коробами — 20 коробов'])expect(html).toContain(text);
 expect(html.indexOf('Отобрано коробов: 24')).toBeGreaterThan(html.indexOf('</meter>'));
});
it('keeps legacy installations unchanged when statistics are absent',()=>{
 const html=renderToStaticMarkup(<FboProgress plan={{...plan,boxStatistics:undefined} as any}/>);expect(html).not.toContain('Отобрано коробов:');expect(html).not.toContain('Частичный отбор');
});

// TEST: zero remains explicit and older responses do not falsely imply zero.
it('shows zero remaining whole boxes only when reported by the server',()=>{
 const render=(boxStatistics:any)=>renderToStaticMarkup(<FboProgress plan={{...plan,boxStatistics} as any}/>);
 expect(render({...plan.boxStatistics,remainingWholeBoxes:0})).toContain('Осталось упаковать целых коробов: 0');
 expect(render({...plan.boxStatistics,remainingWholeBoxes:undefined})).not.toContain('Осталось упаковать целых коробов:');
});
