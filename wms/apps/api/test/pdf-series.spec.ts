import { afterEach, expect, it, vi } from 'vitest';
import { PrintSeriesService } from '../src/modules/print/print-series.service';
vi.mock('../src/modules/print/pdf-series', () => ({ pdfSeries: vi.fn().mockResolvedValue([{ value: 'WB_1', imageBase64: 'page1' }, { value: 'WB_2', imageBase64: 'page2' }]) }));
import { pdfSeries } from '../src/modules/print/pdf-series';
const user: any = { id: 'u', activeWarehouseId: 'w', permissionCodes: ['print:write'] };
function setup() {
  process.env.WMS_PRINT_SERIES_ENABLED = 'true';
  const db: any = { warehouseClient: { findFirst: vi.fn().mockResolvedValue({}) },
    fbsPrintStation: { findFirst: vi.fn().mockResolvedValue({ id: 's', labelWidthMm: 58, labelHeightMm: 40 }) },
    systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { warehouseId: 'w' } }) } };
  const clients: any = { requireClientAccess: vi.fn() };
  const service = new PrintSeriesService(db, clients);
  const create = vi.spyOn(service, 'create').mockResolvedValue({ id: 'job', status: 'queued', pages: 2 });
  const body = { requestId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', clientId: 'c', stationId: 's', fileBase64: 'PDF' };
  return { service, db, clients, create, body };
}
afterEach(() => { vi.clearAllMocks(); delete process.env.WMS_PRINT_SERIES_ENABLED; });
// TEST: the complete PDF goes to exactly one existing agent-series job in page order.
it('submits all pages once, keeping the operation ID', async () => {
  const { service, create, body } = setup(); await service.createPdf(body, user);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0]).toMatchObject({ requestId: body.requestId, stationId: 's', clientId: 'c', widthMm: 58, heightMm: 40 });
  expect((create.mock.calls[0][0].pages as any[]).map(p => p.value)).toEqual(['WB_1', 'WB_2']);
});
it('rejects foreign clients before rendering', async () => {
  const { service, clients, body, create } = setup(); clients.requireClientAccess.mockImplementation(() => { throw Error('scope'); });
  await expect(service.createPdf(body, user)).rejects.toThrow('scope'); expect(pdfSeries).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
});
it('rejects a station from another branch', async () => {
  const { service, db, body } = setup(); db.systemSetting.findUnique.mockResolvedValue({ value: { warehouseId: 'other' } });
  await expect(service.createPdf(body, user)).rejects.toThrow(); expect(pdfSeries).not.toHaveBeenCalled();
});
it('rejects wrong media without rendering or changing its settings', async () => {
  const { service, db, body } = setup(); db.fbsPrintStation.findFirst.mockResolvedValue({ labelWidthMm: 70, labelHeightMm: 120 });
  await expect(service.createPdf(body, user)).rejects.toThrow('58'); expect(pdfSeries).not.toHaveBeenCalled();
});
it('is disabled on the sold installation', async () => {
  const { service, body } = setup(); delete process.env.WMS_PRINT_SERIES_ENABLED;
  await expect(service.createPdf(body, user)).rejects.toThrow(); expect(pdfSeries).not.toHaveBeenCalled();
});
it('never queues a partially rendered PDF', async () => {
  const { service, body, create } = setup(); vi.mocked(pdfSeries).mockRejectedValueOnce(Error('render'));
  await expect(service.createPdf(body, user)).rejects.toThrow('render'); expect(create).not.toHaveBeenCalled();
});
