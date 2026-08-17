import { ClientNotificationEvent } from '@prisma/client';

export const clientNotificationEvents = [
  ClientNotificationEvent.REQUEST_STATUS_CHANGED,
  ClientNotificationEvent.REQUEST_FILE_UPLOADED,
  ClientNotificationEvent.REQUEST_COMMENT,
  ClientNotificationEvent.BILLING_INVOICE_STATUS_CHANGED,
  ClientNotificationEvent.BILLING_PAYMENT_RECORDED,
  ClientNotificationEvent.LOGISTICS_DELIVERY_STATUS_CHANGED,
  ClientNotificationEvent.MANUAL,
] as const;

type PreferenceReader = {
  clientNotificationPreference: {
    findUnique(args: {
      where: {
        clientId_eventType: {
          clientId: string;
          eventType: ClientNotificationEvent;
        };
      };
      select: {
        isEnabled: true;
      };
    }): Promise<{ isEnabled: boolean } | null>;
  };
};

export async function isClientNotificationEnabled(
  prisma: PreferenceReader,
  clientId: string,
  eventType: ClientNotificationEvent,
) {
  const preference = await prisma.clientNotificationPreference.findUnique({
    where: {
      clientId_eventType: {
        clientId,
        eventType,
      },
    },
    select: {
      isEnabled: true,
    },
  });

  return preference?.isEnabled ?? true;
}
