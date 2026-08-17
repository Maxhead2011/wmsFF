const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';
export async function askWmsAi(accessToken, message) {
    return jsonRequest('/wms-ai/chat', accessToken, {
        method: 'POST',
        body: { message },
    });
}
export async function downloadWmsAiExport(accessToken, tool, params = {}) {
    const query = new URLSearchParams({ tool });
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            query.set(key, String(value));
        }
    }
    const response = await fetch(`${API_BASE_URL}/wms-ai/export.xlsx?${query.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok)
        throw new Error(await responseError(response));
    return response.blob();
}
export function teachWmsAi(accessToken, payload) {
    return jsonRequest('/wms-ai/knowledge', accessToken, { method: 'POST', body: payload });
}
async function jsonRequest(path, accessToken, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok)
        throw new Error(await responseError(response));
    return (await response.json());
}
async function responseError(response) {
    try {
        const payload = (await response.json());
        return Array.isArray(payload.message)
            ? payload.message.join('\n')
            : payload.message || `HTTP ${response.status}`;
    }
    catch {
        return `HTTP ${response.status}`;
    }
}
