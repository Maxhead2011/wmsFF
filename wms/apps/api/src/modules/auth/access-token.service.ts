import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { TokenPayload } from './auth.types';

const TOKEN_TTL_SECONDS = 60 * 60 * 8;

export type AccessTokenOptions = {
  deviceId?: string;
  deviceCode?: string;
};

@Injectable()
export class AccessTokenService {
  constructor(private readonly config: ConfigService) {}

  sign(userId: string, options: AccessTokenOptions = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {
      sub: userId,
      deviceId: options.deviceId,
      deviceCode: options.deviceCode,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    };

    const header = this.encodeJson({ alg: 'HS256', typ: 'JWT' });
    const body = this.encodeJson(payload);
    const signature = this.signParts(header, body);
    return `${header}.${body}.${signature}`;
  }

  verify(token: string): TokenPayload {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) {
      throw new UnauthorizedException('Некорректный access token.');
    }

    const expectedSignature = this.signParts(header, body);
    if (!this.safeEqual(signature, expectedSignature)) {
      throw new UnauthorizedException('Некорректная подпись access token.');
    }

    const payload = this.decodeJson<TokenPayload>(body);
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Access token истек или поврежден.');
    }

    return payload;
  }

  fingerprint(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private signParts(header: string, body: string) {
    return createHmac('sha256', this.secret()).update(`${header}.${body}`).digest('base64url');
  }

  private secret() {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET');
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    if (!secret || (isProduction && secret === 'change_me_access')) {
      throw new UnauthorizedException('JWT_ACCESS_SECRET не настроен.');
    }

    return secret;
  }

  private encodeJson(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private decodeJson<T>(value: string): T {
    try {
      return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
    } catch {
      throw new UnauthorizedException('Access token не читается.');
    }
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
