import { KizCirculationOperation, MarketplaceType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildKizCirculationDocument,
  isFinalMarketplaceSale,
  normalizeCisForTrueApi,
  officialTrueApiBase,
} from '../src/modules/kiz-circulation/kiz-circulation.policy';
import { KizCirculationService } from '../src/modules/kiz-circulation/kiz-circulation.service';
import { createHash } from 'crypto';

describe('KizCirculation policy', () => {
  // ADDED: полный Data Matrix сохраняется в WMS, но в True API уходит КИ без AI 91/92.
  it('безопасно отделяет криптохвост по GS', () => {
    const full = '0104680992593139215a%9RNyiE_KVd\u001d91EE12\u001d92Ushtey8yV3970RwmmOKM1nYaFpDOLoyF0s05PpEipMY=';
    expect(normalizeCisForTrueApi(full)).toBe('0104680992593139215a%9RNyiE_KVd');
  });

  it('не угадывает границу криптохвоста при потерянном GS', () => {
    expect(() => normalizeCisForTrueApi('01'.padEnd(85, 'A'))).toThrow(
      'Нужен исходный Data Matrix с разделителем GS',
    );
  });

  it('не считает простую отгрузку продажей покупателю', () => {
    expect(isFinalMarketplaceSale(MarketplaceType.WILDBERRIES, 'complete', 'sorted')).toBe(false);
    expect(isFinalMarketplaceSale(MarketplaceType.WILDBERRIES, 'complete', 'sold')).toBe(true);
    expect(isFinalMarketplaceSale(MarketplaceType.OZON, 'delivering', 'delivering')).toBe(false);
    expect(isFinalMarketplaceSale(MarketplaceType.OZON, 'delivered', 'delivered')).toBe(true);
    expect(isFinalMarketplaceSale(MarketplaceType.YANDEX_MARKET, 'delivered', 'delivered')).toBe(true);
  });

  it('строит дистанционное погашение с ценой в копейках', () => {
    expect(buildKizCirculationDocument({
      operation: KizCirculationOperation.RETIRE,
      inn: '1234567890',
      kpp: '123456789',
      actionDate: '2026-08-18',
      documentType: 'OTHER',
      documentNumber: 'WB-18-08',
      documentDate: '2026-08-18',
      primaryDocumentCustomName: 'Отчёт маркетплейса',
      items: [{ cis: '0104680992593139215a%9RNyiE_KVd', productCostKopecks: 129900 }],
    })).toMatchObject({
      action: 'DISTANCE',
      kpp: '123456789',
      products: [{ cis: '0104680992593139215a%9RNyiE_KVd', product_cost: 129900 }],
    });
  });

  it('строит возврат после дистанционной продажи без выдуманной оплаты', () => {
    expect(buildKizCirculationDocument({
      operation: KizCirculationOperation.RETURN,
      inn: '1234567890',
      actionDate: '2026-08-18',
      documentType: 'OTHER',
      documentNumber: 'RETURN-1',
      documentDate: '2026-08-18',
      paid: false,
      items: [{ cis: '0104680992593139215a%9RNyiE_KVd' }],
    })).toEqual({
      trade_participant_inn: '1234567890',
      return_type: 'REMOTE_SALE_RETURN',
      paid: false,
      products_list: [{ ki: '0104680992593139215a%9RNyiE_KVd' }],
    });
  });

  it('не разрешает подменить адрес True API', () => {
    expect(() => officialTrueApiBase('https://evil.example/api/v3/true-api')).toThrow('официальные адреса');
  });

  // ADDED: юридически значимая отправка невозможна без точной фразы подтверждения.
  it('не отправляет пакет без явного подтверждения', async () => {
    const service = new KizCirculationService({} as never, {} as never, {} as never, {} as never);

    await expect(service.submit('batch-id', 'да', {} as never)).rejects.toThrow('ОТПРАВИТЬ');
  });

  // ADDED: хэш документа считается по точным байтам, которые затем подписываются.
  it('различает компактный и переформатированный JSON для УКЭП', () => {
    const payload = { action: 'DISTANCE', products: [{ cis: '010468099259313921ABC' }] };
    const exact = JSON.stringify(payload);

    expect(createHash('sha256').update(exact).digest('hex')).not.toBe(
      createHash('sha256').update(JSON.stringify(payload, null, 2)).digest('hex'),
    );
  });
});
