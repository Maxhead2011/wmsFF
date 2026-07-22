import { describe, expect, it } from 'vitest';
import { AnalyticsCryptoService } from '../src/modules/analytics/analytics-crypto.service';

describe('AnalyticsCryptoService', () => {
  const config = {
    get: (key: string) => (key === 'ANALYTICS_CREDENTIALS_SECRET' ? 'test-secret-for-analytics' : 'test'),
  };

  it('шифрует ключ WB и расшифровывает его без потерь', () => {
    const service = new AnalyticsCryptoService(config as never);
    const encrypted = service.encrypt('wb-secret-token');

    expect(encrypted).not.toContain('wb-secret-token');
    expect(service.decrypt(encrypted)).toBe('wb-secret-token');
  });

  it('использует новый IV для каждого сохранения', () => {
    const service = new AnalyticsCryptoService(config as never);
    expect(service.encrypt('same-token')).not.toBe(service.encrypt('same-token'));
  });
});
