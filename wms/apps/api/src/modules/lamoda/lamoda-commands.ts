import { lamodaCommandSchemas } from './lamoda-command-schemas';

export type LamodaCommand = { kind: 'STOCKS' | 'PACKS' | 'ASSEMBLY' | 'FBO_CREATE' | 'FBO_CANCEL' | 'FBS_CREATE' | 'FBS_PREPARED'; body: Record<string, unknown>; orderId?: string; shipmentId?: string };
type Schema = { type?: string; nullable?: boolean; enum?: unknown[]; required?: string[]; properties?: Record<string, Schema>; items?: Schema; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; pattern?: string; format?: string };
const invalid = (): never => { throw new Error('INVALID_COMMAND'); };
export function lamodaPathId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 255 || /[\x00-\x20/\\?#]/.test(value) || value === '.' || value === '..') return invalid();
  return encodeURIComponent(value);
}
// FIX: closed schemas prevent accidental credentials/foreign seller fields and malformed quantities.
function validate(value: unknown, s: Schema): void {
  if (value === null && s.nullable) return;
  if (s.enum && !s.enum.includes(value)) invalid();
  if (s.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const obj = value as Record<string, unknown>, props = s.properties ?? {};
    if ((s.required ?? []).some(k => obj[k] === undefined) || Object.keys(obj).some(k => !Object.hasOwn(props, k))) invalid();
    for (const [key, item] of Object.entries(obj)) validate(item, props[key]);
  } else if (s.type === 'array') {
    if (!Array.isArray(value)) invalid();
    const a = value as unknown[];
    if (a.length < (s.minItems ?? 0) || a.length > (s.maxItems ?? 10000)) invalid();
    a.forEach(item => validate(item, s.items ?? {}));
  } else if (s.type === 'string') {
    if (typeof value !== 'string') invalid();
    const str = value as string;
    if (str.length < (s.minLength ?? 0) || str.length > (s.maxLength ?? 10000) || (s.pattern && !new RegExp(s.pattern).test(str))) invalid();
    if (s.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(str) || !Number.isFinite(Date.parse(str)) || new Date(str).toISOString().slice(0,10) !== str)) invalid();
    if (s.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(str) || !Number.isFinite(Date.parse(str)))) invalid();
  } else if (s.type === 'integer' || s.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (s.type === 'integer' && !Number.isSafeInteger(value)) || value < (s.minimum ?? -Infinity) || value > (s.maximum ?? Infinity)) invalid();
  } else if (s.type === 'boolean' && typeof value !== 'boolean') invalid();
}
export function prepareLamodaCommand(command: LamodaCommand, sellerId: string) {
  if (!command || !command.body || typeof command.body !== 'object' || Array.isArray(command.body) || Object.hasOwn(command.body, 'sellerId')) invalid();
  let path: string, schema: string;
  switch (command.kind) {
    case 'STOCKS': path = '/fbs/stocks'; schema = 'FBSStockUpdateRequest'; break;
    case 'PACKS': path = `/orders/${lamodaPathId(command.orderId)}/packs`; schema = 'OrderPacksCreateRequest'; break;
    case 'ASSEMBLY': path = `/orders/${lamodaPathId(command.orderId)}/assembly`; schema = 'OrderAssemblyRequest'; break;
    case 'FBO_CREATE': path = '/fbo/shipments'; schema = 'FBOShipmentCreateRequest'; break;
    case 'FBO_CANCEL': path = `/fbo/shipments/${lamodaPathId(command.shipmentId)}/cancel`; schema = 'FBOShipmentCancelRequest'; break;
    case 'FBS_CREATE': path = '/fbs/shipments'; schema = 'FBSShipmentCreateRequest'; break;
    case 'FBS_PREPARED': path = '/fbs/prepared-shipments'; schema = 'FBSPreparedShipmentCreateRequest'; break;
    default: return invalid();
  }
  const body = { ...command.body, sellerId };
  validate(body, lamodaCommandSchemas[schema] as Schema);
  return { path, body: JSON.stringify(body) };
}
