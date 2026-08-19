import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import {
  WMS_API_KEY_PREFIX,
  WMS_INTEGRATION_SCOPES,
  type WmsIntegrationScope,
} from './integration-api.constants';

const PREFIX_BYTES = 6;
const SECRET_BYTES = 32;

export type GeneratedWmsApiKey = {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
};

export function generateWmsApiKey(): GeneratedWmsApiKey {
  const keyPrefix = randomBytes(PREFIX_BYTES).toString('hex');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const rawKey = `${WMS_API_KEY_PREFIX}${keyPrefix}_${secret}`;
  return { rawKey, keyPrefix, keyHash: hashWmsApiKey(rawKey) };
}

export function hashWmsApiKey(rawKey: string) {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export function parseWmsApiKey(rawKey: string) {
  const match = /^wms_live_([a-f0-9]{12})_([A-Za-z0-9_-]{40,})$/.exec(rawKey.trim());
  if (!match) return null;
  return { keyPrefix: match[1], rawKey: rawKey.trim() };
}

export function safeApiKeyHashEquals(storedHash: string, rawKey: string) {
  const actual = Buffer.from(hashWmsApiKey(rawKey), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeIntegrationScopes(values: string[]): WmsIntegrationScope[] {
  const allowed = new Set<string>(WMS_INTEGRATION_SCOPES);
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  const unsupported = normalized.filter((value) => !allowed.has(value));
  if (unsupported.length) {
    throw new BadRequestException(`Неизвестные права API: ${unsupported.join(', ')}.`);
  }
  if (!normalized.length) {
    throw new BadRequestException('Выберите хотя бы одно право API.');
  }
  return normalized as WmsIntegrationScope[];
}

export function normalizeAllowedIps(values?: string[]) {
  if (!values?.length) return [];
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  for (const value of normalized) {
    if (isIP(value) === 0) {
      throw new BadRequestException(`Некорректный IP-адрес: ${value}.`);
    }
  }
  return normalized;
}

export function integrationIdempotencyKey(keyPrefix: string, value?: string) {
  const normalized = value?.trim();
  return normalized
    ? `CLIENT_API:${keyPrefix}:${normalized}`
    : `CLIENT_API:${keyPrefix}:${randomUUID()}`;
}
