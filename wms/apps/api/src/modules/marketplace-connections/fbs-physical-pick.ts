import type { AuthUser } from '../auth/auth.types';

export type FbsTsdUser = AuthUser & { tsdPhysicalPickConfirmation?: boolean };

// FIX: request capability selects UI behavior, never identity or permissions.
export function withFbsTsdCapability(user: AuthUser, capability: unknown): FbsTsdUser {
  return { ...user, tsdPhysicalPickConfirmation: capability === 'physical-pick-v1' };
}

export function physicalPickConfirmationEnabled(task: { marketplace: string }, user?: FbsTsdUser) {
  return process.env.WMS_TSD_PHYSICAL_PICK_CONFIRMATION === 'true' &&
    user?.tsdPhysicalPickConfirmation === true && ['OZON', 'WILDBERRIES'].includes(task.marketplace);
}
