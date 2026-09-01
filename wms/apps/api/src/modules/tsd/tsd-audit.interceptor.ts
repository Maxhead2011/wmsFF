import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma, TsdOperationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

type TsdHttpRequest = {
  method?: string;
  originalUrl?: string;
  route?: { path?: string };
  params?: unknown;
  query?: unknown;
  body?: unknown;
  user?: AuthUser;
};

@Injectable()
export class TsdAuditInterceptor implements NestInterceptor {
  // FIX: capture the entire authenticated mutation envelope after the business handler completes.
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TsdHttpRequest>();
    const startedAt = Date.now();
    if (!shouldAudit(request)) return next.handle();

    return next.handle().pipe(
      mergeMap((response) =>
        from(this.safeRecord(request, response, null, startedAt)).pipe(mergeMap(() => [response])),
      ),
      catchError((caught) =>
        from(this.safeRecord(request, null, caught, startedAt)).pipe(
          mergeMap(() => throwError(() => caught)),
        ),
      ),
    );
  }

  private async safeRecord(request: TsdHttpRequest, response: unknown, caught: unknown, startedAt: number) {
    try {
      await this.record(request, response, caught, startedAt);
    } catch {
      // Audit storage must never turn an already completed warehouse action into a 500 response.
    }
  }

  private async record(request: TsdHttpRequest, response: unknown, caught: unknown, startedAt: number) {
    const actor = request.user!;
    const deviceId = text(actor.deviceCode) || text(valueAt(request.body, 'deviceCode')) || `USER:${actor.id}`;
    const message = errorMessage(caught);
    const payload = {
      auditVersion: 1,
      actor: { userId: actor.id, name: actor.name, email: actor.email },
      deviceCode: deviceId,
      request: {
        method: text(request.method).toUpperCase(),
        path: text(request.originalUrl),
        route: text(request.route?.path),
        params: sanitize(request.params),
        query: sanitize(request.query),
        body: sanitize(request.body),
      },
      response: sanitize(response),
      result: {
        ok: !caught,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: message,
        httpStatus: errorStatus(caught),
      },
      recordedAt: new Date().toISOString(),
    };

    await this.prisma.tsdOperation.create({
      data: {
        deviceId,
        operationKey: `tsd-audit:${deviceId}:${Date.now()}:${randomUUID()}`,
        operationType: 'tsd_api_action',
        payload: payload as Prisma.InputJsonValue,
        status: caught ? TsdOperationStatus.REJECTED : TsdOperationStatus.ACCEPTED,
        serverMessage: message || null,
      },
    });
  }
}

function shouldAudit(request: TsdHttpRequest) {
  if (!request.user) return false;
  const method = text(request.method).toUpperCase();
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return false;
  const path = text(request.originalUrl).toLowerCase();
  return ![
    '/tsd/login',
    '/tsd/monitor/heartbeat',
    '/tsd/monitor/error',
    '/screenshot',
  ].some((fragment) => path.includes(fragment));
}

function sanitize(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (value == null) return null;
  if (depth > 7) return '[DEPTH_LIMIT]';
  if (typeof value === 'string') return compactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[BINARY:${value.length}]`;
  if (Array.isArray(value)) {
    const items = value.slice(0, 250).map((item) => sanitize(item, depth + 1));
    if (value.length > 250) items.push(`[${value.length - 250} MORE]`);
    return items as Prisma.InputJsonArray;
  }
  if (typeof value !== 'object') return String(value);

  const result: Record<string, Prisma.InputJsonValue | null> = {};
  Object.entries(value as Record<string, unknown>).slice(0, 300).forEach(([key, nested]) => {
    if (isSecretKey(key)) {
      result[key] = '[REDACTED]';
      return;
    }
    if (isLargeBinaryKey(key) && typeof nested === 'string') {
      result[key] = `[OMITTED:${nested.length} chars]`;
      return;
    }
    result[key] = sanitize(nested, depth + 1);
  });
  return result as Prisma.InputJsonObject;
}

function isSecretKey(key: string) {
  return /password|secret|authorization|access[_-]?token|refresh[_-]?token/i.test(key);
}

function isLargeBinaryKey(key: string) {
  return /base64|pdfdata|imagedata|labeldata|screenshotdata/i.test(key);
}

function compactText(value: string) {
  return value.length <= 20_000 ? value : `${value.slice(0, 20_000)}…[TRUNCATED:${value.length}]`;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function valueAt(value: unknown, key: string) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function errorMessage(caught: unknown) {
  if (!caught) return '';
  if (caught instanceof Error) return compactText(caught.message);
  return compactText(String(caught));
}

function errorStatus(caught: unknown) {
  if (!caught || typeof caught !== 'object') return null;
  const value = (caught as { status?: unknown; statusCode?: unknown }).status ??
    (caught as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' ? value : null;
}
