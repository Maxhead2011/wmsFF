import { limitShareChange, moscowDay, stockDemandCoverage, type AvailabilityDay } from './wb-stock-demand-coverage';
import { allocateFbsStock, recommendFbsStockPercentages, type FbsStockAllocationShare } from './fbs-stock-allocation';
import { wbStockAfterReserve, type WbStockReserve } from './wb-stock-reserve';

type Order = { id: string; connectionId: string; marketplace: string; category: string; createdAt: string | null; warehouseId: string | null; itemCount: number; product: { id: string } | null };
export type AnalysisStock = { skuId: string; name: string; barcode: string; available: number; saleLimit?: number | null; enabled?: boolean; reserveOverride?: WbStockReserve | null; blocked?: boolean };

// FIX: a deterministic, read-only recommendation; it never changes saved shares.
export function analyzeWbStockDemand(orders: Order[], connectionId: string, stocks: AnalysisStock[], shares: FbsStockAllocationShare[], reserve: WbStockReserve, now = Date.now(), days = 30, threshold = 10, options: { availability?: AvailabilityDay[]; maxShareChange?: number } = {}) {
  const start = now - days * 86400000;
  const warehouses = new Set(shares.map(s => s.warehouseId));
  const skuIds = new Set(stocks.map(s => s.skuId));
  const grouped = new Map<string, { daily: number[]; demand: Map<string, number>; total: number }>();
  const dailyOrders = new Map<string, Map<string, Map<string, number>>>();
  const seen = new Set<string>();
  let excluded = 0;
  for (const order of orders) {
    const date = Date.parse(order.createdAt ?? '');
    if (order.connectionId !== connectionId || order.marketplace !== 'WILDBERRIES' || order.category === 'cancelled') continue;
    if (!Number.isFinite(date) || date < start || date >= now || !order.warehouseId || !warehouses.has(order.warehouseId) || !order.product || !skuIds.has(order.product.id)) { excluded++; continue; }
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    const qty = Math.max(1, Math.trunc(order.itemCount || 1));
    const row = grouped.get(order.product.id) ?? { daily: Array(days).fill(0), demand: new Map(), total: 0 };
    row.daily[Math.floor((date - start) / 86400000)] += qty;
    row.demand.set(order.warehouseId, (row.demand.get(order.warehouseId) ?? 0) + qty);
    row.total += qty;
    grouped.set(order.product.id, row);
    const skuDays = dailyOrders.get(order.product.id) ?? new Map<string, Map<string, number>>();
    const day = moscowDay(date);
    const warehouseOrders = skuDays.get(day) ?? new Map<string, number>();
    warehouseOrders.set(order.warehouseId, (warehouseOrders.get(order.warehouseId) ?? 0) + qty);
    skuDays.set(day, warehouseOrders); dailyOrders.set(order.product.id, skuDays);
  }
  const totalUnits = [...grouped.values()].reduce((sum, r) => sum + r.total, 0);
  const abc = new Map<string, string>();
  let cumulative = 0;
  for (const [sku, row] of [...grouped].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))) {
    abc.set(sku, cumulative < totalUnits * .8 ? 'A' : cumulative < totalUnits * .95 ? 'B' : 'C');
    cumulative += row.total;
  }
  const totals = new Map<string, number>();
  const rows = stocks.map(stock => {
    const demand = grouped.get(stock.skuId);
    const coverage = stockDemandCoverage(stock.skuId, shares.filter(s => s.percent > 0 || demand?.demand.has(s.warehouseId)).map(s => s.warehouseId), options.availability ?? [], dailyOrders.get(stock.skuId) ?? new Map(), moscowDay(start), moscowDay(now));
    const series = coverage.dailyRates;
    const mean = series.length ? series.reduce((a, b) => a + b, 0) / series.length : 0;
    const cv = mean > 0 ? Math.sqrt(series.reduce((sum, x) => sum + (x - mean) ** 2, 0) / series.length) / mean : null;
    const activeDays = demand?.daily.filter(x => x > 0).length ?? 0;
    const sufficient = coverage.sufficient && (demand?.total ?? 0) >= 10 && activeDays >= 7;
    const xyz = !sufficient ? '—' : cv! <= .5 ? 'X' : cv! <= 1 ? 'Y' : 'Z';
    // Sparse demand keeps manual shares; unstable demand blends with them instead of overreacting.
    const trust = !sufficient ? 0 : xyz === 'X' ? 1 : xyz === 'Y' ? .75 : .5;
    const suggested = sufficient ? recommendFbsStockPercentages(shares.map(s => s.warehouseId), coverage.rates) : shares;
    const weights = new Map(shares.map(s => [s.warehouseId, Math.round((trust * (suggested.find(x => x.warehouseId === s.warehouseId)?.percent ?? 0) + (1 - trust) * s.percent) * 100)]));
    const percentages = trust === 0 ? shares.map(s => ({ warehouseId: s.warehouseId, percent: s.percent })) : recommendFbsStockPercentages(shares.map(s => s.warehouseId), weights);
    const afterReserve = wbStockAfterReserve(stock.available, stock.reserveOverride ?? reserve);
    const publishable = stock.enabled === false || stock.blocked ? 0 : Math.min(afterReserve, stock.saleLimit == null ? afterReserve : Math.max(0, stock.saleLimit));
    const allocation = allocateFbsStock(publishable, threshold, percentages.map(s => ({ ...s, isPrimary: shares.find(x => x.warehouseId === s.warehouseId)?.isPrimary })));
    allocation.forEach(a => totals.set(a.warehouseId, (totals.get(a.warehouseId) ?? 0) + a.amount));
    return { ...stock, coveredDays: coverage.coveredDays, stockoutDays: coverage.stockoutDays, reserveQuantity: Math.max(0, stock.available - afterReserve), publishable, orderedUnits: demand?.total ?? 0, activeDays, abc: abc.get(stock.skuId) ?? '—', xyz, coefficientOfVariation: cv, sufficient, percentages, allocation };
  });
  const hasEvidence = rows.some(r => r.sufficient && r.publishable > 0);
  const unrestrictedShares = hasEvidence && [...totals.values()].some(n => n > 0) ? recommendFbsStockPercentages(shares.map(s => s.warehouseId), totals) : shares.map(s => ({ warehouseId: s.warehouseId, percent: s.percent }));
  const maxShareChange = options.maxShareChange ?? 10;
  const recommendedShares = limitShareChange(shares, unrestrictedShares, maxShareChange);
  return { maxShareChange, periodDays: days, generatedAt: new Date(now).toISOString(), from: new Date(start).toISOString(), orderedUnits: totalUnits, excluded, hasEvidence, recommendedShares, rows,
    warnings: ['ABC рассчитан по числу заказанных единиц (80/95%), не по выручке.', 'XYZ: коэффициент вариации дневного спроса; X ≤ 0,5; Y ≤ 1; Z > 1. Для оценки нужно ≥ 10 единиц и ≥ 7 дней с заказами.', 'Спрос нормируется по наблюдаемым часам наличия WB. День учитывается при ≥ 18 часах наблюдений; нужны ≥ 7 дней покрытия и ≥ 3 дней наличия для каждого склада. Неизвестные периоды не считаются нулём; при нехватке истории сохраняются ручные доли.'] };
}
