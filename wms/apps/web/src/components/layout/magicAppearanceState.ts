import type { ThemeStyle } from './themeStyle';
export type MagicStyle = 'winx' | 'disney';
// FIX: visual feature is available only on our WMS and local previews.
export const magicEnabled = (hostname: string) => ['wms.logoff.pro', 'localhost', '127.0.0.1'].includes(hostname);
export const isMagicStyle = (style: ThemeStyle): style is MagicStyle => style === 'winx' || style === 'disney';
export const wallpapers = (style: MagicStyle) => Array.from({length: style === 'winx' ? 13 : 20}, (_, i) => `/themes/magic/${style}/${String(i + 1).padStart(2, '0')}.webp`);
export function nextWallpaperIndex(count: number, previous = -1, random = Math.random()): number {
  if (count <= 1) return 0;
  const exclude = previous >= 0 && previous < count;
  const slot = Math.min((exclude ? count - 1 : count) - 1, Math.floor(Math.max(0, Math.min(1, random)) * (exclude ? count - 1 : count)));
  return exclude && slot >= previous ? slot + 1 : slot;
}
// FIX: exact confirmed display name, no substring matching or guessed email.
export function welcomeStyle(user: {id: string; name: string}): MagicStyle | null {
  if (user.id === 'd65d6258-d4e8-4bc1-b1cf-583d1a1e4c82') return 'winx';
  return user.name.trim().toLocaleLowerCase('ru') === 'софия' ? 'disney' : null;
}
