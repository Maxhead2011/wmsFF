import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BILLING_SELLER } from '../billing/billing-printing';
import type { AuthUser } from '../auth/auth.types';
import { UpsertOwnCompanyDto } from './dto/upsert-own-company.dto';

const companyInclude = {
  bankAccounts: {
    orderBy: [{ isDefault: 'desc' as const }, { createdAt: 'asc' as const }],
  },
};

@Injectable()
export class OwnCompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const admin = this.isSystemAdmin(user);
    if (admin) await this.ensureDefaultCompany();
    const scope = admin ? undefined : await this.companyScope(user, 'read');
    const companies = await (this.prisma as any).ownCompany.findMany({
      where: scope,
      include: companyInclude,
      orderBy: [{ isDefault: 'desc' }, { shortName: 'asc' }],
    });
    return companies.map(serializeCompany);
  }

  async create(dto: UpsertOwnCompanyDto, user: AuthUser) {
    const admin = this.isSystemAdmin(user);
    const warehouseId = admin
      ? await this.resolveAdminWarehouseId(dto.warehouseId)
      : await this.requireWriteScope(user);
    if (warehouseId && dto.isDefault) {
      throw new BadRequestException('Компания филиала не может быть глобальной компанией по умолчанию.');
    }
    return this.prisma.$transaction(async (tx) => {
      const shouldBeDefault = warehouseId
        ? false
        : dto.isDefault ?? ((await (tx as any).ownCompany.count({ where: { warehouseId: null } })) === 0);
      const bankAccounts = normalizeBankAccounts(dto.bankAccounts);
      if (shouldBeDefault) {
        await (tx as any).ownCompany.updateMany({ where: { warehouseId: null }, data: { isDefault: false } });
      }

      const company = await (tx as any).ownCompany.create({
        data: {
          ...this.companyData(dto, shouldBeDefault, bankAccounts),
          warehouseId,
          bankAccounts: dto.bankAccounts
            ? { create: bankAccounts.map(bankAccountData) }
            : undefined,
        },
        include: companyInclude,
      });
      if (warehouseId) {
        await (tx as any).warehouse.updateMany({
          where: { id: warehouseId },
          data: { ownCompanyId: company.id },
        });
      } else if ((await (tx as any).ownCompany.count({ where: { isActive: true, warehouseId: null } })) === 1) {
        await tx.client.updateMany({
          where: {
            ownCompanyId: null,
            warehouseLinks: {
              none: { warehouse: { ownCompanyId: { not: null } } },
            },
          },
          data: { ownCompanyId: company.id },
        });
      }
      return serializeCompany(company);
    });
  }

  async update(id: string, dto: UpsertOwnCompanyDto, user: AuthUser) {
    const company = await this.findScopedOrThrow(id, user, 'write');
    const admin = this.isSystemAdmin(user);
    const warehouseId = admin
      ? dto.warehouseId === undefined
        ? company.warehouseId ?? null
        : await this.resolveAdminWarehouseId(dto.warehouseId)
      : company.warehouseId ?? null;
    const isDefault = admin ? dto.isDefault ?? company.isDefault : company.isDefault;
    if (warehouseId && isDefault) {
      throw new BadRequestException('Компания филиала не может быть глобальной компанией по умолчанию.');
    }
    return this.prisma.$transaction(async (tx) => {
      const bankAccounts = normalizeBankAccounts(dto.bankAccounts);
      if (admin && dto.isDefault) {
        await (tx as any).ownCompany.updateMany({
          where: { id: { not: id }, warehouseId: null },
          data: { isDefault: false },
        });
      }

      if (dto.bankAccounts) {
        const existingAccounts = await (tx as any).ownCompanyBankAccount.findMany({
          where: { companyId: id },
          select: { id: true },
        });
        const existingIds = new Set(existingAccounts.map((account: any) => account.id));
        const requestedIds = bankAccounts
          .map((account) => account.id)
          .filter((accountId): accountId is string => Boolean(accountId));
        if (requestedIds.some((accountId) => !existingIds.has(accountId))) {
          throw new BadRequestException('Один из расчётных счетов не принадлежит редактируемой компании.');
        }
        await (tx as any).ownCompanyBankAccount.deleteMany({
          where: {
            companyId: id,
            id: requestedIds.length ? { notIn: requestedIds } : undefined,
          },
        });
        for (const account of bankAccounts) {
          if (account.id) {
            await (tx as any).ownCompanyBankAccount.update({
              where: { id: account.id },
              data: bankAccountData(account),
            });
          } else {
            await (tx as any).ownCompanyBankAccount.create({
              data: { companyId: id, ...bankAccountData(account) },
            });
          }
        }
      }

      await (tx as any).ownCompany.update({
        where: { id },
        data: {
          ...this.companyData(dto, isDefault, bankAccounts),
          warehouseId,
        },
      });
      const updated = await (tx as any).ownCompany.findUnique({
        where: { id },
        include: companyInclude,
      });
      return serializeCompany(updated);
    });
  }

  async findDefaultSeller() {
    await this.ensureDefaultCompany();
    const company = await (this.prisma as any).ownCompany.findFirst({
      where: { isDefault: true, isActive: true, warehouseId: null },
      include: companyInclude,
      orderBy: { updatedAt: 'desc' },
    });

    return company ? ownCompanyToSeller(company) : BILLING_SELLER;
  }

  async findSellerForClient(clientId: string, bankAccountId?: string, warehouseId?: string | null) {
    const company = await this.findCompanyForClient(clientId, warehouseId);
    if (!company) {
      if (bankAccountId) {
        throw new BadRequestException('Для клиента не настроена собственная компания с этим расчётным счётом.');
      }
      return BILLING_SELLER;
    }
    const account = bankAccountId
      ? company.bankAccounts.find((item: any) => item.id === bankAccountId)
      : undefined;
    if (bankAccountId && !account) {
      throw new BadRequestException('Выбранный расчётный счёт не принадлежит компании этого клиента.');
    }
    return ownCompanyToSeller(company, account);
  }

  async listPaymentAccountsForClient(clientId: string, warehouseId?: string | null) {
    const company = await this.findCompanyForClient(clientId, warehouseId);
    if (!company) {
      return {
        company: null,
        bankAccounts: [],
      };
    }
    return {
      company: {
        id: company.id,
        shortName: company.shortName,
        fullName: company.fullName,
        inn: company.inn,
      },
      bankAccounts: company.bankAccounts,
    };
  }

  private async findCompanyForClient(clientId: string, warehouseId?: string | null) {
    await this.ensureDefaultCompany();
    const scopedWarehouse = warehouseId
      ? await (this.prisma as any).warehouse.findFirst({
          where: {
            id: warehouseId,
            clients: { some: { clientId, status: 'ACTIVE' } },
          },
          select: {
            ownCompany: { include: companyInclude },
          },
        })
      : null;
    if (scopedWarehouse?.ownCompany?.isActive) {
      return scopedWarehouse.ownCompany;
    }
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { ownCompanyId: true },
    });
    const selectedCompany = client?.ownCompanyId
      ? await (this.prisma as any).ownCompany.findFirst({
          where: {
            id: client.ownCompanyId,
            isActive: true,
            ...(warehouseId
              ? { OR: [{ warehouseId }, { warehouseId: null }] }
              : {}),
          },
          include: companyInclude,
        })
      : null;
    const warehouseClient = (this.prisma as any).warehouseClient;
    const legacyBranchLink = !warehouseId && !selectedCompany && warehouseClient?.findFirst
      ? await warehouseClient.findFirst({
          where: {
            clientId,
            status: 'ACTIVE',
            warehouse: { ownCompanyId: { not: null } },
          },
          select: { warehouse: { select: { ownCompanyId: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : null;
    const legacyBranchCompanyId = legacyBranchLink?.warehouse?.ownCompanyId;
    const legacyBranchCompany = legacyBranchCompanyId
      ? await (this.prisma as any).ownCompany.findFirst({
          where: { id: legacyBranchCompanyId, isActive: true },
          include: companyInclude,
        })
      : null;
    return (
      selectedCompany ??
      legacyBranchCompany ??
      (await (this.prisma as any).ownCompany.findFirst({
        where: { isDefault: true, isActive: true, warehouseId: null },
        include: companyInclude,
        orderBy: { updatedAt: 'desc' },
      }))
    );
  }

  async uploadAsset(
    id: string,
    kindValue: string,
    file: Express.Multer.File | undefined,
    user: AuthUser,
  ) {
    await this.findScopedOrThrow(id, user, 'write');
    const kind = normalizeAssetKind(kindValue);
    validateCompanyImage(file);
    const prefix = kind === 'stamp' ? 'stamp' : 'signature';
    const company = await (this.prisma as any).ownCompany.update({
      where: { id },
      data: {
        [`${prefix}FileName`]: file.originalname,
        [`${prefix}MimeType`]: file.mimetype,
        [`${prefix}Data`]: file.buffer,
      },
      include: companyInclude,
    });
    return serializeCompany(company);
  }

  async deleteAsset(id: string, kindValue: string, user: AuthUser) {
    await this.findScopedOrThrow(id, user, 'write');
    const kind = normalizeAssetKind(kindValue);
    const prefix = kind === 'stamp' ? 'stamp' : 'signature';
    const company = await (this.prisma as any).ownCompany.update({
      where: { id },
      data: {
        [`${prefix}FileName`]: null,
        [`${prefix}MimeType`]: null,
        [`${prefix}Data`]: null,
      },
      include: companyInclude,
    });
    return serializeCompany(company);
  }

  private async findOrThrow(id: string) {
    const company = await (this.prisma as any).ownCompany.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException('Собственная компания не найдена.');
    }
    return company;
  }

  private async findScopedOrThrow(id: string, user: AuthUser, mode: 'read' | 'write') {
    const company = await (this.prisma as any).ownCompany.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Собственная компания не найдена.');
    if (this.isSystemAdmin(user)) return company;

    const warehouseId = await this.requireWarehouseScope(user, mode);
    if (company.warehouseId === warehouseId) return company;
    // A legacy/global company may be used by a branch as its read-only default,
    // but its requisites must not be edited by that branch manager because the
    // same legal entity can be shared by several branches.
    if (mode === 'write') {
      throw new ForbiddenException('Собственная компания относится к другому филиалу.');
    }
    const branch = await (this.prisma as any).warehouse.findFirst({
      where: { id: warehouseId, ownCompanyId: id },
      select: { id: true },
    });
    if (!branch) throw new ForbiddenException('Собственная компания относится к другому филиалу.');
    return company;
  }

  private async ensureDefaultCompany() {
    if (!(this.prisma as any).ownCompany) {
      return;
    }

    const count = await (this.prisma as any).ownCompany.count({ where: { warehouseId: null } });
    if (count > 0) {
      const activeCompanies = await (this.prisma as any).ownCompany.findMany({
        where: { isActive: true, warehouseId: null },
        select: { id: true },
        take: 2,
      });
      if (activeCompanies.length === 1) {
        await this.prisma.client.updateMany({
          where: {
            ownCompanyId: null,
            warehouseLinks: {
              none: { warehouse: { ownCompanyId: { not: null } } },
            },
          },
          data: { ownCompanyId: activeCompanies[0].id },
        });
      }
      return;
    }

    await (this.prisma as any).ownCompany.create({
      data: {
        shortName: BILLING_SELLER.shortName,
        fullName: BILLING_SELLER.fullName,
        inn: BILLING_SELLER.inn,
        kpp: BILLING_SELLER.kpp || null,
        legalAddress: BILLING_SELLER.address || null,
        bankName: BILLING_SELLER.bankName,
        bankBik: BILLING_SELLER.bankBik,
        bankAccount: BILLING_SELLER.bankAccount,
        correspondentAccount: BILLING_SELLER.correspondentAccount,
        paymentCode: BILLING_SELLER.paymentCode,
        paymentPurposeCode: BILLING_SELLER.paymentPurposeCode,
        isDefault: true,
        warehouseId: null,
        bankAccounts: {
          create: [
            {
              bankName: BILLING_SELLER.bankName,
              bankBik: BILLING_SELLER.bankBik,
              bankAccount: BILLING_SELLER.bankAccount,
              correspondentAccount: BILLING_SELLER.correspondentAccount,
              isDefault: true,
            },
          ],
        },
      },
    });
  }

  private companyData(
    dto: UpsertOwnCompanyDto,
    isDefault?: boolean,
    bankAccounts = normalizeBankAccounts(dto.bankAccounts),
  ) {
    const defaultAccount = bankAccounts.find((account) => account.isDefault) ?? bankAccounts[0];
    return {
      shortName: dto.shortName.trim(),
      fullName: dto.fullName.trim(),
      inn: dto.inn.trim(),
      kpp: trimOrNull(dto.kpp),
      ogrn: trimOrNull(dto.ogrn),
      legalAddress: trimOrNull(dto.legalAddress),
      bankName: trimOrNull(defaultAccount?.bankName ?? dto.bankName),
      bankBik: trimOrNull(defaultAccount?.bankBik ?? dto.bankBik),
      bankAccount: trimOrNull(defaultAccount?.bankAccount ?? dto.bankAccount),
      correspondentAccount: trimOrNull(defaultAccount?.correspondentAccount ?? dto.correspondentAccount),
      paymentCode: trimOrNull(dto.paymentCode),
      paymentPurposeCode: trimOrNull(dto.paymentPurposeCode),
      isDefault: Boolean(isDefault),
      isActive: dto.isActive ?? true,
      comment: trimOrNull(dto.comment),
    };
  }

  async requireWriteScope(user: AuthUser) {
    if (this.isSystemAdmin(user)) return null;
    return this.requireWarehouseScope(user, 'write');
  }

  private async companyScope(user: AuthUser, mode: 'read' | 'write') {
    const warehouseId = await this.requireWarehouseScope(user, mode);
    return {
      OR: [
        { warehouseId },
        { warehouses: { some: { id: warehouseId } } },
      ],
    };
  }

  private async requireWarehouseScope(user: AuthUser, mode: 'read' | 'write') {
    const warehouseId = user.activeWarehouseId?.trim();
    const allowed = mode === 'write' ? user.writableWarehouseIds ?? [] : user.warehouseIds ?? [];
    if (!warehouseId || !allowed.includes(warehouseId)) {
      throw new ForbiddenException(
        mode === 'write'
          ? 'Выберите доступный для изменения филиал.'
          : 'Выберите доступный филиал.',
      );
    }
    const warehouse = await (this.prisma as any).warehouse.findFirst({
      where: { id: warehouseId, isActive: true },
      select: { id: true },
    });
    if (!warehouse) throw new ForbiddenException('Выбранный филиал не найден или отключён.');
    return warehouse.id as string;
  }

  private async resolveAdminWarehouseId(value: string | null | undefined) {
    const warehouseId = value?.trim() || null;
    if (!warehouseId) return null;
    const warehouse = await (this.prisma as any).warehouse.findFirst({
      where: { id: warehouseId, isActive: true },
      select: { id: true },
    });
    if (!warehouse) throw new BadRequestException('Выбранный филиал не найден или отключён.');
    return warehouse.id as string;
  }

  private isSystemAdmin(user: AuthUser) {
    return user.permissionCodes.includes('system:admin');
  }
}

export function ownCompanyToSeller(company: any, selectedAccount?: any) {
  const account =
    selectedAccount ??
    company.bankAccounts?.find((item: any) => item.isDefault) ??
    company.bankAccounts?.[0];
  return {
    shortName: company.shortName,
    fullName: company.fullName,
    inn: company.inn,
    kpp: company.kpp ?? '',
    ogrn: company.ogrn ?? '',
    address: company.legalAddress ?? '',
    bankName: account?.bankName ?? company.bankName ?? '',
    bankBik: account?.bankBik ?? company.bankBik ?? '',
    bankInn: account?.bankInn ?? '',
    bankKpp: account?.bankKpp ?? '',
    bankAccount: account?.bankAccount ?? company.bankAccount ?? '',
    correspondentAccount: account?.correspondentAccount ?? company.correspondentAccount ?? '',
    paymentCode: company.paymentCode ?? '',
    paymentPurposeCode: company.paymentPurposeCode ?? '',
    stampDataUrl: company.stampData
      ? `data:${company.stampMimeType || 'image/png'};base64,${Buffer.from(company.stampData).toString('base64')}`
      : null,
    signatureDataUrl: company.signatureData
      ? `data:${company.signatureMimeType || 'image/png'};base64,${Buffer.from(company.signatureData).toString('base64')}`
      : null,
  };
}

function serializeCompany(company: any) {
  const {
    stampData: _stampData,
    signatureData: _signatureData,
    ...safe
  } = company;
  return {
    ...safe,
    hasStamp: Boolean(company.stampData),
    hasSignature: Boolean(company.signatureData),
  };
}

function normalizeAssetKind(value: string) {
  if (value === 'stamp' || value === 'signature') return value;
  throw new BadRequestException('Тип изображения должен быть stamp или signature.');
}

function validateCompanyImage(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
  if (!file?.buffer?.length) throw new BadRequestException('Выберите изображение.');
  if (file.buffer.length > 5 * 1024 * 1024) {
    throw new BadRequestException('Изображение превышает 5 МБ.');
  }
  const png = file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  if (!png && !jpeg) {
    throw new BadRequestException('Поддерживаются только корректные PNG и JPEG.');
  }
  if (!['image/png', 'image/jpeg'].includes(file.mimetype)) {
    throw new BadRequestException('Поддерживаются только PNG и JPEG.');
  }
}

function normalizeBankAccounts(accounts: UpsertOwnCompanyDto['bankAccounts']) {
  if (!accounts?.length) {
    return [];
  }
  const requestedDefault = accounts.findIndex((account) => account.isDefault);
  const defaultIndex = requestedDefault >= 0 ? requestedDefault : 0;
  return accounts.map((account, index) => ({
    ...account,
    isDefault: index === defaultIndex,
  }));
}

function bankAccountData(
  account: ReturnType<typeof normalizeBankAccounts>[number],
) {
  return {
    bankName: account.bankName.trim(),
    bankBik: account.bankBik.trim(),
    bankInn: trimOrNull(account.bankInn),
    bankKpp: trimOrNull(account.bankKpp),
    bankAccount: account.bankAccount.trim(),
    correspondentAccount: trimOrNull(account.correspondentAccount),
    isDefault: account.isDefault,
    comment: trimOrNull(account.comment),
  };
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
