import { BadRequestException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';

export type RequisitesDocumentFields = {
  clientKind: 'LEGAL_ENTITY' | 'INDIVIDUAL_ENTREPRENEUR' | 'SELF_EMPLOYED' | 'INDIVIDUAL';
  shortName: string;
  fullName: string;
  name: string;
  legalName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  bankName: string;
  bankBik: string;
  bankAccount: string;
  correspondentAccount: string;
};

export type RequisitesDocumentResult = {
  fileName: string;
  sourceType: 'PDF' | 'EXCEL';
  fields: RequisitesDocumentFields;
  recognizedFields: string[];
  warnings: string[];
};

type DocumentText = {
  text: string;
  lines: string[];
  entries: Array<{ label: string; value: string }>;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function parseRequisitesDocument(
  file: Express.Multer.File | undefined,
): Promise<RequisitesDocumentResult> {
  validateFile(file);
  const extension = file.originalname.toLocaleLowerCase('ru').split('.').pop() ?? '';
  const sourceType = extension === 'pdf' ? 'PDF' : 'EXCEL';
  const document = sourceType === 'PDF' ? await readPdf(file.buffer) : readWorkbook(file.buffer);
  const fields = extractRequisitesFields(document);
  const recognizedFields = Object.entries(fields)
    .filter(([key, value]) => key !== 'clientKind' && Boolean(value))
    .map(([key]) => key);
  const warnings: string[] = [];

  if (!fields.inn) warnings.push('ИНН не найден — заполните его вручную.');
  if (!fields.fullName) warnings.push('Название организации не найдено — заполните его вручную.');
  if (!fields.bankAccount) warnings.push('Расчетный счет не найден.');
  if (recognizedFields.length === 0) {
    throw new BadRequestException(
      sourceType === 'PDF'
        ? 'В PDF не удалось распознать текст реквизитов. Если это скан, сохраните его как PDF с текстовым слоем или загрузите Excel.'
        : 'В Excel не удалось найти реквизиты. Проверьте, что названия полей и значения находятся на одном листе.',
    );
  }

  return {
    fileName: file.originalname,
    sourceType,
    fields,
    recognizedFields,
    warnings,
  };
}

export function extractRequisitesFields(document: DocumentText): RequisitesDocumentFields {
  const inn = labeledDigits(document, ['инн', 'inn'], [10, 12]);
  const kpp = labeledDigits(document, ['кпп', 'kpp'], [9]);
  const ogrn = labeledDigits(document, ['огрнип', 'огрн', 'ogrnip', 'ogrn'], [13, 15]);
  const bankBik = labeledDigits(document, ['бик банка', 'бик', 'bank bik', 'bik'], [9]);
  const correspondentAccount = labeledDigits(
    document,
    ['корреспондентский счет', 'корреспондентский счёт', 'корр. счет', 'корр. счёт', 'корсчет', 'к/с'],
    [20],
  );
  const bankAccount = labeledDigits(
    document,
    ['расчетный счет', 'расчётный счёт', 'расч. счет', 'расч. счёт', 'р/с', 'bank account', 'settlement account'],
    [20],
  );
  const explicitFullName = findValue(document, [
    'полное наименование организации',
    'полное наименование',
    'наименование юридического лица',
    'наименование организации',
    'company name',
  ]);
  const explicitShortName = findValue(document, [
    'сокращенное наименование организации',
    'сокращённое наименование организации',
    'сокращенное наименование',
    'сокращённое наименование',
    'краткое наименование',
  ]);
  const fallbackName = findOrganizationName(document.lines);
  const fullName = cleanCompanyName(explicitFullName || fallbackName || explicitShortName);
  const shortName = cleanCompanyName(explicitShortName || abbreviateCompanyName(fullName));
  const legalAddress = findValue(document, [
    'адрес юридического лица',
    'юридический адрес',
    'юр. адрес',
    'адрес регистрации',
  ]);
  const actualAddress = findValue(document, ['фактический адрес', 'факт. адрес', 'почтовый адрес']);
  const bankName = cleanBankName(
    findValue(document, ['наименование банка', 'банк получателя', 'банк организации', 'банк']),
  );
  const email = findValue(document, ['электронная почта', 'e-mail', 'email', 'почта']) || findEmail(document.text);
  const phone = findValue(document, ['номер телефона', 'контактный телефон', 'телефон']) || findPhone(document.text);
  const clientKind = inferClientKind(fullName || shortName, inn);

  return {
    clientKind,
    shortName,
    fullName,
    name: shortName || fullName,
    legalName: fullName || shortName,
    inn,
    kpp,
    ogrn,
    legalAddress,
    actualAddress,
    phone,
    email,
    bankName,
    bankBik,
    bankAccount,
    correspondentAccount,
  };
}

async function readPdf(buffer: Buffer): Promise<DocumentText> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return documentFromLines((result.text ?? '').split(/\r?\n/));
  } catch {
    throw new BadRequestException('Не удалось прочитать PDF. Проверьте, что файл не защищен паролем и не поврежден.');
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function readWorkbook(buffer: Buffer): DocumentText {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellText: true, cellDates: false });
  } catch {
    throw new BadRequestException('Не удалось прочитать Excel. Поддерживаются файлы XLS и XLSX.');
  }
  if (!workbook.SheetNames.length) {
    throw new BadRequestException('В Excel нет листов.');
  }

  const lines: string[] = [];
  const entries: Array<{ label: string; value: string }> = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });
    for (const row of rows) {
      const cells = row.map(cellText).filter(Boolean);
      if (!cells.length) continue;
      lines.push(cells.join(' | '));
      for (let index = 0; index < cells.length - 1; index += 1) {
        if (looksLikeLabel(cells[index]) && cells[index + 1]) {
          entries.push({ label: cells[index], value: cells[index + 1] });
        }
      }
      if (cells.length === 1) {
        const pair = splitLabelValue(cells[0]);
        if (pair) entries.push(pair);
      }
    }
  }
  const base = documentFromLines(lines);
  return { ...base, entries: [...entries, ...base.entries] };
}

function documentFromLines(rawLines: string[]): DocumentText {
  const lines = rawLines.map(normalizeWhitespace).filter(Boolean);
  const entries = lines.flatMap((line) => {
    const pair = splitLabelValue(line);
    return pair ? [pair] : [];
  });
  return { text: lines.join('\n'), lines, entries };
}

function findValue(document: DocumentText, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeLabel).sort((left, right) => right.length - left.length);
  for (const alias of normalizedAliases) {
    for (const entry of document.entries) {
      const label = normalizeLabel(entry.label);
      if ((label === alias || label.startsWith(`${alias} `) || label.endsWith(` ${alias}`)) && entry.value.trim()) {
        return cleanValue(entry.value);
      }
    }
  }

  for (const alias of normalizedAliases) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${wordsPattern(alias)}\\s*(?:[:№-]|\\|)\\s*([^\\n|]{2,250})`, 'iu');
    const match = document.text.match(pattern);
    if (match?.[1]) return cleanValue(match[1]);
  }
  return '';
}

function labeledDigits(document: DocumentText, aliases: string[], lengths: number[]) {
  for (const alias of aliases) {
    const direct = findValue(document, [alias]);
    const found = pickDigits(direct, lengths);
    if (found) return found;
  }

  for (const line of document.lines) {
    const normalized = normalizeLabel(line);
    for (const alias of aliases) {
      if (!normalized.includes(normalizeLabel(alias))) continue;
      const found = pickDigits(line, lengths);
      if (found) return found;
    }
  }
  return '';
}

function pickDigits(value: string, lengths: number[]) {
  const groups = value.match(/[\d][\d\s-]{4,30}[\d]/g) ?? [];
  for (const group of groups) {
    const digits = group.replace(/\D/g, '');
    if (lengths.includes(digits.length)) return digits;
  }
  return '';
}

function findOrganizationName(lines: string[]) {
  const legalForm = /(?:общество\s+с\s+ограниченной\s+ответственностью|индивидуальный\s+предприниматель|публичное\s+акционерное\s+общество|акционерное\s+общество|(?:ооо|ип|пао|ао)\s+[«"“]?[^|\n]{2,100})/iu;
  for (const line of lines) {
    if (/банк|получател|директор|подпис/i.test(line)) continue;
    const match = line.match(legalForm);
    if (match) return match[0];
  }
  return '';
}

function abbreviateCompanyName(value: string) {
  return value
    .replace(/^Общество с ограниченной ответственностью\s*/iu, 'ООО ')
    .replace(/^Индивидуальный предприниматель\s*/iu, 'ИП ')
    .replace(/^Публичное акционерное общество\s*/iu, 'ПАО ')
    .replace(/^Акционерное общество\s*/iu, 'АО ')
    .trim();
}

function inferClientKind(name: string, inn: string): RequisitesDocumentFields['clientKind'] {
  if (/индивидуальный предприниматель|^ип\b/iu.test(name)) return 'INDIVIDUAL_ENTREPRENEUR';
  if (/самозанят/iu.test(name)) return 'SELF_EMPLOYED';
  if (inn.length === 12) return 'INDIVIDUAL_ENTREPRENEUR';
  return 'LEGAL_ENTITY';
}

function findEmail(text: string) {
  return text.match(/[\w.+-]+@[\w.-]+\.[A-Za-zА-Яа-я]{2,}/u)?.[0] ?? '';
}

function findPhone(text: string) {
  const match = text.match(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/u)?.[0] ?? '';
  return normalizeWhitespace(match);
}

function splitLabelValue(value: string) {
  const colon = value.match(/^\s*([^:|]{2,80})\s*(?::|\|)\s*(.+?)\s*$/u);
  if (colon && looksLikeLabel(colon[1])) return { label: colon[1], value: colon[2] };
  const spaced = value.match(/^\s*(.{2,80}?)\s{2,}(.+?)\s*$/u);
  if (spaced && looksLikeLabel(spaced[1])) return { label: spaced[1], value: spaced[2] };
  return null;
}

function looksLikeLabel(value: string) {
  return /[A-Za-zА-Яа-яЁё]/u.test(value) && value.length <= 100;
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return '';
  return normalizeWhitespace(String(value));
}

function cleanCompanyName(value: string) {
  return cleanValue(value).replace(/^(?:полное|сокращенное|сокращённое)\s+наименование\s*/iu, '');
}

function cleanBankName(value: string) {
  const clean = cleanValue(value);
  return /^\d{9,}$/u.test(clean.replace(/\D/g, '')) ? '' : clean;
}

function cleanValue(value: string) {
  return normalizeWhitespace(value).replace(/^[-–—:]+\s*/u, '').replace(/[;,.]\s*$/u, '').trim();
}

function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function normalizeLabel(value: string) {
  return normalizeWhitespace(value)
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/["'«»“”()№:;,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsPattern(value: string) {
  return value.split(' ').map(escapeRegExp).join('\\s+');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateFile(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
  if (!file?.buffer?.length) throw new BadRequestException('Выберите PDF, XLS или XLSX с реквизитами.');
  if (file.buffer.length > MAX_FILE_SIZE) throw new BadRequestException('Файл реквизитов превышает 10 МБ.');
  const extension = file.originalname.toLocaleLowerCase('ru').split('.').pop() ?? '';
  if (!['pdf', 'xls', 'xlsx'].includes(extension)) {
    throw new BadRequestException('Поддерживаются только PDF, XLS и XLSX.');
  }
  if (extension === 'pdf' && file.buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new BadRequestException('Выбранный файл не является корректным PDF.');
  }
}
