import { Prisma } from '@prisma/client';

export const pickWaveInclude = {
  createdBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  assignedPicker: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  requests: {
    include: {
      request: {
        select: {
          id: true,
          clientId: true,
          title: true,
          type: true,
          status: true,
          priority: true,
          destinationCity: true,
          client: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          items: {
            include: {
              sku: {
                select: {
                  id: true,
                  internalSku: true,
                  name: true,
                },
              },
            },
            orderBy: {
              id: 'asc',
            },
          },
        },
      },
    },
    orderBy: {
      requestId: 'asc',
    },
  },
  balanceLines: {
    select: {
      id: true,
      isReviewed: true,
      remainingQuantity: true,
    },
    orderBy: [{ sourceBoxCode: 'asc' }, { internalSku: 'asc' }],
  },
} satisfies Prisma.PickWaveInclude;
