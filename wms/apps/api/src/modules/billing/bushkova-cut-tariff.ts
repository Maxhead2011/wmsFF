export type CutTariffContext = {
  clientId: string;
  productName?: string | null;
  articles: Array<string | null | undefined>;
};
type CutRule = { serviceId: string; serviceCode?: string };
const BUSHKOVA_CLIENT_ID = '1757a389-c0d4-49b5-9347-2bde0c549260';
const cutLengths = new Set([1, 3, 5, 10, 20, 30, 50]);
const measurement = /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(метр(?:ов|а|ы)?|см|мм|cm|mm|м|m)(?![\p{L}])/giu;
const number = (value: string) => Number(value.replace(',', '.'));
const meters = (unit: string) => /^(?:метр(?:ов|а|ы)?|м|m)$/iu.test(unit);

// FIX: only this client's new cut products may fall back from exact keys to a measured length.
export function resolveBushkovaCutTariff(context: CutTariffContext | undefined, rules: CutRule[]): string | null {
  if (context?.clientId !== BUSHKOVA_CLIENT_ID) return null;
  const nameLength = cutNameLength(context.productName ?? '');
  const articleLengths = [...new Set(context.articles.flatMap(article => {
    const match = /(?:^|[_\s-])(\d+(?:[.,]\d+)?)(?:\s*(?:метр(?:ов|а|ы)?|м|m))?$/iu.exec(article ?? '');
    return match && cutLengths.has(number(match[1])) ? [number(match[1])] : [];
  }))];
  if (articleLengths.length > 1 || Number.isNaN(nameLength)) return null;
  if (nameLength !== undefined && articleLengths.length && nameLength !== articleLengths[0]) return null;
  // Bare numeric article suffixes need a fabric/cut name, so unrelated model numbers are not prices.
  const length = nameLength ?? (/(?:ткан|фатин|отрез|сатин|атлас)/iu.test(context.productName ?? '') ? articleLengths[0] : undefined);
  if (length === undefined) return null;
  const matches = rules.filter(rule => rule.serviceCode === `NOM_ОТРЕЗ_${length}М`);
  return matches.length === 1 ? matches[0].serviceId : null;
}

function cutNameLength(name: string): number | undefined {
  if (/(?:^|\s)или(?:\s|$)/iu.test(name)) return NaN;
  const explicit = /(?:длин(?:а|ой)|отрез(?:а|ом)?)\s*[:=-]?\s*(\d+(?:[.,]\d+)?)\s*(метр(?:ов|а|ы)?|см|мм|cm|mm|м|m)(?![\p{L}])/iu.exec(name);
  if (explicit) return meters(explicit[2]) ? number(explicit[1]) : NaN;
  // A shared unit at the end of "10 × 3 м" applies to both dimensions.
  const sharedUnit = /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*[×xх*]\s*\d+(?:[.,]\d+)?\s*(метр(?:ов|а|ы)?|м|m)(?![\p{L}])/iu.exec(name);
  if (sharedUnit && !/ширин[аыой]*\s*[:=-]?\s*$/iu.test(name.slice(Math.max(0, sharedUnit.index - 18), sharedUnit.index))) return number(sharedUnit[1]);
  const parts = [...name.matchAll(measurement)].filter(part =>
    !/ширин[аыой]*\s*[:=-]?\s*$/iu.test(name.slice(Math.max(0, part.index! - 18), part.index)));
  if (!parts.length) return undefined;
  const first = parts[0];
  if (!meters(first[2])) return NaN;
  // In L × W dimensions only the first dimension is cut length, even when W has its own tariff.
  if (parts.length > 1 && !/^[\s*×xх]+$/iu.test(name.slice(first.index! + first[0].length, parts[1].index))) return NaN;
  return number(first[1]);
}
