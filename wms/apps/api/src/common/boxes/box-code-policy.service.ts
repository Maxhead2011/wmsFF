import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SystemSettingsService } from '../settings/system-settings.service';

export const BOX_CODE_POLICY_SETTING = 'warehouse.boxCodePolicy';

export type BoxCodePolicy = {
  primaryPrefix: string;
  allowedPrefixes: string[];
  receiptPrefix: string;
  balancePrefix: string;
  whiteReceiptPrefixes: string[];
  grayReceiptPrefixes: string[];
  palletPrefix: string;
  storageCellPrefix: string;
  rackSlotPrefix: string;
  rackPrefix: string;
  storageBoxPrefix: string;
  // FIX: additional storage prefixes are configured per installation, not enabled globally.
  storageBoxAliases: string[];
  autoCorrections: Record<string, string>;
};

export const DEFAULT_BOX_CODE_POLICY: BoxCodePolicy = {
  primaryPrefix: 'FFL_',
  allowedPrefixes: ['FFL_'],
  receiptPrefix: 'FFL_LKB',
  balancePrefix: 'FFL_BAL',
  whiteReceiptPrefixes: ['FFL_LKB'],
  grayReceiptPrefixes: ['FFL_G_'],
  palletPrefix: 'PAL_',
  storageCellPrefix: 'CELL_',
  rackSlotPrefix: 'SLOT_',
  rackPrefix: 'RACK_',
  storageBoxPrefix: 'SBOX_',
  storageBoxAliases: [],
  autoCorrections: {
    FL_: 'FFL_',
  },
};

@Injectable()
export class BoxCodePolicyService {
  private cached: { expiresAt: number; value: BoxCodePolicy } | null = null;

  constructor(private readonly settings: SystemSettingsService) {}

  async getPolicy(force = false) {
    if (!force && this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }
    const stored = await this.settings.get<unknown>(BOX_CODE_POLICY_SETTING, DEFAULT_BOX_CODE_POLICY);
    const value = normalizeBoxCodePolicy(stored);
    this.cached = { expiresAt: Date.now() + 15_000, value };
    return value;
  }

  async normalize(value: string) {
    const policy = await this.getPolicy();
    let normalized = value.trim().toLocaleUpperCase('ru-RU');
    for (const [from, to] of Object.entries(policy.autoCorrections)) {
      if (normalized.startsWith(from)) {
        normalized = `${to}${normalized.slice(from.length)}`;
        break;
      }
    }
    return normalized;
  }

  async requireAllowed(value: string) {
    const policy = await this.getPolicy();
    const normalized = await this.normalize(value);
    if (!normalized || !policy.allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
      throw new BadRequestException(
        `Номер короба должен начинаться с одного из разрешённых префиксов: ${policy.allowedPrefixes.join(', ')}.`,
      );
    }
    return normalized;
  }

  async updatePolicy(value: unknown, userId: string) {
    // FIX: older settings screens omit aliases; preserve them unless explicitly replaced.
    const input = asRecord(value);
    const policy = normalizeBoxCodePolicy({
      ...input,
      storageBoxAliases: input.storageBoxAliases === undefined
        ? (await this.getPolicy(true)).storageBoxAliases
        : input.storageBoxAliases,
    });
    await this.settings.set(
      BOX_CODE_POLICY_SETTING,
      policy as unknown as Prisma.InputJsonValue,
      userId,
    );
    this.cached = null;
    return policy;
  }

  // FIX: storage boxes have their own configured prefix; ordinary box rules stay unchanged.
  async requireStorageBox(value: string) {
    const { storageBoxPrefix, storageBoxAliases } = await this.getPolicy();
    // FIX: keep the primary generation prefix and accept only explicitly configured aliases.
    const prefixes = [storageBoxPrefix, ...storageBoxAliases];
    const normalized = await this.normalize(value);
    if (!prefixes.some(prefix => normalized.startsWith(prefix) && normalized.length > prefix.length)) {
      throw new BadRequestException(`Отсканируйте бокс хранения с префиксом ${prefixes.join(', ')} и номером.`);
    }
    return normalized;
  }
}

export function normalizeBoxCodePolicy(value: unknown): BoxCodePolicy {
  const input = asRecord(value);
  const primaryPrefix = normalizePrefix(input.primaryPrefix, DEFAULT_BOX_CODE_POLICY.primaryPrefix);
  const allowedPrefixes = uniquePrefixes(input.allowedPrefixes, primaryPrefix);
  const receiptPrefix = normalizePrefix(input.receiptPrefix, DEFAULT_BOX_CODE_POLICY.receiptPrefix);
  const balancePrefix = normalizePrefix(input.balancePrefix, DEFAULT_BOX_CODE_POLICY.balancePrefix);
  const whiteReceiptPrefixes = uniquePrefixes(
    input.whiteReceiptPrefixes,
    DEFAULT_BOX_CODE_POLICY.whiteReceiptPrefixes[0],
  );
  const grayReceiptPrefixes = uniquePrefixes(
    input.grayReceiptPrefixes,
    DEFAULT_BOX_CODE_POLICY.grayReceiptPrefixes[0],
  );
  const palletPrefix = normalizePrefix(input.palletPrefix, DEFAULT_BOX_CODE_POLICY.palletPrefix);
  const storageCellPrefix = normalizePrefix(
    input.storageCellPrefix,
    DEFAULT_BOX_CODE_POLICY.storageCellPrefix,
  );
  const rackSlotPrefix = normalizePrefix(
    input.rackSlotPrefix,
    DEFAULT_BOX_CODE_POLICY.rackSlotPrefix,
  );
  const rackPrefix = normalizePrefix(input.rackPrefix, DEFAULT_BOX_CODE_POLICY.rackPrefix);
  const storageBoxPrefix = normalizePrefix(
    input.storageBoxPrefix,
    DEFAULT_BOX_CODE_POLICY.storageBoxPrefix,
  );
  // FIX: no aliases by default, so other installations keep their previous behavior.
  const storageBoxAliases = Array.isArray(input.storageBoxAliases) && input.storageBoxAliases.length
    ? uniquePrefixes(input.storageBoxAliases, storageBoxPrefix)
    : [];
  const autoCorrections = normalizeCorrections(input.autoCorrections);

  if (!allowedPrefixes.some((prefix) => primaryPrefix.startsWith(prefix) || prefix.startsWith(primaryPrefix))) {
    allowedPrefixes.unshift(primaryPrefix);
  }

  return {
    primaryPrefix,
    allowedPrefixes,
    receiptPrefix,
    balancePrefix,
    whiteReceiptPrefixes,
    grayReceiptPrefixes,
    palletPrefix,
    storageCellPrefix,
    rackSlotPrefix,
    rackPrefix,
    storageBoxPrefix,
    storageBoxAliases,
    autoCorrections,
  };
}

function normalizePrefix(value: unknown, fallback: string) {
  const normalized = typeof value === 'string' ? value.trim().toLocaleUpperCase('ru-RU') : fallback;
  if (!/^[A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9_-]{0,31}$/.test(normalized)) {
    throw new BadRequestException(
      'Префикс может содержать буквы, цифры, дефис и подчёркивание; длина — от 1 до 32 символов.',
    );
  }
  return normalized;
}

function uniquePrefixes(value: unknown, fallback: string) {
  const items = Array.isArray(value) ? value : [fallback];
  const result = [
    ...new Set(
      items
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizePrefix(item, fallback)),
    ),
  ];
  if (result.length === 0) result.push(fallback);
  if (result.length > 20) {
    throw new BadRequestException('Можно указать не более 20 разрешённых префиксов.');
  }
  return result;
}

function normalizeCorrections(value: unknown) {
  const result: Record<string, string> = {};
  const source = asRecord(value);
  for (const [from, to] of Object.entries(source)) {
    if (Object.keys(result).length >= 20) break;
    if (typeof to !== 'string') continue;
    result[normalizePrefix(from, from)] = normalizePrefix(to, to);
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
