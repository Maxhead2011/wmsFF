export type FbsSupplyAuditOrder = {
  id: string;
  connectionId: string;
  accountName: string | null;
  marketplace: string;
  category: string;
  supplierStatus: string;
  supplyId: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
};

export type FbsSupplyAuditLink = {
  connectionId: string;
  orderId: string;
  syncStatus: string;
  request: {
    number: number;
    status: string;
  };
};

export type FbsSupplyRequestAuditIssue = {
  connectionId: string;
  accountName: string | null;
  supplyId: string;
  warehouseId: string | null;
  warehouseName: string | null;
  status: 'MISSING' | 'PARTIAL';
  activeOrderCount: number;
  linkedOrderCount: number;
  unlinkedOrderCount: number;
  unlinkedOrderIds: string[];
  requestNumbers: number[];
};

export type FbsSupplyRequestAudit = {
  checkedAt: string;
  checkedConnections: number;
  checkedSupplies: number;
  checkedOrders: number;
  missingRequestSupplies: number;
  missingRequestOrders: number;
  issues: FbsSupplyRequestAuditIssue[];
};

function auditOrderKey(connectionId: string, orderId: string) {
  return `${connectionId}:${orderId}`;
}

function auditSupplyKey(connectionId: string, supplyId: string) {
  return `${connectionId}:${supplyId}`;
}

export function buildFbsSupplyRequestAudit(input: {
  checkedAt: string;
  orders: readonly FbsSupplyAuditOrder[];
  links: readonly FbsSupplyAuditLink[];
}): FbsSupplyRequestAudit {
  // FIX: compare the complete fresh WB snapshot by supply instead of the
  // paginated/filtered rows currently visible in the browser.
  const activeSupplyOrders = input.orders.filter(
    (order) =>
      order.marketplace === 'WILDBERRIES' &&
      order.category === 'active' &&
      order.supplierStatus === 'confirm' &&
      Boolean(order.supplyId?.trim()),
  );
  const activeLinks = input.links.filter(
    (link) => link.request.status !== 'CANCELLED' && link.syncStatus !== 'REMOVED',
  );
  const activeLinkByOrder = new Map(
    activeLinks.map((link) => [auditOrderKey(link.connectionId, link.orderId), link]),
  );
  const ordersBySupply = new Map<string, FbsSupplyAuditOrder[]>();

  for (const order of activeSupplyOrders) {
    const supplyId = order.supplyId!.trim().toUpperCase();
    const key = auditSupplyKey(order.connectionId, supplyId);
    const supplyOrders = ordersBySupply.get(key) ?? [];
    supplyOrders.push(order);
    ordersBySupply.set(key, supplyOrders);
  }

  const issues: FbsSupplyRequestAuditIssue[] = [];
  for (const supplyOrders of ordersBySupply.values()) {
    const first = supplyOrders[0];
    const linked = supplyOrders
      .map((order) => activeLinkByOrder.get(auditOrderKey(order.connectionId, order.id)))
      .filter((link): link is FbsSupplyAuditLink => Boolean(link));
    const unlinkedOrders = supplyOrders.filter(
      (order) => !activeLinkByOrder.has(auditOrderKey(order.connectionId, order.id)),
    );
    if (unlinkedOrders.length === 0) continue;

    issues.push({
      connectionId: first.connectionId,
      accountName: first.accountName,
      supplyId: first.supplyId!.trim().toUpperCase(),
      warehouseId: first.warehouseId,
      warehouseName: first.warehouseName,
      status: linked.length === 0 ? 'MISSING' : 'PARTIAL',
      activeOrderCount: supplyOrders.length,
      linkedOrderCount: linked.length,
      unlinkedOrderCount: unlinkedOrders.length,
      unlinkedOrderIds: unlinkedOrders.map((order) => order.id),
      requestNumbers: [...new Set(linked.map((link) => link.request.number))].sort(
        (left, right) => left - right,
      ),
    });
  }

  issues.sort((left, right) => left.supplyId.localeCompare(right.supplyId));
  return {
    checkedAt: input.checkedAt,
    checkedConnections: new Set(activeSupplyOrders.map((order) => order.connectionId)).size,
    checkedSupplies: ordersBySupply.size,
    checkedOrders: activeSupplyOrders.length,
    missingRequestSupplies: issues.length,
    missingRequestOrders: issues.reduce((sum, issue) => sum + issue.unlinkedOrderCount, 0),
    issues,
  };
}
