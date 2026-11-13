import { ConflictException } from '@nestjs/common';
import { clientKizIdentity } from '../../common/kiz-client-registry';
import { OzonPickState, requireOzonLineComposition } from './ozon-fbs-pick-lines';

// FIX: bind every scanned unit to its own exemplar, preserving already assigned marks.
export function ozonUnitExemplarPayload(state: OzonPickState, posting: any, response: any, postingNumber: string) {
  requireOzonLineComposition(state, posting);
  const usedIds = new Set<number>();
  const products = state.lines.filter(line => line.requiresKiz).map(line => {
    const matches = (response.products ?? []).filter((p: any) => Number(p.product_id) === line.productId);
    if (matches.length !== 1 || matches[0].exemplars?.length !== line.quantity)
      throw new ConflictException('Количество экземпляров Ozon отличается от собранного состава.');
    const remaining = new Map(line.picks.map(p => [clientKizIdentity(p.kiz!), p.kiz!]));
    const exemplars = matches[0].exemplars.map((e: any) => {
      const id = Number(e.exemplar_id);
      if (!Number.isSafeInteger(id) || id <= 0 || usedIds.has(id)) throw new ConflictException('Некорректный экземпляр Ozon.');
      usedIds.add(id);
      const marks = (e.marks ?? []).filter((m: any) => m.mark);
      if (marks.length > 1) throw new ConflictException('У экземпляра Ozon неоднозначная маркировка.');
      const identity = marks.length ? clientKizIdentity(marks[0].mark) : '';
      if (identity && !remaining.has(identity)) throw new ConflictException('В Ozon записан другой КИЗ. Нужна сверка.');
      if (marks.length && !identity) throw new ConflictException('Ozon вернул неполный КИЗ.');
      const mark = identity ? remaining.get(identity)! : null;
      if (identity) remaining.delete(identity);
      return { id, mark };
    });
    return { product_id: line.productId, exemplars: exemplars.map((e: any) => {
      let mark = e.mark;
      if (!mark) { const next = remaining.entries().next().value!; mark = next[1]; remaining.delete(next[0]); }
      return { exemplar_id: e.id, gtd: '', is_gtd_absent: true, rnpt: '', is_rnpt_absent: true,
        marks: [{ mark, mark_type: 'mandatory_mark' }] };
    }) };
  });
  return { multi_box_qty: 1, posting_number: postingNumber, products };
}

// FIX: a generic passed status cannot stand in for confirmation of the exact sent exemplars.
export function ozonUnitExemplarsPassed(payload: ReturnType<typeof ozonUnitExemplarPayload>, response: any) {
  if (response.status === 'failed') throw new ConflictException('Ozon отклонил маркировку заказа.');
  return payload.products.every(product => {
    const matches = (response.products ?? []).filter((p: any) => Number(p.product_id) === product.product_id);
    if (matches.length !== 1) return false;
    return product.exemplars.every((expected: any) => {
      const exemplars = (matches[0].exemplars ?? []).filter((e: any) => Number(e.exemplar_id) === expected.exemplar_id);
      if (exemplars.length !== 1) return false;
      const marks = exemplars[0].marks ?? [];
      if (marks.some((m: any) => m.error_codes?.length || m.check_status === 'failed')) throw new ConflictException('Ozon отклонил КИЗ.');
      return marks.length === 1 && marks[0].check_status === 'passed' &&
        (!marks[0].mark || clientKizIdentity(marks[0].mark) === clientKizIdentity(expected.marks[0].mark));
    });
  });
}
