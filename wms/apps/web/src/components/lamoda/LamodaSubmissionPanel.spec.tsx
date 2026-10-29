import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {LamodaSubmissionPanel,lamodaShipmentStatus} from './LamodaSubmissionPanel';
it('explains Lamoda statuses and preserves unknown future values',()=>{expect(lamodaShipmentStatus('VALIDATION_ERROR')).toBe('Ошибка проверки Lamoda');expect(lamodaShipmentStatus('CLOSED')).toBe('Закрыта');expect(lamodaShipmentStatus('FUTURE')).toBe('FUTURE');});
// TEST: no send control exists until scoped assembly data and preview are loaded.
it('does not offer blind submission on initial render',()=>{
 const html=renderToStaticMarkup(<LamodaSubmissionPanel token="test" accountId="a" requestId="r" canWrite={true}/>);
 expect(html).toContain('Поставка Lamoda по факту сборки');
 expect(html).not.toContain('Создать поставку в Lamoda');
 expect(html).toContain('ЭДО');
});
