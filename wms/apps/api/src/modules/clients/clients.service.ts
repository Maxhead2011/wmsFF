import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientKind, ClientLogisticsInvoiceMode, ClientStatus, ClientStorageBillingMode, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

type ClientImportIssue = {
  row: number;
  code?: string;
  name?: string;
  message: string;
  severity: 'warning' | 'error';
};

type ParsedClientImportRow = {
  row: number;
  name: string;
  code: string | null;
  registrationDate: Date | null;
};

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  list(user: AuthUser, includeArchived = false) {
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const where: Prisma.ClientWhereInput = {
      ...(clientFilter === undefined ? {} : { id: clientFilter }),
      isDemo: Boolean(user.isDemo),
      ...(user.activeWarehouseId && !user.roleCodes.includes('CLIENT')
        ? {
            warehouseLinks: {
              some: {
                warehouseId: user.activeWarehouseId,
                status: 'ACTIVE',
              },
            },
          }
        : {}),
      ...(includeArchived ? {} : { status: { not: ClientStatus.ARCHIVED } }),
    };

    return this.prisma.client.findMany({
      where,
      orderBy: { name: 'asc' },
      select: this.clientSummarySelect(),
    });
  }

  async get(id: string, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, id, 'read');

    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        fulfillmentManager: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        _count: {
          select: {
            skus: true,
            boxes: true,
            pallets: true,
            movements: true,
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const warehouseId = user.activeWarehouseId?.trim() || null;
    if (warehouseId && !this.hasGlobalClientManagement(user) && !user.roleCodes.includes('CLIENT')) {
      const [boxes, pallets, movements] = await Promise.all([
        this.prisma.box.count({ where: { clientId: id, warehouseId } }),
        this.prisma.pallet.count({
          where: { clientId: id, zone: { warehouseId } },
        }),
        this.prisma.stockMovement.count({
          where: {
            clientId: id,
            OR: [
              { warehouseId },
              { warehouseId: null, box: { warehouseId } },
            ],
          },
        }),
      ]);

      return {
        ...client,
        _count: {
          ...client._count,
          boxes,
          pallets,
          movements,
        },
      };
    }

    return client;
  }

  async create(dto: CreateClientDto, user: AuthUser) {
    const warehouseId = this.resolveManagementWarehouse(user);
    await this.ensureFulfillmentManagerExists(dto.fulfillmentManagerUserId);
    const ownCompanyId = await this.resolveOwnCompanyId(dto.ownCompanyId, user, warehouseId);

    return this.createWithGeneratedCode(dto, ownCompanyId, warehouseId);
  }

  async importWorkbook(file: Express.Multer.File | undefined, user: AuthUser) {
    const warehouseId = this.resolveManagementWarehouse(user);
    const ownCompanyId = await this.resolveOwnCompanyId(undefined, user, warehouseId);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Выберите XLSX-файл с клиентами.');
    }

    const parsed = parseClientImportWorkbook(file.buffer);
    const issues = [...parsed.issues];
    const validRows = parsed.rows.filter((row) => !issues.some((issue) => issue.row === row.row && issue.severity === 'error'));
    const providedCodes = [...new Set(validRows.map((row) => row.code).filter((code): code is string => Boolean(code)))];
    const existingClients = providedCodes.length
      ? await this.prisma.client.findMany({
          where: { code: { in: providedCodes } },
          select: { code: true, name: true },
        })
      : [];
    const existingByCode = new Map(existingClients.map((client) => [client.code, client.name]));
    const created = [];

    for (const row of validRows) {
      if (row.code && existingByCode.has(row.code)) {
        issues.push({
          row: row.row,
          code: row.code,
          name: row.name,
          severity: 'warning',
          message: `Клиент с кодом ${row.code} уже есть в WMS, строка пропущена.`,
        });
        continue;
      }

      try {
        const client = row.code
          ? await this.createWithCode({
              code: row.code,
              name: row.name,
              registrationDate: row.registrationDate,
            }, warehouseId, ownCompanyId)
          : await this.createImportedClientWithGeneratedCode(row, warehouseId, ownCompanyId);
        created.push(client);
        if (row.code) {
          existingByCode.set(row.code, row.name);
        }
      } catch (caught) {
        if (!isUniqueClientCodeError(caught)) {
          throw caught;
        }
        issues.push({
          row: row.row,
          code: row.code ?? undefined,
          name: row.name,
          severity: 'warning',
          message: 'Код клиента уже занят, строка пропущена.',
        });
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;

    return {
      fileName: file.originalname,
      summary: {
        sourceRows: parsed.rows.length,
        created: created.length,
        skipped: parsed.rows.length - created.length,
        errors,
        warnings,
      },
      issues,
      clients: created,
    };
  }

  async update(id: string, dto: UpdateClientDto, user: AuthUser) {
    const warehouseId = await this.requireClientManagementAccess(id, user);
    await this.ensureFulfillmentManagerExists(dto.fulfillmentManagerUserId);
    const ownCompanyId =
      dto.ownCompanyId === undefined
        ? undefined
        : await this.resolveOwnCompanyId(dto.ownCompanyId, user, warehouseId);

    try {
      return await this.prisma.client.update({
        where: { id },
        data: {
          ...(dto.clientKind === undefined ? {} : { clientKind: dto.clientKind }),
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
          ...(dto.fulfillmentManagerUserId === undefined
            ? {}
            : { fulfillmentManagerUserId: normalizeNullableString(dto.fulfillmentManagerUserId) }),
          ...(ownCompanyId === undefined ? {} : { ownCompanyId }),
          ...(dto.storageAccountingEnabled === undefined ? {} : { storageAccountingEnabled: dto.storageAccountingEnabled }),
          ...(dto.logisticsInvoiceMode === undefined ? {} : { logisticsInvoiceMode: dto.logisticsInvoiceMode }),
          ...(dto.storageBillingMode === undefined ? {} : { storageBillingMode: dto.storageBillingMode }),
          ...(dto.storesWithoutBoxes === undefined ? {} : { storesWithoutBoxes: dto.storesWithoutBoxes }),
          ...(dto.stockBalanceMode === undefined ? {} : { stockBalanceMode: dto.stockBalanceMode }),
          ...(dto.onlineReceiptVisibleToClient === undefined
            ? {}
            : { onlineReceiptVisibleToClient: dto.onlineReceiptVisibleToClient }),
          ...(dto.fbsCalculatorEnabled === undefined
            ? {}
            : { fbsCalculatorEnabled: dto.fbsCalculatorEnabled }),
          ...(dto.relabelingEnabled === undefined
            ? {}
            : { relabelingEnabled: dto.relabelingEnabled }),
          ...nullableUpdateClientData(dto),
        },
        select: this.clientSummarySelect(),
      });
    } catch (caught) {
      if (isRecordNotFoundError(caught)) {
        throw new NotFoundException('Клиент не найден.');
      }
      throw caught;
    }
  }

  async updateStatus(id: string, status: string, user: AuthUser) {
    const warehouseId = await this.requireClientManagementAccess(id, user);
    if (!this.hasGlobalClientManagement(user) && warehouseId) {
      const activeBranches = await this.prisma.warehouseClient.count({
        where: { clientId: id, status: 'ACTIVE' },
      });
      if (activeBranches > 1) {
        throw new BadRequestException(
          'Клиент работает в нескольких филиалах. Общий статус может изменить только администратор сети.',
        );
      }
    }
    const normalizedStatus = normalizeClientStatus(status);

    try {
      return await this.prisma.client.update({
        where: { id },
        data: { status: normalizedStatus },
        select: this.clientSummarySelect(),
      });
    } catch (caught) {
      if (isRecordNotFoundError(caught)) {
        throw new NotFoundException('Клиент не найден.');
      }
      throw caught;
    }
  }

  async delete(id: string, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);

    const client = await this.prisma.client.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        _count: {
          select: {
            skus: true,
            boxes: true,
            pallets: true,
            movements: true,
            requests: true,
            billingCharges: true,
            billingInvoices: true,
            billingPayments: true,
            deliveryRequests: true,
            requestFiles: true,
            requestPackages: true,
            notifications: true,
            marketplaceConnections: true,
            productMarks: true,
            requestComments: true,
            requestEvents: true,
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const blockers = clientDeleteBlockers(client._count);
    if (blockers.length > 0) {
      throw new BadRequestException(`Клиента нельзя удалить, потому что есть связанные данные: ${blockers.join(', ')}. Заблокируйте клиента, чтобы он не использовался в работе.`);
    }

    try {
      await this.prisma.$transaction([
        this.prisma.userClient.deleteMany({ where: { clientId: id } }),
        this.prisma.clientNotificationPreference.deleteMany({ where: { clientId: id } }),
        this.prisma.client.delete({ where: { id } }),
      ]);
    } catch (caught) {
      if (isRecordNotFoundError(caught)) {
        throw new NotFoundException('Клиент не найден.');
      }
      if (isForeignKeyError(caught)) {
        throw new BadRequestException('Клиента нельзя удалить, потому что к нему привязаны данные. Заблокируйте клиента, чтобы он не использовался в работе.');
      }
      throw caught;
    }

    return {
      id: client.id,
      code: client.code,
      name: client.name,
      deleted: true,
    };
  }

  private async createWithGeneratedCode(
    dto: CreateClientDto,
    ownCompanyId: string | null,
    warehouseId?: string | null,
  ) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = await this.nextClientCode();
      try {
        return await this.prisma.client.create({
          data: {
            code,
            clientKind: dto.clientKind,
            name: dto.name.trim(),
            legalName: dto.legalName.trim(),
            inn: dto.inn.trim(),
            ...optionalCreateClientData(dto),
            storageAccountingEnabled: dto.storageAccountingEnabled ?? false,
            logisticsInvoiceMode: dto.logisticsInvoiceMode ?? ClientLogisticsInvoiceMode.SEPARATE,
            storageBillingMode: dto.storageBillingMode ?? ClientStorageBillingMode.MONTHLY,
            storesWithoutBoxes: dto.storesWithoutBoxes ?? false,
            stockBalanceMode: dto.stockBalanceMode ?? 'PALLET_SORT',
            onlineReceiptVisibleToClient: dto.onlineReceiptVisibleToClient ?? false,
            fbsCalculatorEnabled: dto.fbsCalculatorEnabled ?? false,
            relabelingEnabled: dto.relabelingEnabled ?? false,
            fulfillmentManagerUserId: normalizeNullableString(dto.fulfillmentManagerUserId),
            ownCompanyId,
            warehouseLinks: warehouseId
              ? {
                  create: {
                    warehouseId,
                    status: 'ACTIVE',
                    source: 'LOCAL',
                    activatedAt: new Date(),
                  },
                }
              : undefined,
          },
          select: this.clientSummarySelect(),
        });
      } catch (caught) {
        if (!isUniqueClientCodeError(caught)) {
          throw caught;
        }
      }
    }

    throw new BadRequestException('Не удалось сгенерировать уникальный код клиента.');
  }

  private async createImportedClientWithGeneratedCode(
    row: ParsedClientImportRow,
    warehouseId: string | null,
    ownCompanyId: string | null,
  ) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = await this.nextClientCode();
      try {
        return await this.createWithCode({
          code,
          name: row.name,
          registrationDate: row.registrationDate,
        }, warehouseId, ownCompanyId);
      } catch (caught) {
        if (!isUniqueClientCodeError(caught)) {
          throw caught;
        }
      }
    }

    throw new BadRequestException('Не удалось сгенерировать уникальный код клиента.');
  }

  private createWithCode(
    row: { code: string; name: string; registrationDate: Date | null },
    warehouseId: string | null = null,
    ownCompanyId: string | null = null,
  ) {
    return this.prisma.client.create({
      data: {
        code: row.code,
        clientKind: ClientKind.LEGAL_ENTITY,
        name: row.name,
        legalName: row.name,
        storageAccountingEnabled: false,
        logisticsInvoiceMode: ClientLogisticsInvoiceMode.SEPARATE,
        storageBillingMode: ClientStorageBillingMode.MONTHLY,
        ownCompanyId,
        warehouseLinks: warehouseId
          ? {
              create: {
                warehouseId,
                status: 'ACTIVE',
                source: 'LOCAL',
                activatedAt: new Date(),
              },
            }
          : undefined,
        ...(row.registrationDate ? { createdAt: row.registrationDate } : {}),
      },
      select: this.clientSummarySelect(),
    });
  }

  private async nextClientCode() {
    const latest = await this.prisma.client.findFirst({
      where: {
        code: {
          startsWith: 'CL-',
        },
      },
      orderBy: {
        code: 'desc',
      },
      select: {
        code: true,
      },
    });
    const latestNumber = latest?.code.match(/^CL-(\d+)$/)?.[1];
    const nextNumber = latestNumber ? Number(latestNumber) + 1 : 1;
    return `CL-${String(nextNumber).padStart(6, '0')}`;
  }

  private async ensureFulfillmentManagerExists(userId?: string) {
    const normalized = normalizeNullableString(userId);
    if (!normalized) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: normalized },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('Менеджер фулфилмента не найден.');
    }
  }

  private async resolveOwnCompanyId(
    requestedId: string | undefined,
    user: AuthUser,
    warehouseId: string | null,
  ) {
    if (!this.prisma.ownCompany) return null;
    const normalized = normalizeNullableString(requestedId);
    const scopedToWarehouse = !this.hasGlobalClientManagement(user) && Boolean(warehouseId);
    if (normalized) {
      const company = await (this.prisma as any).ownCompany.findFirst({
        where: {
          id: normalized,
          isActive: true,
          ...(scopedToWarehouse
            ? {
                OR: [
                  { warehouseId },
                  { warehouses: { some: { id: warehouseId } } },
                ],
              }
            : {}),
        },
        select: { id: true },
      });
      if (!company) {
        throw new BadRequestException(
          scopedToWarehouse
            ? 'Собственная компания не относится к выбранному филиалу.'
            : 'Выбранная собственная компания не найдена или отключена.',
        );
      }
      return company.id;
    }
    if (warehouseId) {
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: warehouseId },
        select: { ownCompanyId: true },
      });
      if (warehouse?.ownCompanyId) return warehouse.ownCompanyId;
    }

    const active = await (this.prisma as any).ownCompany.findMany({
      where: {
        isActive: true,
        ...(scopedToWarehouse ? { warehouseId } : {}),
      },
      select: { id: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      take: 2,
    });
    return active.length === 1 ? active[0].id : active[0]?.id ?? null;
  }

  private hasGlobalClientManagement(user: AuthUser) {
    return user.permissionCodes.includes('system:admin') || user.clientScopeMode === 'ALL';
  }

  private resolveManagementWarehouse(user: AuthUser) {
    if (this.hasGlobalClientManagement(user)) {
      return user.activeWarehouseId ?? null;
    }
    const warehouseId = user.activeWarehouseId?.trim() || '';
    if (!warehouseId || !(user.writableWarehouseIds ?? []).includes(warehouseId)) {
      throw new BadRequestException(
        'Для создания клиента нужен активный филиал, доступный менеджеру для записи.',
      );
    }
    return warehouseId;
  }

  private async requireClientManagementAccess(id: string, user: AuthUser) {
    if (this.hasGlobalClientManagement(user)) {
      return user.activeWarehouseId ?? null;
    }
    const warehouseId = this.resolveManagementWarehouse(user);
    if (!warehouseId) {
      throw new BadRequestException('Для управления клиентом выберите филиал.');
    }
    this.clientScopes.requireClientAccess(user, id, 'write');
    const activeWarehouseCount = await this.prisma.warehouseClient.count({
      where: { clientId: id, status: 'ACTIVE' },
    });
    if (activeWarehouseCount > 1) {
      throw new BadRequestException(
        'Клиент работает в нескольких филиалах. Общие реквизиты и настройки может изменить только администратор сети.',
      );
    }
    const link = await this.prisma.warehouseClient.findFirst({
      where: { warehouseId, clientId: id, status: 'ACTIVE' },
      select: { clientId: true },
    });
    if (!link) {
      throw new NotFoundException('Клиент не найден в активном филиале.');
    }
    return warehouseId;
  }

  private clientSummarySelect() {
    return {
      id: true,
      code: true,
      name: true,
      clientKind: true,
      legalName: true,
      inn: true,
      kpp: true,
      ogrn: true,
      legalAddress: true,
      actualAddress: true,
      phone: true,
      telegramChatId: true,
      email: true,
      bankName: true,
      bankBik: true,
      bankAccount: true,
      correspondentAccount: true,
      storageAccountingEnabled: true,
      storagePriceRubPerLiterDay: true,
      logisticsInvoiceMode: true,
      storageBillingMode: true,
      storesWithoutBoxes: true,
      stockBalanceMode: true,
      onlineReceiptVisibleToClient: true,
      fbsCalculatorEnabled: true,
        relabelingEnabled: true,
        factoryEnabled: true,
        factoryName: true,
        factoryCode: true,
      fulfillmentManagerUserId: true,
      ownCompanyId: true,
      ownCompany: {
        select: {
          id: true,
          shortName: true,
          fullName: true,
          inn: true,
          isDefault: true,
          isActive: true,
        },
      },
      fulfillmentManager: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      status: true,
      createdAt: true,
    } as const;
  }
}

type ClientRequisitesDto = CreateClientDto | UpdateClientDto;

const optionalClientFields = [
  'kpp',
  'ogrn',
  'legalAddress',
  'actualAddress',
  'phone',
  'telegramChatId',
  'email',
  'bankName',
  'bankBik',
  'bankAccount',
  'correspondentAccount',
] as const;

function optionalCreateClientData(dto: ClientRequisitesDto) {
  return Object.fromEntries(
    optionalClientFields
      .map((field) => [field, dto[field]?.trim()])
      .filter((entry): entry is [typeof optionalClientFields[number], string] => Boolean(entry[1])),
  );
}

function nullableUpdateClientData(dto: UpdateClientDto) {
  const fields = ['legalName', 'inn', ...optionalClientFields] as const;
  return Object.fromEntries(
    fields
      .filter((field) => dto[field] !== undefined)
      .map((field) => {
        const value = dto[field]?.trim();
        return [field, value || null];
      }),
  );
}

function normalizeNullableString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function isUniqueClientCodeError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002';
}

function isRecordNotFoundError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2025';
}

function isForeignKeyError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2003';
}

function normalizeClientStatus(status: string) {
  if (status === ClientStatus.ACTIVE || status === ClientStatus.PAUSED || status === ClientStatus.ARCHIVED) {
    return status;
  }
  throw new BadRequestException('Статус клиента должен быть ACTIVE, PAUSED или ARCHIVED.');
}

function clientDeleteBlockers(counts: Record<string, number>) {
  const labels: Array<[string, string]> = [
    ['skus', 'SKU'],
    ['boxes', 'короба'],
    ['pallets', 'паллеты'],
    ['movements', 'движения остатков'],
    ['requests', 'заявки'],
    ['billingCharges', 'начисления'],
    ['billingInvoices', 'счета'],
    ['billingPayments', 'платежи'],
    ['deliveryRequests', 'заявки на логистику'],
    ['requestFiles', 'файлы заявок'],
    ['requestPackages', 'упаковки заявок'],
    ['notifications', 'уведомления'],
    ['marketplaceConnections', 'подключения маркетплейсов'],
    ['productMarks', 'КИЗ'],
    ['requestComments', 'комментарии заявок'],
    ['requestEvents', 'история заявок'],
  ];

  return labels
    .filter(([field]) => (counts[field] ?? 0) > 0)
    .map(([field, label]) => `${label}: ${counts[field]}`)
    .slice(0, 6);
}

function parseClientImportWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new BadRequestException('В XLSX-файле нет листов.');
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    blankrows: false,
    defval: '',
  });
  const headerRowIndex = matrix.findIndex((row) => row.some((cell) => normalizeHeader(cell) === 'наименование'));
  if (headerRowIndex < 0) {
    throw new BadRequestException('В файле нужны колонки: Наименование, Дата регистрации, Код.');
  }

  const headers = matrix[headerRowIndex].map(normalizeHeader);
  const nameIndex = headers.indexOf('наименование');
  const dateIndex = headers.indexOf('датарегистрации');
  const codeIndex = headers.indexOf('код');

  if (nameIndex < 0 || dateIndex < 0 || codeIndex < 0) {
    throw new BadRequestException('В файле нужны колонки: Наименование, Дата регистрации, Код.');
  }

  const rows: ParsedClientImportRow[] = [];
  const issues: ClientImportIssue[] = [];
  const codesInFile = new Set<string>();

  matrix.slice(headerRowIndex + 1).forEach((row, index) => {
    const sourceRow = headerRowIndex + index + 2;
    if (row.every((cell) => cellToString(cell) === '')) {
      return;
    }

    const name = cellToString(row[nameIndex]);
    const code = cellToString(row[codeIndex]) || null;
    const registrationDate = parseRegistrationDate(row[dateIndex]);

    rows.push({ row: sourceRow, name, code, registrationDate });

    if (!name) {
      issues.push({
        row: sourceRow,
        severity: 'error',
        message: 'Не заполнено поле "Наименование".',
      });
    }
    if (code && code.length > 64) {
      issues.push({
        row: sourceRow,
        code,
        name,
        severity: 'error',
        message: 'Код клиента длиннее 64 символов.',
      });
    }
    if (code) {
      if (codesInFile.has(code)) {
        issues.push({
          row: sourceRow,
          code,
          name,
          severity: 'error',
          message: 'Такой код уже встречался выше в этом файле.',
        });
      }
      codesInFile.add(code);
    }
    if (cellToString(row[dateIndex]) && !registrationDate) {
      issues.push({
        row: sourceRow,
        code: code ?? undefined,
        name,
        severity: 'error',
        message: 'Дата регистрации должна быть датой или строкой в формате ДД.ММ.ГГГГ.',
      });
    }
  });

  return { rows, issues };
}

function normalizeHeader(value: unknown) {
  return cellToString(value).toLocaleLowerCase('ru-RU').replace(/\s+/g, '');
}

function cellToString(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  return String(value).replace(/\u00a0/g, ' ').trim();
}

function parseRegistrationDate(value: unknown) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : startOfUtcDay(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? startOfUtcDay(parsed.y, parsed.m - 1, parsed.d) : null;
  }

  const text = cellToString(value);
  const ruDate = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ruDate) {
    return startOfUtcDay(Number(ruDate[3]), Number(ruDate[2]) - 1, Number(ruDate[1]));
  }
  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate) {
    return startOfUtcDay(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : startOfUtcDay(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function startOfUtcDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
}
