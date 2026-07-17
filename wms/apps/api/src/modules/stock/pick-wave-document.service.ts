import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockStatus, type PickWaveStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import type { PickWaveDocumentPayload, PickWaveDocumentRow, WaveAllocation } from './pick-wave-document.types';
import { buildPickWaveWorkbook, pickWaveXlsxMimeType } from './pick-wave-document-xlsx';

type ResultLine = {
  itemId: string;
  pickedQuantity: number;
  allocations: Array<{
    boxId: string | null;
    palletId: string | null;
    quantity: number;
  }>;
};

@Injectable()
export class PickWaveDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async getWaveDocument(waveId: string, user: AuthUser) {
    const wave = await this.prisma.pickWave.findUnique({
      where: { id: waveId },
      include: pickWaveDocumentInclude,
    });
    if (!wave) {
      throw new NotFoundException('Волна сборки не найдена.');
    }

    wave.requests.forEach((link) => this.clientScopes.requireClientAccess(user, link.request.clientId, 'read'));

    const rows = wave.requests.flatMap((link) =>
      link.request.items.map((item) => ({
        link,
        item,
      })),
    );
    const pickedLinesByItemId = this.pickedLinesByItemId(wave.requests);
    const plannedAllocations = await this.buildPlannedAllocations(
      rows
        .filter(({ item }) => !pickedLinesByItemId.has(item.id))
        .map(({ item, link }) => ({
          itemId: item.id,
          clientId: link.request.clientId,
          skuId: item.skuId,
          quantity: item.quantity,
        })),
    );
    const actualBoxCodes = await this.loadActualLocationCodes([...pickedLinesByItemId.values()]);

    const documentRows: PickWaveDocumentRow[] = rows.map(({ link, item }, index) => {
      const pickedLine = pickedLinesByItemId.get(item.id);
      const allocations = pickedLine
        ? pickedLine.allocations.map((allocation) => ({
            ...actualBoxCodes.location(allocation.boxId, allocation.palletId),
            boxId: allocation.boxId,
            boxCode: allocation.boxId ? actualBoxCodes.boxes.get(allocation.boxId) ?? allocation.boxId : null,
            palletId: allocation.palletId,
            palletCode: allocation.palletId ? actualBoxCodes.pallets.get(allocation.palletId) ?? allocation.palletId : null,
            quantity: allocation.quantity,
            source: 'picked' as const,
          }))
        : plannedAllocations.get(item.id) ?? [];

      return {
        position: index + 1,
        requestId: link.request.id,
        requestTitle: link.request.title,
        requestStatus: link.request.status,
        waveRequestStatus: link.status,
        clientCode: link.request.client.code,
        clientName: link.request.client.name,
        itemId: item.id,
        skuId: item.skuId,
        internalSku: item.sku?.internalSku ?? null,
        name: item.name ?? item.sku?.name ?? null,
        barcode: item.barcode,
        requestedQuantity: item.quantity,
        pickedQuantity: pickedLine?.pickedQuantity ?? 0,
        allocations,
      };
    });

    const payload: PickWaveDocumentPayload = {
      waveId: wave.id,
      waveNumber: wave.waveNumber,
      title: `Лист сборки ${wave.waveNumber}`,
      fileName: `${safeFileName(`pick-wave-${wave.waveNumber}`)}.html`,
      status: wave.status,
      statusLabel: waveStatusLabel(wave.status),
      comment: wave.comment,
      createdAt: wave.createdAt.toISOString(),
      updatedAt: wave.updatedAt.toISOString(),
      generatedAt: new Date().toISOString(),
      createdBy: wave.createdBy
        ? {
            id: wave.createdBy.id,
            email: wave.createdBy.email,
            name: wave.createdBy.name,
          }
        : null,
      assignedPicker: wave.assignedPicker
        ? {
            id: wave.assignedPicker.id,
            email: wave.assignedPicker.email,
            name: wave.assignedPicker.name,
          }
        : null,
      requestsCount: wave.requests.length,
      rowsCount: documentRows.length,
      totalRequested: documentRows.reduce((sum, row) => sum + row.requestedQuantity, 0),
      totalPicked: documentRows.reduce((sum, row) => sum + row.pickedQuantity, 0),
      rows: documentRows,
    };

    return {
      ...payload,
      html: renderWaveHtml(payload),
    };
  }

  async getWaveDocumentXlsx(waveId: string, user: AuthUser) {
    const document = await this.getWaveDocument(waveId, user);

    return {
      fileName: document.fileName.replace(/\.html$/i, '.xlsx'),
      mimeType: pickWaveXlsxMimeType(),
      content: buildPickWaveWorkbook(document),
    };
  }

  private pickedLinesByItemId(requests: Array<{ result: Prisma.JsonValue | null }>) {
    const pickedLines = new Map<string, ResultLine>();
    requests.forEach((request) => {
      this.readPickedLines(request.result).forEach((line) => pickedLines.set(line.itemId, line));
    });
    return pickedLines;
  }

  private readPickedLines(value: Prisma.JsonValue | null): ResultLine[] {
    if (!isRecord(value) || !Array.isArray(value.pickedLines)) {
      return [];
    }

    return value.pickedLines.flatMap((line) => {
      if (!isRecord(line) || typeof line.itemId !== 'string') {
        return [];
      }

      return [
        {
          itemId: line.itemId,
          pickedQuantity: toNumber(line.pickedQuantity),
          allocations: Array.isArray(line.allocations)
            ? line.allocations.flatMap((allocation) => {
                if (!isRecord(allocation)) {
                  return [];
                }

                return [
                  {
                    boxId: typeof allocation.boxId === 'string' ? allocation.boxId : null,
                    palletId: typeof allocation.palletId === 'string' ? allocation.palletId : null,
                    quantity: toNumber(allocation.quantity),
                  },
                ];
              })
            : [],
        },
      ];
    });
  }

  private async buildPlannedAllocations(
    lines: Array<{ itemId: string; clientId: string; skuId: string | null; quantity: number }>,
  ) {
    const result = new Map<string, WaveAllocation[]>();
    const skuIds = [...new Set(lines.map((line) => line.skuId).filter((skuId): skuId is string => Boolean(skuId)))];
    if (skuIds.length === 0) {
      return result;
    }

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        skuId: { in: skuIds },
        status: StockStatus.AVAILABLE,
        quantity: { gt: 0 },
        boxId: { not: null },
      },
      include: {
        box: {
          select: {
            id: true,
            code: true,
            zone: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        pallet: {
          select: {
            id: true,
            code: true,
            zone: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: 'asc' }],
    });
    const remainingByBalance = new Map(balances.map((balance) => [balance.id, balance.quantity]));

    for (const line of lines) {
      if (!line.skuId) {
        result.set(line.itemId, []);
        continue;
      }

      let remaining = line.quantity;
      const allocations: WaveAllocation[] = [];
      for (const balance of balances) {
        if (remaining <= 0) {
          break;
        }
        if (balance.clientId !== line.clientId || balance.skuId !== line.skuId) {
          continue;
        }

        const available = remainingByBalance.get(balance.id) ?? 0;
        if (available <= 0) {
          continue;
        }

        const quantity = Math.min(available, remaining);
        remainingByBalance.set(balance.id, available - quantity);
        remaining -= quantity;
        const zone = balance.box?.zone ?? balance.pallet?.zone ?? null;
        allocations.push({
          zoneId: zone?.id ?? null,
          zoneCode: zone?.code ?? null,
          zoneName: zone?.name ?? null,
          boxId: balance.boxId,
          boxCode: balance.box?.code ?? null,
          palletId: balance.palletId,
          palletCode: balance.pallet?.code ?? null,
          quantity,
          source: 'planned',
        });
      }
      result.set(line.itemId, allocations);
    }

    return result;
  }

  private async loadActualLocationCodes(lines: ResultLine[]) {
    const boxIds = [
      ...new Set(lines.flatMap((line) => line.allocations.map((allocation) => allocation.boxId)).filter((id): id is string => Boolean(id))),
    ];
    const palletIds = [
      ...new Set(
        lines.flatMap((line) => line.allocations.map((allocation) => allocation.palletId)).filter((id): id is string => Boolean(id)),
      ),
    ];

    const [boxes, pallets] = await Promise.all([
      boxIds.length
        ? this.prisma.box.findMany({
            where: { id: { in: boxIds } },
            select: {
              id: true,
              code: true,
              zone: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
          })
        : [],
      palletIds.length
        ? this.prisma.pallet.findMany({
            where: { id: { in: palletIds } },
            select: {
              id: true,
              code: true,
              zone: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
          })
        : [],
    ]);

    const boxZones = new Map(boxes.map((box) => [box.id, box.zone ?? null]));
    const palletZones = new Map(pallets.map((pallet) => [pallet.id, pallet.zone ?? null]));

    return {
      boxes: new Map(boxes.map((box) => [box.id, box.code])),
      pallets: new Map(pallets.map((pallet) => [pallet.id, pallet.code])),
      location: (boxId: string | null, palletId: string | null) => {
        const zone = (boxId ? boxZones.get(boxId) : null) ?? (palletId ? palletZones.get(palletId) : null) ?? null;
        return {
          zoneId: zone?.id ?? null,
          zoneCode: zone?.code ?? null,
          zoneName: zone?.name ?? null,
        };
      },
    };
  }
}

const pickWaveDocumentInclude = {
  createdBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  assignedPicker: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  requests: {
    include: {
      request: {
        select: {
          id: true,
          clientId: true,
          title: true,
          status: true,
          client: {
            select: {
              code: true,
              name: true,
            },
          },
          items: {
            include: {
              sku: {
                select: {
                  id: true,
                  internalSku: true,
                  name: true,
                },
              },
            },
            orderBy: {
              id: 'asc',
            },
          },
        },
      },
    },
    orderBy: {
      requestId: 'asc',
    },
  },
} satisfies Prisma.PickWaveInclude;

function renderWaveHtml(document: PickWaveDocumentPayload) {
  // Русский комментарий: печатный лист волны собирает план и факт отбора в одном HTML,
  // чтобы склад мог открыть его в браузере, распечатать или сохранить без PDF-генератора.
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.title)}</title>
  <style>
    body { color: #111827; font-family: Arial, sans-serif; margin: 28px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 16px; margin: 24px 0 10px; }
    .muted { color: #64748b; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0; }
    .box { border: 1px solid #d7dde5; border-radius: 6px; padding: 10px; }
    .box span { color: #64748b; display: block; font-size: 12px; }
    .box strong { display: block; font-size: 18px; margin-top: 4px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #d7dde5; font-size: 12px; padding: 7px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #334155; text-transform: uppercase; }
    .right { text-align: right; }
    .route { font-weight: 700; }
    .check { width: 20px; }
    @media print {
      body { margin: 12mm; }
      .box { break-inside: avoid; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(document.title)}</h1>
  <p class="muted">Статус: ${escapeHtml(document.statusLabel)} · создана ${formatDate(document.createdAt)} · печать ${formatDateTime(document.generatedAt)}</p>
  <div class="grid">
    <section class="box"><span>Заявок</span><strong>${formatNumber(document.requestsCount)}</strong></section>
    <section class="box"><span>Строк</span><strong>${formatNumber(document.rowsCount)}</strong></section>
    <section class="box"><span>К сборке</span><strong>${formatNumber(document.totalRequested)}</strong></section>
    <section class="box"><span>Собрано</span><strong>${formatNumber(document.totalPicked)}</strong></section>
  </div>
  <section class="box">
    <strong>Комментарий</strong>
    <p>${escapeHtml(document.comment ?? '-')}</p>
    <p class="muted">Создал: ${escapeHtml(document.createdBy?.name ?? document.createdBy?.email ?? '-')}</p>
    <p class="muted">Сборщик: ${escapeHtml(document.assignedPicker?.name ?? document.assignedPicker?.email ?? 'не назначен')}</p>
  </section>
  <h2>Маршрут сборки</h2>
  <table>
    <thead>
      <tr>
        <th class="check">✓</th>
        <th>№</th>
        <th>Заявка</th>
        <th>Клиент</th>
        <th>Зона</th>
        <th>SKU / товар</th>
        <th>ШК</th>
        <th class="right">Нужно</th>
        <th class="right">Факт</th>
        <th>Короба / паллеты</th>
      </tr>
    </thead>
    <tbody>
      ${
        document.rows.length
          ? document.rows
              .map(
                (row) => `<tr>
        <td class="check">□</td>
        <td>${row.position}</td>
        <td>${escapeHtml(row.requestTitle)}<br><span class="muted">${escapeHtml(row.requestStatus)} / ${escapeHtml(row.waveRequestStatus)}</span></td>
        <td>${escapeHtml(row.clientCode)}<br><span class="muted">${escapeHtml(row.clientName)}</span></td>
        <td>${escapeHtml(zoneSummary(row.allocations))}</td>
        <td><span class="route">${escapeHtml(row.internalSku ?? '-')}</span><br>${escapeHtml(row.name ?? '-')}</td>
        <td>${escapeHtml(row.barcode ?? '-')}</td>
        <td class="right">${formatNumber(row.requestedQuantity)}</td>
        <td class="right">${row.pickedQuantity ? formatNumber(row.pickedQuantity) : '-'}</td>
        <td>${escapeHtml(allocationSummary(row.allocations))}</td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="10">В волне нет строк для сборки.</td></tr>'
      }
    </tbody>
  </table>
</body>
</html>`;
}

function allocationSummary(allocations: WaveAllocation[]) {
  if (allocations.length === 0) {
    return 'нет доступного места';
  }

  return allocations
    .map((allocation) => {
      const box = allocation.boxCode ?? allocation.boxId ?? 'без короба';
      const pallet = allocation.palletCode ? ` / ${allocation.palletCode}` : '';
      const source = allocation.source === 'picked' ? 'факт' : 'план';
      return `${box}${pallet}: ${formatNumber(allocation.quantity)} (${source})`;
    })
    .join('; ');
}

function zoneSummary(allocations: WaveAllocation[]) {
  const zones = [
    ...new Set(
      allocations
        .map((allocation) => (allocation.zoneCode ? `${allocation.zoneCode}${allocation.zoneName ? ` · ${allocation.zoneName}` : ''}` : 'без зоны'))
        .filter(Boolean),
    ),
  ];

  return zones.length ? zones.join('; ') : 'без зоны';
}

function waveStatusLabel(value: PickWaveStatus) {
  const labels: Record<PickWaveStatus, string> = {
    PLANNED: 'План',
    BALANCE_REVIEW: 'Проверка балансов',
    FROZEN: 'План зафиксирован',
    PICKING: 'Сборка',
    DONE: 'Готово',
    FAILED: 'Ошибка',
    CANCELLED: 'Отмена',
  };
  return labels[value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_');
}
