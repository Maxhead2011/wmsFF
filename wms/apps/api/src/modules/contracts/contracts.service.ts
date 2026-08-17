import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { BILLING_SELLER } from '../billing/billing-printing';
import {
  OwnCompaniesService,
  ownCompanyToSeller,
} from '../own-companies/own-companies.service';
import { renderContractPdf, type ContractPartySnapshot } from './contract-pdf';
import { CreateContractDto } from './dto/create-contract.dto';
import { RefreshContractDto } from './dto/refresh-contract.dto';

const MAIN_EXECUTOR_INN = '616602423102';
const DEFAULT_WMS_URL = 'https://wms.logoff.pro';
const MAX_SIGNED_PDF_BYTES = 20 * 1024 * 1024;
const CONTRACT_REQUISITE_FIELDS = [
  { key: 'kind', label: 'Организационно-правовая форма' },
  { key: 'name', label: 'Краткое наименование' },
  { key: 'fullName', label: 'Полное наименование' },
  { key: 'inn', label: 'ИНН' },
  { key: 'kpp', label: 'КПП' },
  { key: 'ogrn', label: 'ОГРН / ОГРНИП' },
  { key: 'legalAddress', label: 'Юридический адрес' },
  { key: 'actualAddress', label: 'Фактический адрес' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'E-mail' },
  { key: 'bankName', label: 'Банк' },
  { key: 'bankBik', label: 'БИК' },
  { key: 'bankAccount', label: 'Расчётный счёт' },
  { key: 'correspondentAccount', label: 'Корреспондентский счёт' },
] as const;

type ContractRequisiteChange = {
  party: 'CLIENT' | 'EXECUTOR';
  field: (typeof CONTRACT_REQUISITE_FIELDS)[number]['key'];
  label: string;
  oldValue: string | null;
  newValue: string | null;
};

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly ownCompanies?: OwnCompaniesService,
  ) {}

  async list(user: AuthUser) {
    const clientId = this.clientScopes.resolveClientFilter(user);
    const rows = await (this.prisma as any).clientContract.findMany({
      where: {
        ...(clientId === undefined ? {} : { clientId }),
        ...(user.activeWarehouseId && !user.roleCodes.includes('CLIENT')
          ? { warehouseId: user.activeWarehouseId }
          : {}),
      },
      orderBy: [{ contractDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        number: true,
        clientId: true,
        warehouseId: true,
        contractDate: true,
        fileName: true,
        fileSize: true,
        wmsUrl: true,
        wmsLogin: true,
        signedFileName: true,
        signedFileSize: true,
        signedUploadedAt: true,
        archivedAt: true,
        createdAt: true,
        attachments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fileName: true,
            fileSize: true,
            createdAt: true,
            uploadedBy: { select: { id: true, name: true, email: true } },
          },
        },
        client: { select: { id: true, code: true, name: true, legalName: true } },
        warehouse: { select: { id: true, code: true, city: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        signedUploadedBy: { select: { id: true, name: true, email: true } },
      },
    });

    return rows.map((row: any) => ({
      ...row,
      status: row.signedUploadedAt ? 'SIGNED' : 'AWAITING_SIGNATURE',
    }));
  }

  async listAvailableClients(user: AuthUser) {
    const clientId = this.clientScopes.resolveClientFilter(user);
    const clients = await this.prisma.client.findMany({
      where: {
        ...(clientId === undefined ? {} : { id: clientId }),
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
        status: { not: 'ARCHIVED' },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        legalName: true,
        inn: true,
        userScopes: {
          where: { canRead: true, user: { status: 'ACTIVE' } },
          orderBy: { createdAt: 'asc' },
          select: {
            user: {
              select: {
                email: true,
                roles: { select: { role: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });

    return clients.map((client) => {
      const clientUser = client.userScopes.find((scope) =>
        scope.user.roles.some((membership) => membership.role.code === 'CLIENT'),
      );
      return {
        id: client.id,
        code: client.code,
        name: client.name,
        legalName: client.legalName,
        inn: client.inn,
        suggestedLogin: clientUser?.user.email ?? client.userScopes[0]?.user.email ?? '',
      };
    });
  }

  async setArchived(id: string, archived: boolean, user: AuthUser) {
    const contract = await this.requireWritableContract(id, user);
    await (this.prisma as any).clientContract.update({
      where: { id: contract.id },
      data: { archivedAt: archived ? new Date() : null },
    });
    return this.getSummary(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const contract = await this.requireWritableContract(id, user);
    await (this.prisma as any).clientContract.delete({ where: { id: contract.id } });
    return { id, deleted: true };
  }

  async create(dto: CreateContractDto, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    const warehouseId = user.activeWarehouseId;
    if (!warehouseId) {
      throw new BadRequestException('Перед созданием договора выберите филиал.');
    }
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) {
      throw new NotFoundException('Клиент для договора не найден.');
    }

    const contractDate = normalizeContractDate(dto.contractDate);
    const number = normalizeContractNumber(dto.contractNumber) ?? (await this.nextContractNumber(contractDate));
    const wmsUrl = dto.wmsUrl?.trim() || DEFAULT_WMS_URL;
    const wmsLogin = dto.wmsLogin.trim();
    const clientSnapshot = clientToSnapshot(client);
    const clientInWarehouse = await this.prisma.warehouseClient.findFirst({
      where: { warehouseId, clientId: client.id, status: 'ACTIVE' },
      select: { clientId: true },
    });
    if (!clientInWarehouse) {
      throw new BadRequestException('Клиент не активен в выбранном филиале.');
    }
    const executorSnapshot = await this.mainExecutorSnapshot(client.id, warehouseId);
    const buffer = await renderContractPdf({
      number,
      contractDate,
      client: clientSnapshot,
      executor: executorSnapshot,
      wmsUrl,
      wmsLogin,
      wmsPassword: dto.wmsPassword,
    });
    const fileName = `Договор ${safeFilePart(number)} — ${safeFilePart(client.name)}.pdf`;

    const contract = await (this.prisma as any).clientContract.create({
      data: {
        number,
        clientId: client.id,
        warehouseId,
        contractDate,
        fileName,
        fileSize: buffer.length,
        pdfData: buffer,
        wmsUrl,
        wmsLogin,
        clientSnapshot,
        executorSnapshot: stripPartyAssets(executorSnapshot),
        createdByUserId: user.id,
      },
      select: { id: true },
    });

    return this.getSummary(contract.id, user);
  }

  async checkRequisites(id: string, user: AuthUser) {
    const comparison = await this.loadRequisiteComparison(id, user);
    return {
      contractId: comparison.contract.id,
      contractNumber: comparison.contract.number,
      checkedAt: new Date().toISOString(),
      upToDate: comparison.changes.length === 0,
      signedFilePresent: Boolean(comparison.contract.signedUploadedAt),
      signedFileWillBePreserved: true,
      fingerprint: requisiteFingerprint(comparison.changes),
      changes: comparison.changes,
    };
  }

  async refreshRequisites(id: string, dto: RefreshContractDto, user: AuthUser) {
    const comparison = await this.loadRequisiteComparison(id, user);
    if (comparison.changes.length === 0) {
      return {
        contract: await this.getSummary(id, user),
        appliedChanges: [],
        signedFilePreserved: Boolean(comparison.contract.signedUploadedAt),
      };
    }
    const fingerprint = requisiteFingerprint(comparison.changes);
    if (fingerprint !== dto.expectedFingerprint) {
      throw new BadRequestException(
        'Реквизиты изменились после проверки. Выполните проверку ещё раз и подтвердите новый список замен.',
      );
    }

    const buffer = await renderContractPdf({
      number: comparison.contract.number,
      contractDate: comparison.contract.contractDate,
      client: comparison.currentClientSnapshot,
      executor: comparison.currentExecutorSnapshot,
      wmsUrl: comparison.contract.wmsUrl,
      wmsLogin: comparison.contract.wmsLogin,
      wmsPassword: dto.wmsPassword,
    });
    const fileName = `Договор ${safeFilePart(comparison.contract.number)} — ${safeFilePart(
      comparison.currentClientSnapshot.name,
    )}.pdf`;

    await this.prisma.$transaction([
      (this.prisma as any).clientContract.update({
        where: { id },
        data: {
          fileName,
          fileSize: buffer.length,
          pdfData: buffer,
          clientSnapshot: comparison.currentClientSnapshot,
          executorSnapshot: stripPartyAssets(comparison.currentExecutorSnapshot),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'CLIENT_CONTRACT_REQUISITES_REFRESHED',
          entity: 'ClientContract',
          entityId: id,
          payload: {
            contractNumber: comparison.contract.number,
            changes: comparison.changes,
            signedFilePreserved: Boolean(comparison.contract.signedUploadedAt),
          },
        },
      }),
    ]);

    return {
      contract: await this.getSummary(id, user),
      appliedChanges: comparison.changes,
      signedFilePreserved: Boolean(comparison.contract.signedUploadedAt),
    };
  }

  async download(id: string, user: AuthUser, kind: 'original' | 'signed') {
    const contract = await (this.prisma as any).clientContract.findUnique({
      where: { id },
      select: {
        clientId: true,
        warehouseId: true,
        fileName: true,
        pdfData: true,
        signedFileName: true,
        signedPdfData: true,
      },
    });
    if (!contract) {
      throw new NotFoundException('Договор не найден.');
    }
    this.clientScopes.requireClientAccess(user, contract.clientId, 'read');
    this.requireContractWarehouse(user, contract.warehouseId);

    if (kind === 'signed') {
      if (!contract.signedPdfData) {
        throw new NotFoundException('Подписанный экземпляр еще не загружен.');
      }
      return {
        fileName: contract.signedFileName || `Подписанный ${contract.fileName}`,
        buffer: Buffer.from(contract.signedPdfData),
      };
    }
    return { fileName: contract.fileName, buffer: Buffer.from(contract.pdfData) };
  }

  async uploadSigned(id: string, file: Express.Multer.File | undefined, user: AuthUser) {
    const contract = await (this.prisma as any).clientContract.findUnique({
      where: { id },
      select: { id: true, clientId: true, warehouseId: true, number: true },
    });
    if (!contract) {
      throw new NotFoundException('Договор не найден.');
    }
    this.clientScopes.requireClientAccess(user, contract.clientId, 'read');
    this.requireContractWarehouse(user, contract.warehouseId);
    validatePdf(file, 'подписанный договор');

    const safeName = file!.originalname.toLocaleLowerCase('ru-RU').endsWith('.pdf')
      ? file!.originalname
      : `Подписанный договор ${safeFilePart(contract.number)}.pdf`;
    await (this.prisma as any).clientContract.update({
      where: { id },
      data: {
        signedFileName: safeName.slice(0, 240),
        signedFileSize: file!.buffer.length,
        signedPdfData: file!.buffer,
        signedUploadedAt: new Date(),
        signedUploadedByUserId: user.id,
      },
    });
    return this.getSummary(id, user);
  }

  async uploadAdditionalAgreement(id: string, file: Express.Multer.File | undefined, user: AuthUser) {
    const contract = await (this.prisma as any).clientContract.findUnique({
      where: { id },
      select: { id: true, clientId: true, warehouseId: true },
    });
    if (!contract) {
      throw new NotFoundException('Договор не найден.');
    }
    this.clientScopes.requireClientAccess(user, contract.clientId, 'read');
    this.requireContractWarehouse(user, contract.warehouseId);
    validatePdf(file, 'дополнительное соглашение');

    await (this.prisma as any).clientContractAttachment.create({
      data: {
        contractId: id,
        fileName: file!.originalname.slice(0, 240),
        fileSize: file!.buffer.length,
        pdfData: file!.buffer,
        uploadedByUserId: user.id,
      },
    });
    return this.getSummary(id, user);
  }

  async downloadAdditionalAgreement(id: string, attachmentId: string, user: AuthUser) {
    const attachment = await (this.prisma as any).clientContractAttachment.findFirst({
      where: { id: attachmentId, contractId: id },
      select: {
        fileName: true,
        pdfData: true,
        contract: { select: { clientId: true, warehouseId: true } },
      },
    });
    if (!attachment) {
      throw new NotFoundException('Дополнительное соглашение не найдено.');
    }
    this.clientScopes.requireClientAccess(user, attachment.contract.clientId, 'read');
    this.requireContractWarehouse(user, attachment.contract.warehouseId);
    return { fileName: attachment.fileName, buffer: Buffer.from(attachment.pdfData) };
  }

  private async getSummary(id: string, user: AuthUser) {
    const rows = await this.list(user);
    const contract = rows.find((row: any) => row.id === id);
    if (!contract) {
      throw new NotFoundException('Договор не найден.');
    }
    return contract;
  }

  private async requireWritableContract(id: string, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    const contract = await (this.prisma as any).clientContract.findUnique({
      where: { id },
      select: { id: true, clientId: true, warehouseId: true },
    });
    if (!contract) throw new NotFoundException('Договор не найден.');
    this.clientScopes.requireClientAccess(user, contract.clientId, 'write');
    this.requireContractWarehouse(user, contract.warehouseId);
    return contract;
  }

  private async loadRequisiteComparison(id: string, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    const contract = await (this.prisma as any).clientContract.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        clientId: true,
        warehouseId: true,
        contractDate: true,
        wmsUrl: true,
        wmsLogin: true,
        clientSnapshot: true,
        executorSnapshot: true,
        signedUploadedAt: true,
      },
    });
    if (!contract) {
      throw new NotFoundException('Договор не найден.');
    }
    const client = await this.prisma.client.findUnique({ where: { id: contract.clientId } });
    if (!client) {
      throw new NotFoundException('Клиент договора не найден.');
    }

    const savedClientSnapshot = normalizePartySnapshot(contract.clientSnapshot);
    const savedExecutorSnapshot = normalizePartySnapshot(contract.executorSnapshot);
    const currentClientSnapshot = clientToSnapshot(client);
    const currentExecutorSnapshot = await this.mainExecutorSnapshot(
      client.id,
      contract.warehouseId,
    );
    const changes = [
      ...comparePartySnapshots('CLIENT', savedClientSnapshot, currentClientSnapshot),
      ...comparePartySnapshots('EXECUTOR', savedExecutorSnapshot, currentExecutorSnapshot),
    ];
    return {
      contract,
      currentClientSnapshot,
      currentExecutorSnapshot,
      changes,
    };
  }

  private requireContractWarehouse(user: AuthUser, warehouseId?: string | null) {
    if (user.roleCodes.includes('CLIENT')) return;
    if (!user.activeWarehouseId || user.activeWarehouseId !== warehouseId) {
      throw new NotFoundException('Договор не найден в выбранном филиале.');
    }
  }

  private async nextContractNumber(contractDate: Date) {
    const day = contractDate.toISOString().slice(0, 10).replaceAll('-', '');
    const prefix = `ДОГ-${day}-`;
    const latest = await (this.prisma as any).clientContract.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const current = latest ? Number(String(latest.number).slice(prefix.length)) || 0 : 0;
    return `${prefix}${String(current + 1).padStart(4, '0')}`;
  }

  private async mainExecutorSnapshot(
    clientId: string,
    warehouseId?: string | null,
  ): Promise<ContractPartySnapshot> {
    const branchCompany = warehouseId
      ? await (this.prisma as any).warehouse.findUnique({
          where: { id: warehouseId },
          select: {
            ownCompany: {
              include: {
                bankAccounts: {
                  orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
                },
              },
            },
          },
        })
      : null;
    const companyFromBranch = branchCompany?.ownCompany;
    const company = this.ownCompanies
      ? companyFromBranch
        ? ownCompanyToSeller(companyFromBranch)
        : await this.ownCompanies.findSellerForClient(clientId)
      : await this.legacyMainExecutorSeller();
    return {
      kind: 'INDIVIDUAL_ENTREPRENEUR',
      name: company.shortName || BILLING_SELLER.shortName,
      fullName: company.fullName || BILLING_SELLER.fullName,
      inn: company.inn || MAIN_EXECUTOR_INN,
      kpp: company.kpp || null,
      ogrn: company.ogrn || (company.inn === BILLING_SELLER.inn ? BILLING_SELLER.ogrn : null),
      legalAddress: company.address || null,
      phone: company.inn === BILLING_SELLER.inn ? '+7 (926) 725-02-05' : null,
      email: company.inn === BILLING_SELLER.inn ? 'ei.govorova@yandex.ru' : null,
      bankName: company.bankName || BILLING_SELLER.bankName,
      bankBik: company.bankBik || BILLING_SELLER.bankBik,
      bankAccount: company.bankAccount || BILLING_SELLER.bankAccount,
      correspondentAccount: company.correspondentAccount || BILLING_SELLER.correspondentAccount,
      stampDataUrl: company.stampDataUrl,
      signatureDataUrl: company.signatureDataUrl,
    };
  }

  private async legacyMainExecutorSeller() {
    const company = await (this.prisma as any).ownCompany.findFirst({
      where: { inn: MAIN_EXECUTOR_INN, isActive: true },
      include: { bankAccounts: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    if (!company) return BILLING_SELLER;
    const account = company.bankAccounts?.find((item: any) => item.isDefault) ?? company.bankAccounts?.[0];
    return {
      ...BILLING_SELLER,
      shortName: company.shortName,
      fullName: company.fullName,
      inn: company.inn,
      kpp: company.kpp ?? '',
      address: company.legalAddress ?? '',
      bankName: account?.bankName ?? company.bankName ?? '',
      bankBik: account?.bankBik ?? company.bankBik ?? '',
      bankAccount: account?.bankAccount ?? company.bankAccount ?? '',
      correspondentAccount: account?.correspondentAccount ?? company.correspondentAccount ?? '',
    };
  }
}

function stripPartyAssets(snapshot: ContractPartySnapshot): ContractPartySnapshot {
  const { stampDataUrl: _stampDataUrl, signatureDataUrl: _signatureDataUrl, ...safe } = snapshot;
  return safe;
}

function clientToSnapshot(client: any): ContractPartySnapshot {
  return {
    kind: client.clientKind,
    name: client.name,
    fullName: client.legalName || client.name,
    inn: client.inn,
    kpp: client.kpp,
    ogrn: client.ogrn,
    legalAddress: client.legalAddress,
    actualAddress: client.actualAddress,
    phone: client.phone,
    email: client.email,
    bankName: client.bankName,
    bankBik: client.bankBik,
    bankAccount: client.bankAccount,
    correspondentAccount: client.correspondentAccount,
  };
}

function normalizePartySnapshot(value: unknown): ContractPartySnapshot {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    kind: optionalSnapshotValue(source.kind),
    name: optionalSnapshotValue(source.name) ?? '',
    fullName: optionalSnapshotValue(source.fullName) ?? optionalSnapshotValue(source.name) ?? '',
    inn: optionalSnapshotValue(source.inn),
    kpp: optionalSnapshotValue(source.kpp),
    ogrn: optionalSnapshotValue(source.ogrn),
    legalAddress: optionalSnapshotValue(source.legalAddress),
    actualAddress: optionalSnapshotValue(source.actualAddress),
    phone: optionalSnapshotValue(source.phone),
    email: optionalSnapshotValue(source.email),
    bankName: optionalSnapshotValue(source.bankName),
    bankBik: optionalSnapshotValue(source.bankBik),
    bankAccount: optionalSnapshotValue(source.bankAccount),
    correspondentAccount: optionalSnapshotValue(source.correspondentAccount),
  };
}

function comparePartySnapshots(
  party: ContractRequisiteChange['party'],
  saved: ContractPartySnapshot,
  current: ContractPartySnapshot,
) {
  return CONTRACT_REQUISITE_FIELDS.flatMap((definition): ContractRequisiteChange[] => {
    const oldValue = optionalSnapshotValue(saved[definition.key]);
    const newValue = optionalSnapshotValue(current[definition.key]);
    if (oldValue === newValue) {
      return [];
    }
    return [{
      party,
      field: definition.key,
      label: definition.label,
      oldValue,
      newValue,
    }];
  });
}

function optionalSnapshotValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function requisiteFingerprint(changes: ContractRequisiteChange[]) {
  return createHash('sha256').update(JSON.stringify(changes)).digest('hex');
}

function normalizeContractDate(value?: string) {
  const source = value ? new Date(value) : new Date();
  if (Number.isNaN(source.getTime())) {
    throw new BadRequestException('Некорректная дата договора.');
  }
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function normalizeContractNumber(value?: string) {
  const normalized = value?.trim();
  return normalized || null;
}

function safeFilePart(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90);
}

function validatePdf(file: Express.Multer.File | undefined, label: string): asserts file is Express.Multer.File {
  if (!file?.buffer?.length) {
    throw new BadRequestException(`Выберите ${label} в формате PDF.`);
  }
  if (file.buffer.length > MAX_SIGNED_PDF_BYTES) {
    throw new BadRequestException('PDF-файл превышает допустимый размер 20 МБ.');
  }
  const hasPdfSignature = file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (file.mimetype !== 'application/pdf' || !hasPdfSignature) {
    throw new BadRequestException('Можно загрузить только корректный PDF-файл.');
  }
}
