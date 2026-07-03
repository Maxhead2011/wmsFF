import { ClientRequestPriority, ClientRequestStatus } from '@prisma/client';
import type { PickInstructionDocument, PickInstructionRowStatus } from './pick-instruction.types';

export function renderPickInstructionHtml(document: PickInstructionDocument) {
  // Русский комментарий: HTML-документ нужен складу сразу в браузере, без обязательного PDF/XLSX генератора.
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
    .warn { color: #b45309; font-weight: 700; }
    .ok { color: #15803d; font-weight: 700; }
    @media print {
      body { margin: 12mm; }
      .box { break-inside: avoid; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(document.title)}</h1>
  <p class="muted">${escapeHtml(document.client.code)} · ${escapeHtml(document.client.name)} · статус заявки: ${escapeHtml(document.requestStatusLabel)} · печать ${formatDateTime(document.generatedAt)}</p>
  <div class="grid">
    <section class="box"><span>Строк</span><strong>${formatNumber(document.rowsCount)}</strong></section>
    <section class="box"><span>К сборке</span><strong>${formatNumber(document.totalRequested)}</strong></section>
    <section class="box"><span>Разложено</span><strong>${formatNumber(document.totalAllocated)}</strong></section>
    <section class="box"><span>Дефицит</span><strong>${formatNumber(document.totalShortage)}</strong></section>
  </div>
  <div class="grid">
    <section class="box"><span>Коробов затронуто</span><strong>${formatNumber(document.boxesCount)}</strong></section>
    <section class="box"><span>Целых коробов</span><strong>${formatNumber(document.fullBoxesCount)}</strong></section>
    <section class="box"><span>Готовых строк</span><strong>${formatNumber(document.readyRowsCount)}</strong></section>
    <section class="box"><span>Строк с дефицитом</span><strong>${formatNumber(document.shortageRowsCount)}</strong></section>
  </div>
  <section class="box">
    <strong>${escapeHtml(document.requestTitle)}</strong>
    <p class="muted">Приоритет: ${escapeHtml(document.priorityLabel)} · желаемая дата: ${document.desiredDate ? formatDate(document.desiredDate) : '-'}</p>
    <p>Город поставки: ${escapeHtml(document.destinationCity ?? '-')}</p>
    <p>Адрес: ${escapeHtml(document.deliveryAddress ?? '-')}</p>
  </section>
  <h2>Маршрут сборки</h2>
  <table>
    <thead>
      <tr>
        <th class="check">✓</th>
        <th>№</th>
        <th>SKU / товар</th>
        <th>ШК</th>
        <th class="right">Нужно</th>
        <th class="right">В плане</th>
        <th class="right">Дефицит</th>
        <th>Короба / паллеты</th>
        <th>Статус</th>
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
        <td><span class="route">${escapeHtml(row.internalSku ?? '-')}</span><br>${escapeHtml(row.name ?? '-')}</td>
        <td>${escapeHtml(row.barcode ?? '-')}</td>
        <td class="right">${formatNumber(row.requestedQuantity)}</td>
        <td class="right">${formatNumber(row.allocatedQuantity)}</td>
        <td class="right">${row.shortageQuantity ? `<span class="warn">${formatNumber(row.shortageQuantity)}</span>` : '-'}</td>
        <td>${escapeHtml(allocationSummary(row.allocations))}</td>
        <td>${statusHtml(row.status, row.statusLabel)}${row.comment ? `<br><span class="muted">${escapeHtml(row.comment)}</span>` : ''}</td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="9">В заявке нет строк для сборки.</td></tr>'
      }
    </tbody>
  </table>
  <h2>Короба</h2>
  <table>
    <thead>
      <tr>
        <th>Короб</th>
        <th>Паллета</th>
        <th class="right">В плане</th>
        <th class="right">Доступно в коробе</th>
        <th>Комментарий</th>
      </tr>
    </thead>
    <tbody>
      ${
        document.boxes.length
          ? document.boxes
              .map(
                (box) => `<tr>
        <td>${escapeHtml(box.boxCode)}</td>
        <td>${escapeHtml(box.palletCode ?? '-')}</td>
        <td class="right">${formatNumber(box.allocatedQuantity)}</td>
        <td class="right">${formatNumber(box.availableQuantity)}</td>
        <td>${escapeHtml(box.comment)}</td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="5">Нет коробов в плане.</td></tr>'
      }
    </tbody>
  </table>
</body>
</html>`;
}

export function requestStatusLabel(value: ClientRequestStatus) {
  const labels: Record<ClientRequestStatus, string> = {
    SUBMITTED: 'Новая',
    IN_REVIEW: 'На проверке',
    APPROVED: 'Согласована',
    IN_WORK: 'В работе',
    PACKED: 'Упакована',
    DONE: 'Сдано',
    CANCELLED: 'Отменена',
    REJECTED: 'Отклонена',
  };
  return labels[value];
}

export function requestPriorityLabel(value: ClientRequestPriority) {
  const labels: Record<ClientRequestPriority, string> = {
    LOW: 'Низкий',
    NORMAL: 'Обычный',
    HIGH: 'Высокий',
    URGENT: 'Срочный',
  };
  return labels[value];
}

export function rowStatusLabel(value: PickInstructionRowStatus) {
  const labels: Record<PickInstructionRowStatus, string> = {
    READY: 'Готово к сборке',
    SHORTAGE: 'Дефицит',
    SKU_NOT_FOUND: 'SKU не найден',
  };
  return labels[value];
}

export function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_');
}

function allocationSummary(allocations: Array<{ boxCode: string; palletCode: string | null; quantity: number }>) {
  if (allocations.length === 0) {
    return 'нет доступного места';
  }

  return allocations
    .map((allocation) => {
      const pallet = allocation.palletCode ? ` / ${allocation.palletCode}` : '';
      return `${allocation.boxCode}${pallet}: ${formatNumber(allocation.quantity)}`;
    })
    .join('; ');
}

function statusHtml(status: PickInstructionRowStatus, label: string) {
  return status === 'READY' ? `<span class="ok">${escapeHtml(label)}</span>` : `<span class="warn">${escapeHtml(label)}</span>`;
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
