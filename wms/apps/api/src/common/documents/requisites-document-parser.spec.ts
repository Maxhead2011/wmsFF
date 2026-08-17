import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseRequisitesDocument } from './requisites-document-parser';

describe('parseRequisitesDocument', () => {
  it('extracts Russian company and bank requisites from xlsx', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Полное наименование', 'Общество с ограниченной ответственностью «Логистика Юг»'],
      ['Сокращенное наименование', 'ООО «Логистика Юг»'],
      ['ИНН', '2312345678'],
      ['КПП', '231201001'],
      ['ОГРН', '1232300001234'],
      ['Юридический адрес', '350000, г. Краснодар, ул. Северная, д. 1'],
      ['Наименование банка', 'ПАО СБЕРБАНК'],
      ['БИК', '044525225'],
      ['Расчетный счет', '40702810123450001234'],
      ['Корреспондентский счет', '30101810400000000225'],
      ['Телефон', '+7 (861) 222-33-44'],
      ['Email', 'office@example.ru'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Реквизиты');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const result = await parseRequisitesDocument({
      originalname: 'реквизиты.xlsx',
      buffer,
    } as Express.Multer.File);

    expect(result.sourceType).toBe('EXCEL');
    expect(result.fields).toMatchObject({
      clientKind: 'LEGAL_ENTITY',
      shortName: 'ООО «Логистика Юг»',
      fullName: 'Общество с ограниченной ответственностью «Логистика Юг»',
      inn: '2312345678',
      kpp: '231201001',
      ogrn: '1232300001234',
      bankName: 'ПАО СБЕРБАНК',
      bankBik: '044525225',
      bankAccount: '40702810123450001234',
      correspondentAccount: '30101810400000000225',
      email: 'office@example.ru',
    });
  });

  it('extracts labeled requisites from a text PDF', async () => {
    const pdfDocument = await PDFDocument.create();
    const page = pdfDocument.addPage([600, 800]);
    const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
    const lines = [
      'Company name: LOGOFF TEST LLC',
      'INN: 7712345678',
      'KPP: 771201001',
      'OGRN: 1237700001234',
      'BIK: 044525225',
      'Bank account: 40702810123450001234',
    ];
    lines.forEach((line, index) => page.drawText(line, { x: 40, y: 740 - index * 24, size: 12, font }));
    const buffer = Buffer.from(await pdfDocument.save({ useObjectStreams: false }));

    const result = await parseRequisitesDocument({
      originalname: 'requisites.pdf',
      buffer,
    } as Express.Multer.File);

    expect(result.sourceType).toBe('PDF');
    expect(result.fields.inn).toBe('7712345678');
    expect(result.fields.kpp).toBe('771201001');
    expect(result.fields.ogrn).toBe('1237700001234');
    expect(result.fields.bankBik).toBe('044525225');
  });
});
