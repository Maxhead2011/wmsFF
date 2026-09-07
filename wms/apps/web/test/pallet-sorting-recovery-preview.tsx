// TEST: local-only UI fixture; deliberately no production auth or inventory API.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PalletSortingPanel } from '../src/components/inventory/PalletSortingPanel';
import type { SortingState } from '../src/lib/pallet-sorting-api';
if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('Local synthetic preview only');
let state: SortingState = { id: 'qa-session', version: 1, sourceCode: 'QA_PALLET', stage: 'CHECKING',
  sources: [], targets: [], moves: [], pendingRoutes: [], problemSources: [] };
globalThis.fetch = async (input, init) => {
  const path = String(input);
  if (!path.startsWith('/api/v1/pallet-sorting')) throw new Error('Unexpected request: synthetic QA blocks external fetch');
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (!body && path.endsWith('/pallet-sorting')) return Response.json([state]);
  if (path.includes('/preview')) return Response.json({ quantity: 0, boxes: [], fingerprint: 'qa-only', affectedOrders: [], problemSources: state.problemSources, recoveredQuantity: state.moves.filter(m => m.recovered).length });
  if (body) {
    if (body.action === 'SCAN_SOURCE') state.problemSources = [{ code: body.code, scanned: true, reason: 'BOX_NOT_FOUND' }];
    if (body.action === 'BEGIN_FORMING') state.stage = 'FORMING';
    if (body.action === 'OPEN_TARGET') { state.targets = [{ id: 'target', code: body.code, palletCode: body.palletCode, quantity: 0, closed: false }]; state.activeTargetId = 'target'; }
    if (body.action === 'MOVE' && !state.moves.some(m => m.identity === body.kiz)) { state.moves.push({ identity: body.kiz, recovered: true }); state.targets[0].quantity++; }
    if (body.action === 'CLOSE_TARGET') { state.targets[0].closed = true; state.activeTargetId = null; }
    if (body.action === 'COMPLETE') state.stage = 'COMPLETED';
    state = { ...state, version: state.version + 1 };
  }
  return Response.json(state);
};
const session = { accessToken: 'SYNTHETIC_NOT_A_TOKEN', user: { id: 'qa-admin', roleCodes: ['ADMIN'], activeWarehouseId: 'qa-wh' } };
createRoot(document.getElementById('root')!).render(<><p>ЛОКАЛЬНЫЙ СТЕНД · ДАННЫЕ ВЫМЫШЛЕННЫЕ</p><PalletSortingPanel session={session as never} /></>);
