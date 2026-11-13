import { expect, it } from 'vitest';
import type { ClientRequestSummary, FbsOrderSummary } from '../../lib/api';
import { requestSupplyOrders } from './requestSupplyAction';

const request = {
  id: 'request', fbsCompletion: { totalOrders: 2, completedOrders: 2, percent: 100, completed: true },
} as ClientRequestSummary;
const order = (id: string, overrides: Partial<FbsOrderSummary> = {}) => ({
  id, marketplace: 'WILDBERRIES', connectionId: 'cabinet', supplyId: 'supply',
  supplierStatus: 'confirm', request: { id: request.id }, ...overrides,
}) as FbsOrderSummary;

it('passes the whole request to delivery, including compatible separate supplies', () => {
  const orders = [order('1'), order('2', { supplyId: 'second' })];
  expect(requestSupplyOrders({ request, action: 'deliver' }, orders)).toEqual(orders);
});

it('blocks an incomplete or unassembled request and a supply shared with another request', () => {
  const target = { request, action: 'deliver' as const };
  expect(() => requestSupplyOrders(target, [order('1')])).toThrow('полный состав');
  expect(() => requestSupplyOrders(target, [order('1'), order('2', { supplierStatus: 'complete' })])).toThrow('готовы');
  expect(() => requestSupplyOrders(target, [order('1'), order('2'), order('3', { request: null })])).toThrow('другой заявки');
  expect(() => requestSupplyOrders({ ...target, request: {
    ...request, fbsCompletion: { ...request.fbsCompletion!, completed: false },
  } }, [order('1'), order('2')])).toThrow('собраны');
});

it.each(['download', 'print'] as const)('scopes %s to the selected WB request', action => {
  const own = [order('1'), order('2', { supplierStatus: 'complete' })];
  expect(requestSupplyOrders({ request, action }, [...own, order('3', { request: null })])).toEqual(own);
});

// TEST: Ozon labels are scoped to the request before assembly; delivery remains WB-only.
it.each(['download', 'print'] as const)('opens Ozon %s before picking', action => {
  const own = [order('oz1', {marketplace: 'OZON', supplyId: null}), order('oz2', {marketplace: 'OZON', supplyId: null})];
  expect(requestSupplyOrders({request, action}, [...own, order('unrelated', {request: null})])).toEqual(own);
});
it('rejects Ozon delivery and unsupported or partial label selections', () => {
  const oz = [order('1', {marketplace:'OZON'}), order('2', {marketplace:'OZON'})];
  expect(() => requestSupplyOrders({request, action:'deliver'}, oz)).toThrow();
  expect(() => requestSupplyOrders({request, action:'print'}, oz.slice(0,1))).toThrow('полный состав');
  expect(() => requestSupplyOrders({request, action:'print'}, [order('1', {marketplace:'YANDEX_MARKET'}),order('2')])).toThrow();
});
