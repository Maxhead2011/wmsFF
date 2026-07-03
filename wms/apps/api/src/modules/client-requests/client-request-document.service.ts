import { Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestPriority, ClientRequestStatus, ClientRequestType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { clientRequestPackageInclude } from './client-request-packages.include';

@Injectable()
export class ClientRequestDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async getRequestDocument(requestId: string, user: AuthUser): Promise<ClientRequestPrintableDocument> {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      include: requestDocumentInclude,
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'read');

    const rows = request.items.map((item, index) => ({
      position: index + 1,
      skuId: item.skuId,
      internalSku: item.sku?.internalSku ?? null,
      clientSku: item.sku?.clientSku ?? null,
      article: item.sku?.article ?? null,
      barcode: item.barcode,
      name: item.name ?? item.sku?.name ?? null,
      quantity: item.quantity,
      comment: item.comment,
    }));
    const payload = {
      requestId: request.id,
      title: `Заявка ${request.title}`,
      fileName: `${safeFileName(`request-${request.title}-${request.id.slice(0, 8)}`)}.html`,
      type: request.type,
      typeLabel: requestTypeLabel(request.type),
      status: request.status,
      statusLabel: requestStatusLabel(request.status),
      priority: request.priority,
      priorityLabel: requestPriorityLabel(request.priority),
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      desiredDate: request.desiredDate?.toISOString() ?? null,
      comment: request.comment,
      managerComment: request.managerComment,
      contactName: request.contactName,
      contactPhone: request.contactPhone,
      destinationCity: request.destinationCity,
      deliveryAddress: request.deliveryAddress,
      rowsCount: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      client: {
        id: request.client.id,
        code: request.client.code,
        name: request.client.name,
        inn: request.client.inn,
        kpp: request.client.kpp,
        legalAddress: request.client.legalAddress,
        actualAddress: request.client.actualAddress,
        email: request.client.email,
        phone: request.client.phone,
      },
      rows,
      packages: request.packages.map((packagePlace) => ({
        id: packagePlace.id,
        packageCode: packagePlace.packageCode,
        packageType: packagePlace.packageType,
        weightGrams: packagePlace.weightGrams,
        lengthCm: packagePlace.lengthCm == null ? null : Number(packagePlace.lengthCm),
        widthCm: packagePlace.widthCm == null ? null : Number(packagePlace.widthCm),
        heightCm: packagePlace.heightCm == null ? null : Number(packagePlace.heightCm),
        comment: packagePlace.comment,
        items: packagePlace.items.map((item) => ({
          requestItemId: item.requestItemId,
          skuId: item.skuId,
          internalSku: item.sku?.internalSku ?? item.requestItem.sku?.internalSku ?? null,
          name: item.requestItem.name ?? item.sku?.name ?? item.requestItem.sku?.name ?? null,
          barcode: item.barcode ?? item.requestItem.barcode,
          quantity: item.quantity,
        })),
      })),
      createdBy: request.createdBy
        ? {
            id: request.createdBy.id,
            email: request.createdBy.email,
            name: request.createdBy.name,
          }
        : null,
      assignedTo: request.assignedTo
        ? {
            id: request.assignedTo.id,
            email: request.assignedTo.email,
            name: request.assignedTo.name,
          }
        : null,
    };

    return {
      ...payload,
      html: renderRequestHtml(payload),
    };
  }
}

type ClientRequestDocumentPayload = {
  requestId: string;
  title: string;
  fileName: string;
  type: ClientRequestType;
  typeLabel: string;
  status: ClientRequestStatus;
  statusLabel: string;
  priority: ClientRequestPriority;
  priorityLabel: string;
  createdAt: string;
  updatedAt: string;
  desiredDate: string | null;
  comment: string | null;
  managerComment: string | null;
  contactName: string | null;
  contactPhone: string | null;
  destinationCity: string | null;
  deliveryAddress: string | null;
  rowsCount: number;
  totalQuantity: number;
  client: {
    id: string;
    code: string;
    name: string;
    inn: string | null;
    kpp: string | null;
    legalAddress: string | null;
    actualAddress: string | null;
    email: string | null;
    phone: string | null;
  };
  rows: Array<{
    position: number;
    skuId: string | null;
    internalSku: string | null;
    clientSku: string | null;
    article: string | null;
    barcode: string | null;
    name: string | null;
    quantity: number;
    comment: string | null;
  }>;
  packages: Array<{
    id: string;
    packageCode: string;
    packageType: string | null;
    weightGrams: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    comment: string | null;
    items: Array<{
      requestItemId: string;
      skuId: string | null;
      internalSku: string | null;
      name: string | null;
      barcode: string | null;
      quantity: number;
    }>;
  }>;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type ClientRequestPrintableDocument = ClientRequestDocumentPayload & {
  html: string;
};

const requestDocumentInclude = {
  client: {
    select: {
      id: true,
      code: true,
      name: true,
      inn: true,
      kpp: true,
      legalAddress: true,
      actualAddress: true,
      email: true,
      phone: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  assignedTo: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  items: {
    include: {
      sku: {
        select: {
          id: true,
          internalSku: true,
          clientSku: true,
          article: true,
          name: true,
        },
      },
    },
    orderBy: {
      id: 'asc',
    },
  },
  packages: {
    include: clientRequestPackageInclude,
    orderBy: {
      createdAt: 'asc',
    },
  },
} satisfies Prisma.ClientRequestInclude;

function renderRequestHtml(document: ClientRequestDocumentPayload) {
  // Русский комментарий: документ заявки строим в HTML, чтобы один и тот же источник можно было печатать и скачать.
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.title)}</title>
  <style>
    body { color: #111827; font-family: Arial, sans-serif; margin: 32px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 16px; margin: 24px 0 10px; }
    .muted { color: #64748b; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 20px; }
    .box { border: 1px solid #d7dde5; border-radius: 6px; padding: 12px; }
    table { border-collapse: collapse; margin-top: 14px; width: 100%; }
    th, td { border-bottom: 1px solid #d7dde5; font-size: 13px; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #334155; text-transform: uppercase; }
    .right { text-align: right; }
    .total { font-size: 15px; font-weight: 700; }
    @media print { body { margin: 16mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(document.title)}</h1>
  <p class="muted">${escapeHtml(document.typeLabel)} · ${escapeHtml(document.priorityLabel)} · ${escapeHtml(document.statusLabel)}</p>
  <div class="grid">
    <section class="box">
      <strong>Клиент</strong>
      <p>${escapeHtml(document.client.name)} (${escapeHtml(document.client.code)})</p>
      <p>ИНН: ${escapeHtml(document.client.inn ?? '-')} · КПП: ${escapeHtml(document.client.kpp ?? '-')}</p>
      <p>${escapeHtml(document.client.legalAddress ?? document.client.actualAddress ?? '-')}</p>
    </section>
    <section class="box">
      <strong>Заявка</strong>
      <p>Создана: ${formatDate(document.createdAt)}</p>
      <p>Город поставки: ${escapeHtml(document.destinationCity ?? '-')}</p>
      <p>Желаемая дата: ${formatDate(document.desiredDate)}</p>
      <p>Ответственный: ${escapeHtml(document.assignedTo?.name ?? document.createdBy?.name ?? '-')}</p>
    </section>
    <section class="box">
      <strong>Контакт</strong>
      <p>${escapeHtml(document.contactName ?? '-')}</p>
      <p>${escapeHtml(document.contactPhone ?? '-')}</p>
      <p>Адрес: ${escapeHtml(document.deliveryAddress ?? '-')}</p>
    </section>
    <section class="box">
      <strong>Комментарии</strong>
      <p>${escapeHtml(document.comment ?? '-')}</p>
      <p>${escapeHtml(document.managerComment ?? '-')}</p>
    </section>
  </div>
  <h2>Состав заявки</h2>
  <table>
    <thead>
      <tr>
        <th>№</th>
        <th>SKU</th>
        <th>Штрихкод</th>
        <th>Наименование</th>
        <th class="right">Кол-во</th>
        <th>Комментарий</th>
      </tr>
    </thead>
    <tbody>
      ${
        document.rows.length
          ? document.rows
              .map(
                (row) => `<tr>
        <td>${row.position}</td>
        <td>${escapeHtml(row.internalSku ?? row.clientSku ?? row.article ?? '-')}</td>
        <td>${escapeHtml(row.barcode ?? '-')}</td>
        <td>${escapeHtml(row.name ?? '-')}</td>
        <td class="right">${formatNumber(row.quantity)}</td>
        <td>${escapeHtml(row.comment ?? '-')}</td>
      </tr>`,
              )
              .join('')
          : '<tr><td colspan="6">Позиции не указаны.</td></tr>'
      }
    </tbody>
  </table>
  <p class="right total">Позиций: ${formatNumber(document.rowsCount)} · Количество: ${formatNumber(document.totalQuantity)}</p>
  ${
    document.packages.length
      ? `<h2>Упаковочные места</h2>
  <table>
    <thead>
      <tr>
        <th>Место</th>
        <th>Параметры</th>
        <th>Состав</th>
        <th>Комментарий</th>
      </tr>
    </thead>
    <tbody>
      ${document.packages
        .map(
          (packagePlace) => `<tr>
        <td>${escapeHtml(packagePlace.packageCode)}</td>
        <td>${escapeHtml(packageDimensions(packagePlace))}</td>
        <td>${escapeHtml(packageItemsSummary(packagePlace))}</td>
        <td>${escapeHtml(packagePlace.comment ?? '-')}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>`
      : ''
  }
</body>
</html>`;
}

function packageDimensions(packagePlace: ClientRequestDocumentPayload['packages'][number]) {
  const dimensions =
    packagePlace.lengthCm && packagePlace.widthCm && packagePlace.heightCm
      ? `${formatNumber(packagePlace.lengthCm)}x${formatNumber(packagePlace.widthCm)}x${formatNumber(packagePlace.heightCm)} см`
      : null;
  const weight = packagePlace.weightGrams ? `${formatNumber(packagePlace.weightGrams)} г` : null;
  return [packagePlace.packageType, dimensions, weight].filter(Boolean).join(' · ') || '-';
}

function packageItemsSummary(packagePlace: ClientRequestDocumentPayload['packages'][number]) {
  return packagePlace.items
    .map((item) => `${item.internalSku ?? item.name ?? item.barcode ?? item.requestItemId} x ${formatNumber(item.quantity)}`)
    .join(', ');
}

function requestTypeLabel(value: ClientRequestType) {
  const labels: Record<ClientRequestType, string> = {
    INBOUND: 'Приемка',
    OUTBOUND: 'Отгрузка',
    RETURN: 'Возврат',
    DELIVERY: 'Доставка',
    SERVICE: 'Услуга',
    OTHER: 'Другое',
  };
  return labels[value];
}

function requestStatusLabel(value: ClientRequestStatus) {
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

function requestPriorityLabel(value: ClientRequestPriority) {
  const labels: Record<ClientRequestPriority, string> = {
    LOW: 'Низкий',
    NORMAL: 'Обычный',
    HIGH: 'Высокий',
    URGENT: 'Срочный',
  };
  return labels[value];
}

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value: string | null) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_');
}
