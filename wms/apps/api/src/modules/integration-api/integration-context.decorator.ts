import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { WmsIntegrationContext, WmsIntegrationRequest } from './integration-api.types';

export const IntegrationContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WmsIntegrationContext | undefined =>
    context.switchToHttp().getRequest<WmsIntegrationRequest>().integration,
);
