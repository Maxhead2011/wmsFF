import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';

// FIX: forward terminal UI capability without changing authenticated identity or permissions.
export const CurrentFbsTsdUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<{
    user?: AuthUser;
    headers: Record<string, string | string[] | undefined>;
  }>();
  if (!request.user) return undefined;
  return {
    ...request.user,
    tsdPhysicalPickConfirmation: request.headers['x-tsd-fbs-capability'] === 'physical-pick-v1',
  };
});
