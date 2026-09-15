import { BadRequestException } from '@nestjs/common';

// FIX: only scanner framing is removed. GS, punctuation and letter case are data.
export function parseDuplicateKiz(value: unknown) {
  if (typeof value !== 'string') throw new BadRequestException('Отсканируйте полный КИЗ.');
  const raw = value.replace(/^\]d2/, '').replace(/[\r\n]+$/, '');
  const match = /^01(\d{14})21([\x21-\x7e]{13})\x1d91([\x21-\x7e]{4})\x1d92([\x21-\x7e]{4,160})$/.exec(raw);
  if (!match) throw new BadRequestException('Нужен полный КИЗ одежды с разделителями GS и частями 91/92. Код обрезан или формат не поддерживается.');
  const gtin = match[1];
  const sum = [...gtin.slice(0, 13)].reduce((n, digit, i) => n + Number(digit) * (i % 2 === 0 ? 3 : 1), 0);
  if ((10 - sum % 10) % 10 !== Number(gtin[13])) throw new BadRequestException('Неверная контрольная цифра GTIN. Повторите сканирование.');
  return { raw, gtin, identity: `01${gtin}21${match[2]}` };
}

export function duplicateBarcodeOptions(raw: string) {
  // FIX: BWIPP's doubled caret is literal data; only the initial FNC1 is a command.
  const text = '^FNC1' + parseDuplicateKiz(raw).raw.replace(/\^/g, '^^');
  return { bcid: 'datamatrix', text, parse: false, parsefnc: true, scale: 4, padding: 3, backgroundcolor: 'FFFFFF' };
}
