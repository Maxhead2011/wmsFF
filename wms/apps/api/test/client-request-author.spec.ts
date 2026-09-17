import { describe, expect, it, vi } from 'vitest';
import { attachConfirmedRequestAuthors } from '../src/modules/client-requests/client-request-author';

// TEST: preserve known humans; null and unrelated audit events cannot invent WMS authorship.
describe('confirmed request authors', () => {
  it('labels only the confirmed request and leaves an unknown one unchanged', async () => {
    const findMany = vi.fn().mockResolvedValue([{ entityId: 'confirmed', payload: { author: 'WMS' } }]);
    const db = { auditLog: { findMany } } as any;
    const rows = [{ id: 'confirmed', createdByUserId: null }, { id: 'unknown', createdByUserId: null }];
    expect(await attachConfirmedRequestAuthors(db, rows)).toEqual([
      { ...rows[0], creationAuthorLabel: 'WMS' }, rows[1],
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      action: 'client_request.author_confirmed', entity: 'ClientRequest', entityId: { in: ['confirmed', 'unknown'] },
    } }));
  });
  it('does not replace a recorded user or perform extra queries for human-created requests', async () => {
    const findMany = vi.fn(); const rows = [{ id: 'human', createdByUserId: 'user' }];
    expect(await attachConfirmedRequestAuthors({ auditLog: { findMany } } as any, rows)).toEqual(rows);
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each([null, {}, { author: 'someone' }, ['WMS']])('rejects insufficient audit evidence %j', async payload => {
    const rows = [{ id: 'unknown', createdByUserId: null }];
    expect(await attachConfirmedRequestAuthors({ auditLog: { findMany: async () => [{ entityId: 'unknown', payload }] } } as any, rows)).toEqual(rows);
  });
});
