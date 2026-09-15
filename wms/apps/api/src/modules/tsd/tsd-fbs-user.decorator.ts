import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { withFbsTsdCapability } from '../marketplace-connections/fbs-physical-pick';

// FIX: old terminals keep their label screen until their app advertises the new workflow.
export const CurrentFbsTsdUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest();
  return withFbsTsdCapability(request.user, request.headers['x-tsd-fbs-capability']);
});
