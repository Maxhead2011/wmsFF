import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { KizLocationService } from '../src/modules/inventory/kiz-location.service';
import { CheckKizLocationDto, KizLocationController } from '../src/modules/inventory/kiz-location.controller';
import { validate } from 'class-validator';

const code = '0104640569959539215eCUd%lbPYtuV';
const full = code + '\u001d91EE12\u001d92signature';
const user = { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: [], clientScopeMode: 'LIMITED',
  clientIds: ['client'], writableClientIds: [], activeWarehouseId: 'wh', warehouseIds: ['wh'] } as any;
const product = { id: 'sku', name: 'Костюм Соул', article: 'Соул_розовый', size: 'S / 42', color: 'розовый' };
const mark = () => ({ id: 'mark', clientId: 'client', value: full, status: 'AVAILABLE',
  sku: product, client: { name: 'Клиент' }, stockMovement: null,
  box: { id: 'box', code: 'FFL_BOX_25', clientId: 'client', warehouseId: 'wh', status: 'active',
    warehouse: { name: 'ФФ Москва' }, zone: null, pallet: null } });
const placement = () => ({ boxId: 'box', boxCode: 'FFL_BOX_25', pallet: { code: 'PALET_SORT_02',
  clientId: 'client', warehouseId: 'wh', zone: { name: 'Помещение 1', code: 'ROOM1', warehouseId: 'wh' } } });
function setup(marks: any[] = [mark()], placements: any[] = [placement()]) {
  const db = { productMark: { findMany: vi.fn(async () => marks) }, storagePalletBox: { findMany: vi.fn(async () => placements) } };
  return { db, service: new KizLocationService(db as any, new ClientScopeService()) };
}
beforeEach(() => vi.stubEnv('WMS_KIZ_LOCATION_CHECK_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe('administrator KIZ location check (read only)', () => {
  it('validates input and delegates the authenticated user through the controller', async () => {
    // TEST: API validates scanner input and passes scope rather than trusting client-supplied placement.
    const { service } = setup(); const controller = new KizLocationController(service);
    expect((await controller.check({ kiz: full }, user)).found).toBe(true);
    const dto = new CheckKizLocationDto(); dto.kiz = 123 as any;
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
  it.each(['ADMIN', 'OWNER', 'SUPER_ADMIN'])('shows product and current placement for %s', async role => {
    // TEST: a full Data Matrix must resolve to the recorded box, pallet-sort and room.
    const { service, db } = setup();
    const result = await service.lookup(full, { ...user, roleCodes: [role] });
    expect(result.found).toBe(true); expect(result.ambiguous).toBe(false);
    expect(result.matches[0]).toMatchObject({ product, boxCode: 'FFL_BOX_25', palletCode: 'PALET_SORT_02', room: 'Помещение 1', warehouse: 'ФФ Москва', status: 'AVAILABLE' });
    expect(db.productMark.findMany).toHaveBeenCalledOnce();
  });
  it.each([code, ']d2' + full, full.replaceAll('\u001d', '<GS>'), '(01)04640569959539(21)5eCUd%lbPYtuV'])('normalizes scanner format %s', async scan => {
    // TEST: suffix and scanner-prefix variants refer to the same serial, never merely the GTIN.
    expect((await setup().service.lookup(scan, user)).found).toBe(true);
  });
  it.each(['MANAGER', 'OPERATOR', 'CLIENT', 'WAREHOUSE_KEEPER'])('denies %s before reading data', async role => {
    // TEST: system:admin permission without an administrator role must not grant this screen.
    const { service, db } = setup();
    await expect(service.lookup(full, { ...user, roleCodes: [role], permissionCodes: ['system:admin'] })).rejects.toThrow();
    expect(db.productMark.findMany).not.toHaveBeenCalled();
  });
  it('is disabled by default and requires an accessible selected warehouse', async () => {
    // TEST: sold installations are opted out; an unscoped query cannot cross branches.
    const { service, db } = setup(); vi.stubEnv('WMS_KIZ_LOCATION_CHECK_ENABLED', 'false');
    await expect(service.lookup(full, user)).rejects.toThrow();
    vi.stubEnv('WMS_KIZ_LOCATION_CHECK_ENABLED', 'true');
    await expect(service.lookup(full, { ...user, activeWarehouseId: null })).rejects.toThrow();
    await expect(service.lookup(full, { ...user, warehouseIds: ['other'] })).rejects.toThrow();
    expect(db.productMark.findMany).not.toHaveBeenCalled();
  });
  it('honors existing system administrator warehouse access without explicit warehouse scopes', async () => {
    // TEST: global owners retain selected-warehouse filtering and the existing hidden-demo-client exclusion.
    const { service, db } = setup();
    expect((await service.lookup(full, { ...user, roleCodes: ['OWNER'], permissionCodes: ['system:admin'], warehouseIds: [], hiddenClientIds: ['demo'] })).found).toBe(true);
    const query = db.productMark.findMany.mock.calls[0]?.[0] as any;
    expect(query.where.clientId).toEqual({ notIn: ['demo'] });
    expect(query.where.AND[1].OR[0]).toEqual({ box: { warehouseId: 'wh' } });
  });
  it('applies client and warehouse scope in the database query', async () => {
    // TEST: another client's code must not be disclosed even to a limited administrator.
    const { service, db } = setup([]); await service.lookup(full, user);
    const query = db.productMark.findMany.mock.calls[0]?.[0] as any;
    expect(query.where.clientId).toEqual({ in: ['client'] });
    expect(query.where.AND[1].OR).toEqual([{ box: { warehouseId: 'wh' } }, { boxId: null, stockMovement: { warehouseId: 'wh' } }]);
  });
  it('returns not found without inventing a location', async () => {
    // TEST: no current mark row is a normal, explicit not-found result.
    const { service, db } = setup([]);
    expect(await service.lookup(full, user)).toMatchObject({ found: false, matches: [] });
    expect(db.storagePalletBox.findMany).not.toHaveBeenCalled();
  });
  it('reports every duplicate identity instead of selecting a random box', async () => {
    // TEST: two stored encodings of the same serial remain visible as a data conflict.
    const second = { ...mark(), id: 'second', value: code };
    const r = await setup([mark(), second]).service.lookup(full, user);
    expect(r.ambiguous).toBe(true); expect(r.matches).toHaveLength(2);
  });
  it('does not disclose a different client or warehouse through a conflicting pallet link', async () => {
    // TEST: inconsistent placement metadata must not attach another client's pallet to this mark.
    const wrong = placement(); wrong.pallet.clientId = 'other';
    expect((await setup([mark()], [wrong]).service.lookup(full, user)).matches[0]).toMatchObject({ palletCode: null, room: null });
    wrong.pallet.clientId = 'client'; wrong.pallet.warehouseId = 'elsewhere';
    expect((await setup([mark()], [wrong]).service.lookup(full, user)).matches[0]).toMatchObject({ palletCode: null, room: null });
    const foreignBox = mark(); foreignBox.box.clientId = 'other';
    const result = (await setup([foreignBox]).service.lookup(full, user)).matches[0];
    expect(result).toMatchObject({ boxCode: null, palletCode: null, room: null, warehouse: null });
    expect(result.locationWarning).toBeTruthy();
  });
  it('does not accept another serial sharing the search prefix', async () => {
    // TEST: serial boundaries matter when querying prefix variants.
    const r = await setup([{ ...mark(), value: code + 'X' }]).service.lookup(full, user);
    expect(r.found).toBe(false);
  });
  it('does not turn a historical movement into current storage for a boxless mark', async () => {
    // TEST: packing/shipping can retain history while the current box is unassigned.
    const r = await setup([{ ...mark(), box: null, status: 'PACKING', stockMovement: { warehouseId: 'wh', warehouse: { name: 'ФФ Москва' } } }], []).service.lookup(full, user);
    expect(r.matches[0]).toMatchObject({ status: 'PACKING', boxCode: null, palletCode: null, room: null });
  });
  it('finds placement stored by box code and falls back to the box room when no pallet is assigned', async () => {
    // TEST: older placement rows may have boxId=null but still identify the physical box by code.
    expect((await setup([mark()], [{ ...placement(), boxId: null }]).service.lookup(full, user)).matches[0].palletCode).toBe('PALET_SORT_02');
    const m = mark(); m.box.zone = { name: 'Комната 2', warehouseId: 'wh' } as any;
    expect((await setup([m], []).service.lookup(full, user)).matches[0]).toMatchObject({ palletCode: null, room: 'Комната 2' });
  });
  it.each(['2051610924437', '0104', '', 'x'.repeat(1025)])('rejects a barcode or incomplete scan', async scan => {
    // TEST: invalid input cannot launch a broad GTIN or catalogue search.
    const { service, db } = setup(); await expect(service.lookup(scan, user)).rejects.toThrow();
    expect(db.productMark.findMany).not.toHaveBeenCalled();
  });
});
