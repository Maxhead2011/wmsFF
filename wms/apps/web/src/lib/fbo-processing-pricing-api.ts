import type { AuthSession } from './api';
export type FboPart = {
    serviceId: string;
    priceRub: string;
    multiplier: string;
    taxMode: 'INCLUDED' | 'ADD_6_PERCENT';
};
export type FboDefinition = {
    common: FboPart[];
    variants: Array<{
        name: string;
        skuIds: string[];
        services: FboPart[];
    }>;
};
export type FboProduct = {
    id: string;
    name: string;
    article: string | null;
    size: string | null;
    barcodes: Array<{
        value: string;
    }>;
};
export type FboClient = {
    id: string;
    code: string;
    name: string;
    status: string;
    tariff: {
        id: string;
        definition: FboDefinition;
        createdAt: string;
    } | null;
    legacy: {
        protected: boolean;
        services: Array<{
            serviceId: string;
            name: string;
            priceRub: string | null;
            taxMode: FboPart['taxMode'] | null;
            multiplier: string;
            matchKeywords: string | null;
            isActive: boolean;
        }>;
        primaryFbs: {
            white: string;
            gray: string;
            returned: string;
        } | null;
    };
};
export type FboRegistry = {
    enabled: true;
    clients: FboClient[];
    services: Array<{
        id: string;
        name: string;
        code: string;
        defaultPriceRub: string | null;
    }>;
};
// FIX: explicit save only; opening the registry never initializes or overwrites prices.
async function request<T>(session: AuthSession, path: string, options: RequestInit = {}) {
    const response = await fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/billing/fbo-processing${path}`, { ...options, headers: { Authorization: `Bearer ${session.accessToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ? [body.message].flat().join('; ') : `Ошибка загрузки (${response.status}).`);
    }
    return await response.json() as T;
}
export const fetchFboRegistry = (session: AuthSession, signal?: AbortSignal) => request<FboRegistry | {
    enabled: false;
}>(session, '', { signal });
export const fetchFboProducts = (session: AuthSession, clientId: string, search: string, signal?: AbortSignal) => request<FboProduct[]>(session, `/${encodeURIComponent(clientId)}/products?${new URLSearchParams({ search })}`, { signal });
export const saveFboTariff = (session: AuthSession, clientId: string, definition: FboDefinition, operationKey: string) => request<NonNullable<FboClient['tariff']>>(session, `/${encodeURIComponent(clientId)}`, { method: 'POST', body: JSON.stringify({ definition, operationKey }) });
export function fboPreview(parts: FboPart[]) {
    // FIX: exact decimal preview, including half-up rounding; server still validates the saved definition.
    const parse = (text: string, scale: number) => { const value = text.trim().replace(',', '.'); if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(value))
        return null; const [whole, fraction = ''] = value.split('.'); return BigInt(whole + fraction.padEnd(scale, '0')); };
    let total = 0n;
    for (const part of parts) {
        const price = parse(part.priceRub, 2), multiple = parse(part.multiplier, 3);
        if (price === null || multiple === null || multiple <= 0n || price > 999999999999n || multiple > 1000000n)
            return null;
        const numerator = price * multiple * (part.taxMode === 'ADD_6_PERCENT' ? 100n : 1n), denominator = part.taxMode === 'ADD_6_PERCENT' ? 94000n : 1000n;
        total += (numerator * 2n + denominator) / (denominator * 2n);
    }
    return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}
