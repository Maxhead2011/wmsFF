import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WbStockSettingsCards } from './WbStockSettingsCards';
// TEST: presentation preserves reserve and recommendation controls; confirmation gets its own navigation.
it('separates controls into cards and links to confirmation when available', () => {
 const html=renderToStaticMarkup(<WbStockSettingsCards reserve={<input aria-label="Резерв" defaultValue={3}/>} publicationEnabled recommendations={<button>Сохранить шаг</button>} onOpenConfirmation={()=>{}} />);
 expect(html).toContain('Страховой резерв'); expect(html).toContain('value="3"'); expect(html).toContain('Сохранить шаг'); expect(html).toContain('Подтверждение остатков WB'); expect(html).not.toContain('<table'); expect(html).not.toContain('<details open');
});
it('does not advertise confirmation when capability is disabled',()=>{
 const html=renderToStaticMarkup(<WbStockSettingsCards reserve="3 шт." publicationEnabled={false} recommendations="Мало данных"/>);
 expect(html).toContain('Отправка выключена'); expect(html).not.toContain('Подтверждение остатков WB');
});
