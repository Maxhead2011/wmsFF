import type { WmsApiCredential } from '@prisma/client';
import type { WmsIntegrationScope } from './integration-api.constants';

export type WmsIntegrationContext = {
  credential: WmsApiCredential;
  scopes: WmsIntegrationScope[];
  clientIp: string | null;
};

export type WmsIntegrationRequest = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  integration?: WmsIntegrationContext;
};
