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
// FIX: verified account IDs; login and display name are different fields.
export function welcomeStyle(user: {id: string; name: string}): MagicStyle | null {
  if (user.id === '8e175b30-8535-4881-9324-a875c9fd8c1d') return 'winx';
  return user.id === 'f89c0efe-dcd2-4dfa-9cea-e35c0c492f83' ? 'disney' : null;
}
