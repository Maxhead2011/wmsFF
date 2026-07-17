import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { catchError, from, mergeMap, of, tap, throwError } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class MobileIdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{
      method: string;
      originalUrl?: string;
      url?: string;
      headers: Record<string, string | string[] | undefined>;
      user?: AuthUser;
    }>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || !request.user || !request.headers['x-mobile-app']) {
      return next.handle();
    }
    const key = header(request.headers['x-idempotency-key']);
    if (!key) return next.handle();

    const unique = { userId_idempotencyKey: { userId: request.user.id, idempotencyKey: key } };
    const existing = await this.prisma.mobileCommand.findUnique({ where: unique });
    if (existing?.status === 'COMPLETED') return of(existing.response ?? { success: true, repeated: true });
    if (existing) throw new ConflictException('Мобильная команда уже выполняется. Повторите проверку данных.');

    const command = await this.prisma.mobileCommand.create({
      data: {
        userId: request.user.id,
        idempotencyKey: key,
        action: `${request.method}:${request.originalUrl ?? request.url ?? ''}`,
        status: 'PROCESSING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return next.handle().pipe(
      mergeMap((response) =>
        from(
          this.prisma.mobileCommand.update({
            where: { id: command.id },
            data: { status: 'COMPLETED', response: serializable(response) },
          }),
        ).pipe(mergeMap(() => of(response))),
      ),
      catchError((error) =>
        from(this.prisma.mobileCommand.delete({ where: { id: command.id } }).catch(() => undefined)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }
}

function header(value: string | string[] | undefined) {
  const result = Array.isArray(value) ? value[0] : value;
  return result?.trim().slice(0, 200) || '';
}

function serializable(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? { success: true })) as Prisma.InputJsonValue;
}
