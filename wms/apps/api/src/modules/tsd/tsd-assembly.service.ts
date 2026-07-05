import { Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { PickInstructionService } from '../stock/pick-instruction.service';
import type { PickInstructionDocument } from '../stock/pick-instruction.types';
import { PrismaService } from '../../common/prisma/prisma.service';

const activeAssemblyStatuses = [
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
  ClientRequestStatus.IN_WORK,
  ClientRequestStatus.PACKED,
];

@Injectable()
export class TsdAssemblyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly pickInstructions: PickInstructionService,
  ) {}

  async listActiveRequests(user: AuthUser) {
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        clientId: clientFilter,
        type: ClientRequestType.OUTBOUND,
        status: { in: activeAssemblyStatuses },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        destinationCity: true,
        desiredDate: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { id: true, name: true, code: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        _count: { select: { items: true } },
      },
    });

    return requests.map((request) => ({
      id: request.id,
      title: request.title,
      status: request.status,
      city: request.destinationCity,
      desiredDate: request.desiredDate?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      client: request.client,
      rowsCount: request._count.items,
      inWorkBy: request.assignedTo
        ? {
            id: request.assignedTo.id,
            name: request.assignedTo.name,
            email: request.assignedTo.email,
          }
        : null,
    }));
  }

  async getRequestPlan(requestId: string, user: AuthUser) {
    const exists = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clientId: true },
    });
    if (!exists) {
      throw new NotFoundException('Заявка для ТСД не найдена.');
    }

    this.clientScopes.requireClientAccess(user, exists.clientId, 'read');
    const document = await this.pickInstructions.getRequestInstruction(requestId, user);
    return this.toTsdPlan(document);
  }

  private toTsdPlan(document: PickInstructionDocument & { html?: string }) {
    const searchBoxes = uniqueSorted([
      ...document.warehouseRows.map((row) => row.sourceBox),
      ...document.warehouseBalanceMoves.map((row) => row.sourceBox),
      ...document.warehouseWholeBoxes.map((row) => row.box),
    ]).map((boxCode) => ({ boxCode }));

    const relabelTasks = collapseRows(
      document.warehouseRows
        .filter((row) => row.sourceBox && row.quantity > 0 && row.rebrandNote)
        .map((row) => {
          const parsed = parseRelabelNote(row.rebrandNote);
          return {
            sourceBox: row.sourceBox,
            oldBarcode: parsed.oldBarcode || row.barcodeOnBox,
            newBarcode: parsed.newBarcode || row.barcodeOnBox,
            barcode: parsed.newBarcode || row.barcodeOnBox,
            name: row.artOnBox,
            size: row.size,
            quantity: row.quantity,
            note: row.rebrandNote,
          };
        }),
      (row) => `${row.sourceBox}|${row.oldBarcode}|${row.newBarcode}|${row.size}`,
    );

    const movementTasks = collapseRows(
      document.warehouseBalanceMoves
        .filter((row) => row.sourceBox && row.newBox && row.quantity > 0)
        .map((row) => ({
          sourceBox: row.sourceBox,
          targetBox: row.newBox,
          barcode: row.barcodeOnBox,
          name: row.artOnBox,
          size: row.size,
          quantity: row.quantity,
          note: row.note,
        })),
      (row) => `${row.sourceBox}|${row.targetBox}|${row.barcode}|${row.size}`,
    );

    const totalRelabel = relabelTasks.reduce((sum, row) => sum + row.quantity, 0);
    const totalMove = movementTasks.reduce((sum, row) => sum + row.quantity, 0);

    return {
      id: document.requestId,
      title: document.requestTitle,
      status: document.requestStatus,
      statusLabel: document.requestStatusLabel,
      city: document.destinationCity,
      desiredDate: document.desiredDate,
      client: document.client,
      rowsCount: document.rowsCount,
      totalRequested: document.totalRequested,
      boxesTotal: searchBoxes.length,
      relabelTotal: totalRelabel,
      movementTotal: totalMove,
      searchBoxes,
      relabelTasks,
      movementTasks,
    };
  }
}

type CollapsibleRow = {
  sourceBox: string;
  quantity: number;
};

function collapseRows<T extends CollapsibleRow>(rows: T[], keyOf: (row: T) => string) {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = byKey.get(key);
    if (current) {
      current.quantity += row.quantity;
    } else {
      byKey.set(key, { ...row });
    }
  }

  return [...byKey.values()].sort((left, right) => left.sourceBox.localeCompare(right.sourceBox, 'ru', { numeric: true }));
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, 'ru', { numeric: true }),
  );
}

function parseRelabelNote(note: string) {
  const match = note.match(/перемаркировать\s+(.+?)\s*->\s*(.+)$/i);
  return {
    oldBarcode: match?.[1]?.trim() ?? '',
    newBarcode: match?.[2]?.trim() ?? '',
  };
}
