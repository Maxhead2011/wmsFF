import type { AuthUser } from '../auth/auth.types';

// FIX: size substitution is explicitly enabled per installation.
export const sizeSubstitutionEnabled = () => process.env.WMS_FBS_SIZE_SUBSTITUTION_ENABLED === 'true';
export const canSubstituteSize = (user: AuthUser) => !user.isDemo && user.roleCodes.some(r => r === 'ADMIN' || r === 'OWNER');
const normalize = (value: string | null) => (value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
type Product = { id: string; article: string | null; clientSku: string | null; color: string | null; size: string | null };

export function sizeRank(size: string | null): number | null {
  const value = (size ?? '').trim().toUpperCase();
  const alpha = /^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)(?:\s*\/\s*\d{2})?$/.exec(value);
  if (alpha) return ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'].indexOf(alpha[1].replace('2XL', 'XXL').replace('3XL', 'XXXL'));
  if (/^\d{2}$/.test(value) && Number(value) >= 36 && Number(value) <= 64 && Number(value) % 2 === 0) return (Number(value) - 36) / 2;
  return null;
}

// FIX: never infer a different model/colour from similar names. Unrecognised sizes require a catalogue correction.
export function replacementDistance(target: Product, source: Product, mappings: Array<{ sourceArticle: string; targetArticle: string }> = []): number | null {
  const article = normalize(target.article || target.clientSku);
  const sourceArticle = normalize(source.article || source.clientSku);
  const approvedArticle = article === sourceArticle || mappings.some(m => normalize(m.targetArticle) === article && normalize(m.sourceArticle) === sourceArticle);
  if (target.id === source.id || !article || !sourceArticle || !approvedArticle ||
      !normalize(target.color) || normalize(target.color) !== normalize(source.color)) return null;
  const a = sizeRank(target.size), b = sizeRank(source.size);
  return a === null || b === null || a === b ? null : Math.abs(a - b);
}

export function preferredReplacements<T extends { distance: number; available: number }>(rows: T[]): T[] {
  const available = rows.filter(row => row.available > 0);
  const adjacent = available.filter(row => row.distance === 1);
  return (adjacent.length ? adjacent : available).sort((a, b) => a.distance - b.distance || b.available - a.available);
}
