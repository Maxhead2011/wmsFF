import { BadRequestException } from '@nestjs/common';

export type AutoAssemblyConfig = { enabled: boolean; times: string[]; warehouseIds: string[]; allWarehouses: boolean };
export const emptyAutoAssembly: AutoAssemblyConfig = { enabled: false, times: ['00:00', '06:00', '12:00', '18:00'], warehouseIds: [], allWarehouses: false };
// FIX: explicit Moscow wall-clock times survive server timezone changes and restarts.
export function parseAutoAssembly(value: unknown): AutoAssemblyConfig {
  const v = value as AutoAssemblyConfig;
  if (!v || typeof v.enabled !== 'boolean' || typeof v.allWarehouses !== 'boolean' || !Array.isArray(v.times) || !v.times.length || v.times.length > 24 || v.times.some(t => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || !Array.isArray(v.warehouseIds) || v.warehouseIds.length > 200 || v.warehouseIds.some(id => typeof id !== 'string' || !id || id.length > 100)) throw new BadRequestException('Проверьте время запуска и склады.');
  if (v.enabled && !v.allWarehouses && !v.warehouseIds.length) throw new BadRequestException('Выберите склады или все направления.');
  return { enabled: v.enabled, allWarehouses: v.allWarehouses, times: [...new Set(v.times)].sort(), warehouseIds: [...new Set(v.warehouseIds)] };
}
export function nextAutoAssembly(times: string[], after: Date): Date {
  const moscow = new Date(after.getTime() + 3 * 3600000).toISOString().slice(0, 10);
  const candidates = [0, 1].flatMap(day => times.map(time => new Date(new Date(`${moscow}T${time}:00+03:00`).getTime() + day * 86400000))).filter(date => date > after);
  return new Date(Math.min(...candidates.map(date => date.getTime())));
}
