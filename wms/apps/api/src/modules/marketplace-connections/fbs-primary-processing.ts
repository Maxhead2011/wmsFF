export type FbsPrimaryProcessingType = 'WHITE' | 'GRAY' | 'RETURN';

export type FbsPrimaryProcessingOrder = {
  quantity: number;
  boxCode?: string | null;
  relabelRequired?: boolean;
};

export type FbsPrimaryProcessingBreakdown = {
  quantities: Record<FbsPrimaryProcessingType, number>;
  relabelQuantity: number;
  totalQuantity: number;
};

const DEFAULT_WHITE_BOX_PREFIXES = ['FFL_LKB'];
const DEFAULT_GRAY_BOX_PREFIXES = ['FFL_G_'];
const RETURN_BOX_MARKERS = ['LKVZ', 'VZV', 'VOZVRAT', 'RETURN'];

export function classifyFbsPrimaryProcessingType(
  boxCode: string | null | undefined,
  prefixes?: {
    whiteReceiptPrefixes?: string[];
    grayReceiptPrefixes?: string[];
  },
): FbsPrimaryProcessingType {
  const normalized = String(boxCode ?? '')
    .trim()
    .toLocaleUpperCase('ru-RU');
  const whitePrefixes = normalizePrefixes(
    prefixes?.whiteReceiptPrefixes,
    DEFAULT_WHITE_BOX_PREFIXES,
  );
  const grayPrefixes = normalizePrefixes(
    prefixes?.grayReceiptPrefixes,
    DEFAULT_GRAY_BOX_PREFIXES,
  );

  if (RETURN_BOX_MARKERS.some((marker) => normalized.includes(marker))) {
    return 'RETURN';
  }
  if (grayPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return 'GRAY';
  }
  if (whitePrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return 'WHITE';
  }
  return 'WHITE';
}

export function buildFbsPrimaryProcessingBreakdown(
  orders: FbsPrimaryProcessingOrder[],
  prefixes?: {
    whiteReceiptPrefixes?: string[];
    grayReceiptPrefixes?: string[];
  },
): FbsPrimaryProcessingBreakdown {
  const quantities: Record<FbsPrimaryProcessingType, number> = {
    WHITE: 0,
    GRAY: 0,
    RETURN: 0,
  };
  let relabelQuantity = 0;

  for (const order of orders) {
    const quantity = Math.max(1, Math.trunc(Number(order.quantity) || 0));
    quantities[classifyFbsPrimaryProcessingType(order.boxCode, prefixes)] += quantity;
    if (order.relabelRequired) {
      relabelQuantity += quantity;
    }
  }

  return {
    quantities,
    relabelQuantity,
    totalQuantity: quantities.WHITE + quantities.GRAY + quantities.RETURN,
  };
}

function normalizePrefixes(value: string[] | undefined, fallback: string[]) {
  const normalized = (value ?? [])
    .map((prefix) => prefix.trim().toLocaleUpperCase('ru-RU'))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}
