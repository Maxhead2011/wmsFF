const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export type WmsAiTool =
  | 'BOXES_NOT_IN_PALLET_SORT'
  | 'UNRECOGNIZED_BOXES_IN_PALLET_SORT'
  | 'PRODUCT_BOX_STOCK'
  | 'BOX_CONTENTS'
  | 'PALLET_CONTENTS'
  | 'LOW_STOCK_SKUS'
  | 'CLIENT_STOCK_SUMMARY'
  | 'REQUEST_OVERVIEW'
  | 'RECENT_STOCK_MOVEMENTS'
  | 'KIZ_PROBLEMS'
  | 'INTERBRANCH_TRANSFERS';

export type WmsAiToolParams = {
  search?: string;
  boxCode?: string;
  palletCode?: string;
  maxTotal?: number;
  minTotal?: number;
  clientSearch?: string;
  requestNumber?: number;
  days?: number;
  status?: string;
};

export type WmsAiSource = {
  title: string;
  url: string;
  snippet: string;
};

export type WmsAiResponse = {
  id: string;
  role: 'assistant';
  intent: WmsAiTool | 'KNOWLEDGE' | 'WEB_RESEARCH' | 'HELP';
  title: string;
  answer: string;
  generatedAt: string;
  engine: 'WMS_TOOL' | 'LOCAL_KNOWLEDGE' | 'LOCAL_MODEL' | 'LOCAL_RULES';
  warehouse: { id: string; code: string; name: string; city: string };
  summary?: {
    rows: number;
    boxes?: number;
    pallets?: number;
    skus?: number;
    clients?: number;
    requests?: number;
    issues?: number;
    transfers?: number;
    totalQuantity?: number;
  };
  columns?: Array<{ key: string; label: string }>;
  rows?: Array<Record<string, string | number | null>>;
  export?: {
    available: boolean;
    tool: WmsAiTool;
    params?: WmsAiToolParams;
    fileName: string;
  };
  sources?: WmsAiSource[];
  canTeach?: boolean;
  suggestions: string[];
};

export async function askWmsAi(accessToken: string, message: string) {
  return jsonRequest<WmsAiResponse>('/wms-ai/chat', accessToken, {
    method: 'POST',
    body: { message },
  });
}

export async function downloadWmsAiExport(
  accessToken: string,
  tool: WmsAiTool,
  params: WmsAiToolParams = {},
) {
  const query = new URLSearchParams({ tool });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }
  const response = await fetch(
    `${API_BASE_URL}/wms-ai/export.xlsx?${query.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.blob();
}

export function teachWmsAi(
  accessToken: string,
  payload: { question: string; solution: string; sourceUrls?: string[] },
) {
  return jsonRequest<{ id: string; message: string; keywords: string[] }>(
    '/wms-ai/knowledge',
    accessToken,
    { method: 'POST', body: payload },
  );
}

async function jsonRequest<T>(
  path: string,
  accessToken: string,
  options: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return (await response.json()) as T;
}

async function responseError(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string | string[] };
    return Array.isArray(payload.message)
      ? payload.message.join('\n')
      : payload.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
