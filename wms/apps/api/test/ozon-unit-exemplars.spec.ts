import { expect, it } from 'vitest';
import { ozonUnitExemplarPayload, ozonUnitExemplarsPassed } from '../src/modules/marketplace-connections/ozon-fbs-unit-exemplars';

const marks = ['0104610460840526215OdGM-', '0104610460840540215K.W,b'];
function fixture() {
  const state: any = { unitMarksVersion: 1, submission: 'SUBMITTING', lines: marks.map((kiz, i) => ({
    productId: i + 1, offerId: String(i), quantity: 1, requiresKiz: true, picks: [{ kiz }],
  })) };
  const posting = { products: state.lines.map((l: any) => ({ sku: l.productId, offer_id: l.offerId, quantity: l.quantity })) };
  const response = { products: state.lines.map((l: any) => ({ product_id: l.productId, exemplars: [{ exemplar_id: l.productId * 10 }] })) };
  return { state, posting, response };
}
// TEST: neither a shared header SKU nor a generic passed response proves each physical unit.
it('maps each KIZ to its product and requires each exemplar to pass', () => {
  const f = fixture();
  const payload = ozonUnitExemplarPayload(f.state, f.posting, f.response, 'posting');
  expect(payload.products.map(p => p.exemplars[0].marks[0].mark)).toEqual(marks);
  expect(ozonUnitExemplarsPassed(payload, { status: 'passed' })).toBe(false);
  const response = { products: payload.products.map(p => ({ ...p, exemplars: p.exemplars.map(e => ({ ...e, marks: e.marks.map(m => ({ ...m, check_status: 'passed' })) })) })) };
  expect(ozonUnitExemplarsPassed(payload, response)).toBe(true);
  response.products[1].exemplars[0].marks[0].mark = marks[0];
  expect(ozonUnitExemplarsPassed(payload, response)).toBe(false);
});
// TEST: retries retain Ozon's exemplar assignment; a different KIZ is never overwritten.
it('preserves assignments and rejects foreign marks or missing exemplars', () => {
  const f = fixture();
  (f.response.products[1].exemplars[0] as any).marks = [{ mark: marks[1] }];
  expect(ozonUnitExemplarPayload(f.state, f.posting, f.response, 'posting').products[1].exemplars[0].marks[0].mark).toBe(marks[1]);
  (f.response.products[1].exemplars[0] as any).marks = [{ mark: marks[0] }];
  expect(() => ozonUnitExemplarPayload(f.state, f.posting, f.response, 'posting')).toThrow('другой КИЗ');
  f.response.products[1].exemplars = [];
  expect(() => ozonUnitExemplarPayload(f.state, f.posting, f.response, 'posting')).toThrow('Количество');
});
