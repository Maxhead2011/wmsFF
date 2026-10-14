import {expect,it} from 'vitest';
import {ozonCabinetLabel} from './OzonLinkImport';
// TEST: unnamed connected accounts still identify their legal owner.
it('labels both managed accounts with owner and seller number',()=>{
 expect(ozonCabinetLabel({accountName:null,sellerId:'2704545'},'ИП Королев Максим Алексеевич')).toBe('ИП Королев Максим Алексеевич · 2704545');
 expect(ozonCabinetLabel({accountName:null,sellerId:'3308562'},'ИП Королева О. А.')).toBe('ИП Королева О. А. · 3308562');
});
it('keeps an additional account name without repeating the owner',()=>{
 expect(ozonCabinetLabel({accountName:'Магазин',sellerId:'123'},'Клиент')).toBe('Клиент · Магазин · 123');
 expect(ozonCabinetLabel({accountName:'Клиент',sellerId:'123'},'Клиент')).toBe('Клиент · 123');
});
