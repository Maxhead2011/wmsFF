import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BILLING_SELLER = {
  shortName: 'ИП Говорова Е. И.',
  fullName: 'Индивидуальный предприниматель Говорова Екатерина Ивановна',
  inn: '616602423102',
  kpp: '',
  address: '',
  bankName: 'АО «ТБанк»',
  bankBik: '044525974',
  bankAccount: '40802810600008484063',
  correspondentAccount: '30101810145250000974',
  paymentCode: '0002820008',
  paymentPurposeCode: 'НК26060000',
};

const SIGNATURE_PATH = join(process.cwd(), 'assets', 'billing', 'govorova-signature.png');
const STAMP_PATH = join(process.cwd(), 'assets', 'billing', 'govorova-stamp.png');

export function billingAssetDataUrl(kind: 'signature' | 'stamp') {
  const path = kind === 'signature' ? SIGNATURE_PATH : STAMP_PATH;
  if (!existsSync(path)) {
    return null;
  }

  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

export function invoiceDisplayNumber(number: string) {
  const match = number.match(/(\d{1,})$/);
  return match ? String(Number(match[1])) : number;
}

export function actDisplayNumber(actNumber: string | undefined, invoiceNumber: string) {
  return invoiceDisplayNumber(actNumber ?? invoiceNumber);
}

export function formatDate(value: string | null) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

export function formatLongDate(value: string | null) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}

export function unitLabel(unit: string) {
  const labels: Record<string, string> = {
    SERVICE: 'усл',
    PIECE: 'шт',
    BOX: 'кор',
    PALLET: 'пал',
    LITER: 'л',
    LITER_DAY: 'л-дн',
    DAY: 'дн',
    HOUR: 'ч',
  };
  return labels[unit] ?? 'шт';
}

export function amountInWordsRub(value: number) {
  const rubles = Math.floor(Math.abs(value));
  const kopecks = Math.round((Math.abs(value) - rubles) * 100);
  const words = numberToWords(rubles);
  return `${capitalize(words)} ${plural(rubles, ['рубль', 'рубля', 'рублей'])} ${String(kopecks).padStart(2, '0')} ${plural(kopecks, ['копейка', 'копейки', 'копеек'])}`;
}

function numberToWords(value: number) {
  if (value === 0) {
    return 'ноль';
  }

  const groups: Array<{ forms: [string, string, string]; gender: 'm' | 'f' }> = [
    { forms: ['', '', ''], gender: 'm' as const },
    { forms: ['тысяча', 'тысячи', 'тысяч'], gender: 'f' as const },
    { forms: ['миллион', 'миллиона', 'миллионов'], gender: 'm' as const },
    { forms: ['миллиард', 'миллиарда', 'миллиардов'], gender: 'm' as const },
  ];
  const parts: string[] = [];
  let rest = value;
  let groupIndex = 0;

  while (rest > 0 && groupIndex < groups.length) {
    const chunk = rest % 1000;
    if (chunk > 0) {
      const group = groups[groupIndex];
      const chunkWords = threeDigitsToWords(chunk, group.gender);
      if (groupIndex > 0) {
        chunkWords.push(plural(chunk, group.forms));
      }
      parts.unshift(chunkWords.join(' '));
    }
    rest = Math.floor(rest / 1000);
    groupIndex += 1;
  }

  return parts.join(' ');
}

function threeDigitsToWords(value: number, gender: 'm' | 'f') {
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const teens = [
    'десять',
    'одиннадцать',
    'двенадцать',
    'тринадцать',
    'четырнадцать',
    'пятнадцать',
    'шестнадцать',
    'семнадцать',
    'восемнадцать',
    'девятнадцать',
  ];
  const onesMale = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const onesFemale = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const words: string[] = [];

  words.push(hundreds[Math.floor(value / 100)]);
  const lastTwo = value % 100;
  if (lastTwo >= 10 && lastTwo < 20) {
    words.push(teens[lastTwo - 10]);
  } else {
    words.push(tens[Math.floor(lastTwo / 10)]);
    words.push((gender === 'f' ? onesFemale : onesMale)[lastTwo % 10]);
  }

  return words.filter(Boolean);
}

function plural(value: number, forms: [string, string, string]) {
  const lastTwo = Math.abs(value) % 100;
  const last = Math.abs(value) % 10;
  if (lastTwo >= 11 && lastTwo <= 14) {
    return forms[2];
  }
  if (last === 1) {
    return forms[0];
  }
  if (last >= 2 && last <= 4) {
    return forms[1];
  }
  return forms[2];
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
