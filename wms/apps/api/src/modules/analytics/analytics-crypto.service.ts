import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

@Injectable()
export class AnalyticsCryptoService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  decrypt(value: string) {
    const [version, ivValue, tagValue, encryptedValue] = value.split(':');
    if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
      throw new InternalServerErrorException('Ключ аналитики сохранён в неизвестном формате.');
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivValue, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new InternalServerErrorException('Не удалось расшифровать ключ аналитики.');
    }
  }

  private key() {
    const configured = this.config.get<string>('ANALYTICS_CREDENTIALS_SECRET');
    if (!configured && this.config.get<string>('NODE_ENV') === 'production') {
      throw new InternalServerErrorException('ANALYTICS_CREDENTIALS_SECRET не настроен.');
    }
    return createHash('sha256').update(configured || 'logoff-analytics-development-secret').digest();
  }
}
