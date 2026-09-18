import { PrismaService } from '../../common/prisma/prisma.service';

type MonitorDevice = {
  liveState: Record<string, unknown> | null;
  progress: { total: number; completed: number; remaining: number } | null;
};

// FIX: enrich only an explicitly open FBO screen; never infer current work from an old scan.
export async function addFboMonitoring<T extends MonitorDevice>(prisma: PrismaService, devices: T[], isDemo: boolean): Promise<T[]> {
  if (process.env.WMS_FBO_MONITORING_ENABLED !== 'true') return devices;
  const ids = [...new Set(devices.filter(d => d.liveState?.screen === 'FBO_TWO_STAGE')
    .map(d => String(d.liveState?.requestId || '').trim()).filter(Boolean))];
  if (!ids.length) return devices;
  const requests = await prisma.clientRequest.findMany({
    where: { id: { in: ids }, client: { isDemo } },
    select: { id: true, number: true, client: { select: { name: true } },
      items: { select: { quantity: true } },
      fboAssembly: { select: { phase: true, units: { where: { state: { not: 'RETURNED' } }, select: { state: true } },
        boxes: { select: { confirmedAt: true } } } } },
  });
  const byId = new Map(requests.map(r => [r.id, r]));
  return devices.map(device => {
    const state = device.liveState;
    if (state?.screen !== 'FBO_TWO_STAGE') return device;
    const request = byId.get(String(state.requestId || '').trim());
    if (!request) return device;
    const assembly = request.fboAssembly;
    // FIX: show the current worker's workflow while both operations share one request.
    const phase = process.env.WMS_FBO_PARALLEL_PACKING_ENABLED === 'true' && assembly?.phase === 'PICKING'
      && state.fboWorkflow === 'PACKING' && assembly.units.length > 0 ? 'PACKING' : assembly?.phase ?? 'NOT_STARTED';
    const needed = request.items.reduce((n, item) => n + item.quantity, 0);
    const picked = assembly?.units.length ?? 0;
    const packed = assembly?.units.filter(unit => unit.state === 'PACKED').length ?? 0;
    const labels: Record<string, string> = { NOT_STARTED: 'Ожидает начала отбора', PICKING: 'Отбор товара', PACKING: 'Упаковка', CONTROL: 'Проверка коробов', COMPLETED: 'Завершена' };
    const control = phase === 'CONTROL';
    const total = control ? assembly!.boxes.length : needed;
    const completed = control ? assembly!.boxes.filter(box => box.confirmedAt).length
      : phase === 'PICKING' || phase === 'NOT_STARTED' ? picked : packed;
    return { ...device, progress: { total, completed, remaining: Math.max(0, total - completed) },
      liveState: { ...state, requestNumber: request.number, clientName: request.client.name,
        screenLabel: `ФБО · ${labels[phase] || phase}${control ? ' (короба)' : ''}`,
        stage: phase, total, completed, remaining: Math.max(0, total - completed),
        lastAction: `Отобрано ${picked} из ${needed} · Упаковано ${packed} из ${needed}` } };
  });
}
