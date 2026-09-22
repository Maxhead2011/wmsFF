import type { Prisma } from '@prisma/client';

export const WMS_AUTO_ASSEMBLY_AUTHOR_ID = '59432a17-6c71-4e51-a349-7466d4cf0158';
// FIX: a blocked, roleless identity is attribution only, never an execution principal.
export async function ensureWmsAutoAssemblyAuthor(tx: Prisma.TransactionClient): Promise<string> {
  const author = await tx.user.upsert({
    where: { id: WMS_AUTO_ASSEMBLY_AUTHOR_ID }, update: {},
    create: { id: WMS_AUTO_ASSEMBLY_AUTHOR_ID, email: 'autosborka@system.wms.invalid',
      name: 'WMS', status: 'BLOCKED', passwordHash: '!SYSTEM-NO-LOGIN!' },
    select: { id: true, name: true, status: true, roles: { select: { roleId: true } } },
  });
  if (author.name !== 'WMS' || author.status !== 'BLOCKED' || author.roles.length) {
    throw new Error('Некорректная служебная запись автора автосборки.');
  }
  return author.id;
}

// FIX: numeric placeholders are not warehouse names; retain a truthful fallback if no name is known.
export function fbsRequestWarehouseName(id: string | null | undefined, ...names: Array<string | null | undefined>) {
  const name = names.map(value => value?.trim()).find(value => value && !/^\d+$/.test(value) && !/^(?:WB №|Склад WB )\d+$/.test(value));
  return name || (id ? `WB №${id}` : 'WB: склад не определён');
}
