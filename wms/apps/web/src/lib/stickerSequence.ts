export type StickerSequence = {
  prefix: string; start: string; count: string; step: string;
  repeat: string; digits: string; direction: 'up' | 'down' | 'fixed';
};

// FIX: validate the complete batch before submitting any print jobs.
export function stickerSequence(input: StickerSequence): string[] {
  const integer = (text: string, min: number, max: number) => {
    if (!/^\d+$/.test(text)) throw new Error('Введите целые числа без дробей.');
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Допустимое значение: от ${min} до ${max}.`);
    return value;
  };
  const count = integer(input.count, 1, 500);
  const repeat = integer(input.repeat, 1, 500);
  if (count * repeat > 500) throw new Error('В одном задании допускается не более 500 этикеток с учётом повторений.');
  if (!input.prefix.trim()) throw new Error('Введите текст или префикс этикетки.');
  if (input.direction === 'fixed') {
    return Array(count * repeat).fill(input.prefix);
  }
  const start = integer(input.start, 0, Number.MAX_SAFE_INTEGER);
  const step = integer(input.step, 1, Number.MAX_SAFE_INTEGER);
  const digits = integer(input.digits, 1, 16);
  const end = start + (count - 1) * step * (input.direction === 'down' ? -1 : 1);
  if (!Number.isSafeInteger(end) || end < 0) throw new Error('Последний номер выходит за допустимый диапазон.');
  return Array.from({ length: count }, (_, index) => {
    const number = start + index * step * (input.direction === 'down' ? -1 : 1);
    return Array(repeat).fill(`${input.prefix}${String(number).padStart(digits, '0')}`);
  }).flat();
}
