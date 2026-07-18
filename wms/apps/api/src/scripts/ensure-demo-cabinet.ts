import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingInvoiceSource,
  BillingInvoiceStatus,
  BillingPaymentStatus,
  BillingPriceTaxMode,
  BillingUnit,
  ClientNotificationEvent,
  ClientNotificationSeverity,
  ClientRequestEventType,
  ClientRequestPriority,
  ClientRequestStatus,
  ClientRequestType,
  ClientStatus,
  LogisticsDeliveryStatus,
  MovementType,
  PrismaClient,
  StockStatus,
  UserStatus,
  VolumeSource,
} from '@prisma/client';
import { PasswordService } from '../modules/auth/password.service';

const prisma = new PrismaClient();
const passwords = new PasswordService();

const DEMO_CLIENT_CODE = 'DEMO-LOGOFF';
const DEMO_LOGIN = 'demo';

function daysFromNow(days: number, hour = 10) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

async function main() {
  const existingClient = await prisma.client.findUnique({ where: { code: DEMO_CLIENT_CODE } });
  if (existingClient && !existingClient.isDemo) {
    throw new Error(`Клиент ${DEMO_CLIENT_CODE} существует, но не помечен как демонстрационный.`);
  }

  const client = await prisma.client.upsert({
    where: { code: DEMO_CLIENT_CODE },
    update: {
      name: 'Демо-магазин «Город и дом»',
      isDemo: true,
      status: ClientStatus.ACTIVE,
      legalName: 'ООО «Город и дом»',
      inn: '7700000000',
      kpp: '770001001',
      ogrn: '1000000000000',
      legalAddress: 'г. Москва, ул. Демонстрационная, д. 1',
      actualAddress: 'г. Москва, ул. Складская, д. 12',
      phone: '+7 900 000-00-00',
      email: 'demo@logoff.pro',
      bankName: 'Демонстрационный банк',
      bankBik: '044500000',
      bankAccount: '40702810000000000000',
      correspondentAccount: '30101810000000000000',
      storageAccountingEnabled: true,
      storagePriceRubPerLiterDay: 0.08,
      storesWithoutBoxes: false,
      onlineReceiptVisibleToClient: true,
    },
    create: {
      code: DEMO_CLIENT_CODE,
      name: 'Демо-магазин «Город и дом»',
      isDemo: true,
      status: ClientStatus.ACTIVE,
      legalName: 'ООО «Город и дом»',
      inn: '7700000000',
      kpp: '770001001',
      ogrn: '1000000000000',
      legalAddress: 'г. Москва, ул. Демонстрационная, д. 1',
      actualAddress: 'г. Москва, ул. Складская, д. 12',
      phone: '+7 900 000-00-00',
      email: 'demo@logoff.pro',
      bankName: 'Демонстрационный банк',
      bankBik: '044500000',
      bankAccount: '40702810000000000000',
      correspondentAccount: '30101810000000000000',
      storageAccountingEnabled: true,
      storagePriceRubPerLiterDay: 0.08,
      storesWithoutBoxes: false,
      onlineReceiptVisibleToClient: true,
    },
  });

  const existingUser = await prisma.user.findUnique({ where: { email: DEMO_LOGIN } });
  if (existingUser && !existingUser.isDemo) {
    throw new Error(`Пользователь ${DEMO_LOGIN} существует, но не помечен как демонстрационный.`);
  }

  const user = await prisma.user.upsert({
    where: { email: DEMO_LOGIN },
    update: {
      name: 'Демо-пользователь',
      passwordHash: await passwords.hash('demo'),
      status: UserStatus.ACTIVE,
      isDemo: true,
    },
    create: {
      email: DEMO_LOGIN,
      name: 'Демо-пользователь',
      passwordHash: await passwords.hash('demo'),
      status: UserStatus.ACTIVE,
      isDemo: true,
    },
  });

  await ensureDemoAccess(user.id, client.id);

  const skuDefinitions = [
    ['d1000000-0000-4000-8000-000000000001', 'DEMO-SKU-001', 'HOME-PLD-GRY', 'Плед хлопковый «Уют»', 'Дом и текстиль', 'Серый', '150×200', 3.6, false],
    ['d1000000-0000-4000-8000-000000000002', 'DEMO-SKU-002', 'KITCH-BTL-750', 'Термобутылка Urban 750 мл', 'Посуда', 'Синий', '750 мл', 1.1, false],
    ['d1000000-0000-4000-8000-000000000003', 'DEMO-SKU-003', 'BEAUTY-CRM-50', 'Крем для рук «Хлопок»', 'Красота', 'Белый', '50 мл', 0.18, true],
    ['d1000000-0000-4000-8000-000000000004', 'DEMO-SKU-004', 'CANDLE-VNL-01', 'Свеча ароматическая «Ваниль»', 'Интерьер', 'Бежевый', '180 г', 0.72, true],
    ['d1000000-0000-4000-8000-000000000005', 'DEMO-SKU-005', 'BAG-SHOP-BLK', 'Сумка-шоппер LOGOff', 'Аксессуары', 'Чёрный', 'M', 1.4, false],
    ['d1000000-0000-4000-8000-000000000006', 'DEMO-SKU-006', 'TEA-MINT-100', 'Чай травяной «Мята»', 'Продукты', 'Зелёный', '100 г', 0.45, true],
    ['d1000000-0000-4000-8000-000000000007', 'DEMO-SKU-007', 'TOWEL-WHT-70', 'Полотенце махровое Premium', 'Дом и текстиль', 'Белый', '70×140', 2.2, false],
    ['d1000000-0000-4000-8000-000000000008', 'DEMO-SKU-008', 'ORG-BOX-03', 'Органайзер складной, 3 секции', 'Хранение', 'Графит', '3 секции', 4.8, false],
  ] as const;

  for (const [index, definition] of skuDefinitions.entries()) {
    const [id, internalSku, article, name, category, color, size, volumeLiters, needsChestnyZnak] = definition;
    await prisma.sku.upsert({
      where: { id },
      update: {
        clientId: client.id,
        internalSku,
        clientSku: article,
        article,
        name,
        brand: 'Город и дом',
        category,
        color,
        size,
        volumeLiters,
        volumeSource: VolumeSource.MANUAL,
        needsChestnyZnak,
        shelfLifeUntil: index === 5 ? daysFromNow(75) : null,
      },
      create: {
        id,
        clientId: client.id,
        internalSku,
        clientSku: article,
        article,
        name,
        brand: 'Город и дом',
        category,
        color,
        size,
        volumeLiters,
        volumeSource: VolumeSource.MANUAL,
        needsChestnyZnak,
        shelfLifeUntil: index === 5 ? daysFromNow(75) : null,
      },
    });
    await prisma.barcode.upsert({
      where: { skuId_value: { skuId: id, value: `46070000000${index + 10}` } },
      update: { isPrimary: true },
      create: { skuId: id, value: `46070000000${index + 10}`, isPrimary: true },
    });
  }

  const boxes = Array.from({ length: 10 }, (_, index) => ({
    id: `d2000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    code: `DEMO-BOX-${String(index + 1).padStart(3, '0')}`,
  }));
  for (const box of boxes) {
    await prisma.box.upsert({
      where: { id: box.id },
      update: { clientId: client.id, code: box.code, status: 'active' },
      create: { ...box, clientId: client.id, status: 'active' },
    });
  }

  const balanceRows = [
    [0, 0, StockStatus.AVAILABLE, 48],
    [1, 0, StockStatus.RESERVED, 6],
    [1, 1, StockStatus.AVAILABLE, 72],
    [2, 2, StockStatus.AVAILABLE, 115],
    [2, 3, StockStatus.NEEDS_LABEL, 12],
    [3, 3, StockStatus.AVAILABLE, 36],
    [4, 4, StockStatus.AVAILABLE, 84],
    [5, 5, StockStatus.AVAILABLE, 57],
    [5, 6, StockStatus.QUARANTINE, 4],
    [6, 7, StockStatus.AVAILABLE, 31],
    [7, 8, StockStatus.AVAILABLE, 26],
    [7, 9, StockStatus.DEFECT, 2],
    [0, 9, StockStatus.PACKING, 5],
    [4, 8, StockStatus.SHIPPING, 9],
  ] as const;
  for (const [index, [skuIndex, boxIndex, status, quantity]] of balanceRows.entries()) {
    const id = `d3000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const balanceKey = `demo:${client.id}:${skuDefinitions[skuIndex][0]}:${boxes[boxIndex].id}:${status}`;
    await prisma.stockBalance.upsert({
      where: { id },
      update: { balanceKey, clientId: client.id, skuId: skuDefinitions[skuIndex][0], boxId: boxes[boxIndex].id, status, quantity },
      create: { id, balanceKey, clientId: client.id, skuId: skuDefinitions[skuIndex][0], boxId: boxes[boxIndex].id, status, quantity },
    });
  }

  for (const [index, [skuIndex, boxIndex, status, quantity]] of balanceRows.entries()) {
    const id = `d3100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    await prisma.stockMovement.upsert({
      where: { id },
      update: {
        clientId: client.id,
        skuId: skuDefinitions[skuIndex][0],
        boxId: boxes[boxIndex].id,
        type: index % 4 === 0 ? MovementType.RECEIPT : MovementType.INITIAL_IMPORT,
        status,
        quantity,
        sourceDocument: `DEMO-ПРИЕМКА-${String(index + 1).padStart(3, '0')}`,
        comment: 'Демонстрационное движение товара',
      },
      create: {
        id,
        clientId: client.id,
        skuId: skuDefinitions[skuIndex][0],
        boxId: boxes[boxIndex].id,
        type: index % 4 === 0 ? MovementType.RECEIPT : MovementType.INITIAL_IMPORT,
        status,
        quantity,
        sourceDocument: `DEMO-ПРИЕМКА-${String(index + 1).padStart(3, '0')}`,
        idempotencyKey: `demo-movement-${index + 1}`,
        comment: 'Демонстрационное движение товара',
      },
    });
  }

  await ensureRequests(client.id, user.id, skuDefinitions);
  const services = await ensureBillingServices(client.id, user.id);
  const charges = await ensureCharges(client.id, user.id, services);
  await ensureInvoices(client.id, user.id, charges);
  await ensureDeliveries(client.id, user.id);
  await ensureNotifications(client.id, user.id);

  const counts = await Promise.all([
    prisma.sku.count({ where: { clientId: client.id } }),
    prisma.box.count({ where: { clientId: client.id } }),
    prisma.stockBalance.count({ where: { clientId: client.id } }),
    prisma.clientRequest.count({ where: { clientId: client.id } }),
    prisma.billingCharge.count({ where: { clientId: client.id } }),
    prisma.billingInvoice.count({ where: { clientId: client.id } }),
    prisma.logisticsDeliveryRequest.count({ where: { clientId: client.id } }),
    prisma.clientNotification.count({ where: { clientId: client.id } }),
  ]);
  console.log(
    `Demo cabinet ready: 1 client, ${counts[0]} SKU, ${counts[1]} boxes, ${counts[2]} balances, ${counts[3]} requests, ${counts[4]} charges, ${counts[5]} invoices, ${counts[6]} deliveries, ${counts[7]} notifications.`,
  );
}

async function ensureDemoAccess(userId: string, clientId: string) {
  const permissionDefinitions = [
    ['billing:read', 'Просмотр финансов'],
    ['client-notifications:read', 'Просмотр уведомлений'],
    ['client-requests:read', 'Просмотр заявок'],
    ['client-requests:write', 'Создание заявок'],
    ['clients:read', 'Просмотр своего клиента'],
    ['logistics:read', 'Просмотр логистики'],
    ['logistics:request', 'Создание заявки на доставку'],
    ['skus:read', 'Просмотр номенклатуры'],
    ['stock:read', 'Просмотр остатков'],
  ] as const;
  const role = await prisma.role.upsert({
    where: { code: 'CLIENT' },
    update: {},
    create: { code: 'CLIENT', name: 'Клиент' },
  });
  for (const [code, name] of permissionDefinitions) {
    const permission = await prisma.permission.upsert({ where: { code }, update: { name }, create: { code, name } });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
  await prisma.userRole.deleteMany({ where: { userId, roleId: { not: role.id } } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id },
  });
  await prisma.userClient.deleteMany({ where: { userId, clientId: { not: clientId } } });
  await prisma.userClient.upsert({
    where: { userId_clientId: { userId, clientId } },
    update: { canRead: true, canWrite: true },
    create: { userId, clientId, canRead: true, canWrite: true },
  });
}

async function ensureRequests(
  clientId: string,
  userId: string,
  skus: ReadonlyArray<readonly [string, ...unknown[]]>,
) {
  const definitions = [
    [1, ClientRequestType.INBOUND, ClientRequestStatus.IN_REVIEW, ClientRequestPriority.HIGH, 'Поставка летней коллекции', 'Ожидается 18 коробов, требуется пересчёт и фото при приёмке.'],
    [2, ClientRequestType.OUTBOUND, ClientRequestStatus.IN_WORK, ClientRequestPriority.URGENT, 'Отгрузка на Wildberries — Коледино', 'Собрать по коробам, проверить КИЗ и передать водителю до 16:00.'],
    [3, ClientRequestType.RETURN, ClientRequestStatus.APPROVED, ClientRequestPriority.NORMAL, 'Обработка возвратов маркетплейса', 'Проверить товарный вид, годное вернуть в доступный остаток.'],
    [4, ClientRequestType.SERVICE, ClientRequestStatus.SUBMITTED, ClientRequestPriority.NORMAL, 'Перемаркировка партии свечей', 'Наклеить новые этикетки и проверить читаемость штрихкода.'],
    [5, ClientRequestType.OUTBOUND, ClientRequestStatus.PACKED, ClientRequestPriority.HIGH, 'Заказ интернет-магазина № 1842', 'Упаковано, ожидает передачу в доставку.'],
    [6, ClientRequestType.DELIVERY, ClientRequestStatus.IN_WORK, ClientRequestPriority.NORMAL, 'Доставка на РЦ Ozon', '6 коробов, слот подтверждён на утро.'],
    [7, ClientRequestType.INBOUND, ClientRequestStatus.DONE, ClientRequestPriority.NORMAL, 'Приёмка партии текстиля', 'Поставка принята и размещена по коробам.'],
    [8, ClientRequestType.OUTBOUND, ClientRequestStatus.CANCELLED, ClientRequestPriority.LOW, 'Тестовая отгрузка образцов', 'Отменена клиентом до начала сборки.'],
  ] as const;

  for (const [index, type, status, priority, title, comment] of definitions) {
    const id = `d4000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    await prisma.clientRequest.upsert({
      where: { id },
      update: {
        clientId,
        type,
        status,
        priority,
        title,
        comment,
        contactName: 'Анна Смирнова',
        contactPhone: '+7 900 000-00-00',
        destinationCity: index % 2 === 0 ? 'Москва' : null,
        deliveryAddress: index % 2 === 0 ? 'Москва, демонстрационный адрес получателя' : null,
        desiredDate: daysFromNow(index - 3),
        createdByUserId: userId,
      },
      create: {
        id,
        clientId,
        type,
        status,
        priority,
        title,
        comment,
        contactName: 'Анна Смирнова',
        contactPhone: '+7 900 000-00-00',
        destinationCity: index % 2 === 0 ? 'Москва' : null,
        deliveryAddress: index % 2 === 0 ? 'Москва, демонстрационный адрес получателя' : null,
        desiredDate: daysFromNow(index - 3),
        createdByUserId: userId,
        createdAt: daysFromNow(-20 + index),
      },
    });

    const itemId = `d4100000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const skuId = skus[(index - 1) % skus.length][0];
    await prisma.clientRequestItem.upsert({
      where: { id: itemId },
      update: { requestId: id, skuId, quantity: 8 + index * 3, comment: 'Демонстрационная позиция' },
      create: { id: itemId, requestId: id, skuId, quantity: 8 + index * 3, comment: 'Демонстрационная позиция' },
    });
    await prisma.clientRequestEvent.upsert({
      where: { id: `d4200000-0000-4000-8000-${String(index).padStart(12, '0')}` },
      update: { requestId: id, clientId, eventType: ClientRequestEventType.CREATED, title: 'Заявка создана', createdByUserId: userId },
      create: {
        id: `d4200000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        requestId: id,
        clientId,
        eventType: ClientRequestEventType.CREATED,
        title: 'Заявка создана',
        body: 'Заявка добавлена из демонстрационного кабинета.',
        createdByUserId: userId,
        createdAt: daysFromNow(-20 + index),
      },
    });
    await prisma.clientRequestComment.upsert({
      where: { id: `d4300000-0000-4000-8000-${String(index).padStart(12, '0')}` },
      update: { requestId: id, clientId, authorUserId: userId, body: index % 2 ? 'Подтверждаем количество и состав партии.' : 'Документы приложены, можно запускать в работу.', isInternal: false },
      create: {
        id: `d4300000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        requestId: id,
        clientId,
        authorUserId: userId,
        body: index % 2 ? 'Подтверждаем количество и состав партии.' : 'Документы приложены, можно запускать в работу.',
        isInternal: false,
        createdAt: daysFromNow(-18 + index),
      },
    });
  }

  const requestId = 'd4000000-0000-4000-8000-000000000002';
  await prisma.clientRequestFile.upsert({
    where: { id: 'd4400000-0000-4000-8000-000000000001' },
    update: {
      requestId,
      clientId,
      fileName: 'состав-поставки-demo.txt',
      mimeType: 'text/plain',
      sizeBytes: 86,
      content: Buffer.from('Демонстрационный файл. Состав поставки и контрольные количества.', 'utf8'),
      uploadedByUserId: userId,
    },
    create: {
      id: 'd4400000-0000-4000-8000-000000000001',
      requestId,
      clientId,
      fileName: 'состав-поставки-demo.txt',
      mimeType: 'text/plain',
      sizeBytes: 86,
      content: Buffer.from('Демонстрационный файл. Состав поставки и контрольные количества.', 'utf8'),
      uploadedByUserId: userId,
      createdAt: daysFromNow(-8),
    },
  });
}

async function ensureBillingServices(clientId: string, userId: string) {
  const definitions = [
    ['DEMO-RECEIPT', 'Приёмка товара', BillingUnit.PIECE, 8],
    ['DEMO-PICK', 'Сборка заказа', BillingUnit.PIECE, 12],
    ['DEMO-PACK', 'Упаковка заказа', BillingUnit.BOX, 65],
    ['DEMO-LABEL', 'Маркировка', BillingUnit.PIECE, 6],
    ['DEMO-STORAGE', 'Хранение', BillingUnit.LITER_DAY, 0.08],
    ['DEMO-DELIVERY', 'Доставка', BillingUnit.SERVICE, 3200],
  ] as const;
  const result = new Map<string, string>();
  for (const [code, name, unit, price] of definitions) {
    const service = await prisma.billingService.upsert({
      where: { code },
      update: { name, unit, defaultPriceRub: price, isActive: true },
      create: { code, name, unit, defaultPriceRub: price, isActive: true },
    });
    result.set(code, service.id);
    await prisma.clientBillingService.upsert({
      where: { clientId_serviceId: { clientId, serviceId: service.id } },
      update: { priceRub: price, taxMode: BillingPriceTaxMode.INCLUDED, isActive: true, updatedByUserId: userId },
      create: { clientId, serviceId: service.id, priceRub: price, taxMode: BillingPriceTaxMode.INCLUDED, isActive: true, updatedByUserId: userId },
    });
  }
  return result;
}

async function ensureCharges(clientId: string, userId: string, services: Map<string, string>) {
  const definitions = [
    [1, 'DEMO-RECEIPT', 'Приёмка товара по поставке', BillingUnit.PIECE, 186, 8, BillingChargeStatus.APPROVED, BillingChargeSource.MANUAL, -24],
    [2, 'DEMO-PICK', 'Сборка заказов маркетплейса', BillingUnit.PIECE, 94, 12, BillingChargeStatus.APPROVED, BillingChargeSource.MANUAL, -18],
    [3, 'DEMO-PACK', 'Упаковка в транспортные короба', BillingUnit.BOX, 18, 65, BillingChargeStatus.APPROVED, BillingChargeSource.MANUAL, -17],
    [4, 'DEMO-LABEL', 'Печать и нанесение этикеток', BillingUnit.PIECE, 120, 6, BillingChargeStatus.APPROVED, BillingChargeSource.MANUAL, -12],
    [5, 'DEMO-STORAGE', 'Хранение товара за период', BillingUnit.LITER_DAY, 28600, 0.08, BillingChargeStatus.APPROVED, BillingChargeSource.STORAGE, -8],
    [6, 'DEMO-DELIVERY', 'Доставка на РЦ маркетплейса', BillingUnit.SERVICE, 1, 3200, BillingChargeStatus.APPROVED, BillingChargeSource.LOGISTICS, -5],
    [7, 'DEMO-PICK', 'Сборка текущей волны заказов', BillingUnit.PIECE, 37, 12, BillingChargeStatus.DRAFT, BillingChargeSource.MANUAL, -1],
    [8, 'DEMO-PACK', 'Дополнительная упаковка', BillingUnit.BOX, 6, 65, BillingChargeStatus.DRAFT, BillingChargeSource.MANUAL, 0],
  ] as const;
  const result = new Map<number, string>();
  for (const [index, serviceCode, description, unit, quantity, price, status, source, day] of definitions) {
    const id = `d5000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const totalRub = Number((quantity * price).toFixed(2));
    await prisma.billingCharge.upsert({
      where: { id },
      update: {
        clientId,
        serviceId: services.get(serviceCode),
        description,
        unit,
        quantity,
        unitPriceRub: price,
        totalRub,
        status,
        serviceDate: daysFromNow(day),
        source,
        comment: 'Демонстрационное начисление',
        createdByUserId: userId,
        approvedByUserId: status === BillingChargeStatus.APPROVED ? userId : null,
        approvedAt: status === BillingChargeStatus.APPROVED ? daysFromNow(day + 1) : null,
      },
      create: {
        id,
        clientId,
        serviceId: services.get(serviceCode),
        description,
        unit,
        quantity,
        unitPriceRub: price,
        totalRub,
        status,
        serviceDate: daysFromNow(day),
        source,
        sourceKey: `demo-charge-${index}`,
        comment: 'Демонстрационное начисление',
        createdByUserId: userId,
        approvedByUserId: status === BillingChargeStatus.APPROVED ? userId : null,
        approvedAt: status === BillingChargeStatus.APPROVED ? daysFromNow(day + 1) : null,
      },
    });
    result.set(index, id);
  }
  return result;
}

async function ensureInvoices(clientId: string, userId: string, charges: Map<number, string>) {
  const definitions = [
    [1, 'ДЕМО-2026-001', BillingInvoiceStatus.PAID, 2840, 2840, -45, -31],
    [2, 'ДЕМО-2026-002', BillingInvoiceStatus.PAID, 5296, 5296, -30, -16],
    [3, 'ДЕМО-2026-003', BillingInvoiceStatus.ISSUED, 5488, 2200, -15, -1],
    [4, 'ДЕМО-2026-004', BillingInvoiceStatus.DRAFT, 390, 0, -2, 12],
  ] as const;
  for (const [index, number, status, totalRub, paidRub, fromDay, toDay] of definitions) {
    const id = `d6000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    await prisma.billingInvoice.upsert({
      where: { id },
      update: {
        number,
        clientId,
        periodFrom: daysFromNow(fromDay),
        periodTo: daysFromNow(toDay),
        dueDate: daysFromNow(toDay + 7),
        status,
        source: BillingInvoiceSource.MANUAL,
        totalRub,
        paidRub,
        issuedAt: status === BillingInvoiceStatus.DRAFT ? null : daysFromNow(toDay),
        paidAt: status === BillingInvoiceStatus.PAID ? daysFromNow(toDay + 3) : null,
        comment: 'Демонстрационный счёт',
        createdByUserId: userId,
      },
      create: {
        id,
        number,
        clientId,
        periodFrom: daysFromNow(fromDay),
        periodTo: daysFromNow(toDay),
        dueDate: daysFromNow(toDay + 7),
        status,
        source: BillingInvoiceSource.MANUAL,
        sourceKey: `demo-invoice-${index}`,
        totalRub,
        paidRub,
        issuedAt: status === BillingInvoiceStatus.DRAFT ? null : daysFromNow(toDay),
        paidAt: status === BillingInvoiceStatus.PAID ? daysFromNow(toDay + 3) : null,
        comment: 'Демонстрационный счёт',
        createdByUserId: userId,
      },
    });
    const chargeId = charges.get(Math.min(index * 2, 8));
    await prisma.billingInvoiceItem.upsert({
      where: { id: `d6100000-0000-4000-8000-${String(index).padStart(12, '0')}` },
      update: { invoiceId: id, chargeId, description: 'Услуги фулфилмента за период', unit: BillingUnit.SERVICE, quantity: 1, unitPriceRub: totalRub, totalRub, serviceDate: daysFromNow(toDay) },
      create: { id: `d6100000-0000-4000-8000-${String(index).padStart(12, '0')}`, invoiceId: id, chargeId, description: 'Услуги фулфилмента за период', unit: BillingUnit.SERVICE, quantity: 1, unitPriceRub: totalRub, totalRub, serviceDate: daysFromNow(toDay) },
    });
    if (paidRub > 0) {
      await prisma.billingPayment.upsert({
        where: { id: `d6200000-0000-4000-8000-${String(index).padStart(12, '0')}` },
        update: { invoiceId: id, clientId, amountRub: paidRub, paidAt: daysFromNow(toDay + 3), method: 'Банковский перевод', reference: `DEMO-PAY-${index}`, status: BillingPaymentStatus.RECORDED, createdByUserId: userId },
        create: { id: `d6200000-0000-4000-8000-${String(index).padStart(12, '0')}`, invoiceId: id, clientId, amountRub: paidRub, paidAt: daysFromNow(toDay + 3), method: 'Банковский перевод', reference: `DEMO-PAY-${index}`, status: BillingPaymentStatus.RECORDED, createdByUserId: userId },
      });
    }
  }
}

async function ensureDeliveries(clientId: string, userId: string) {
  const definitions = [
    [1, LogisticsDeliveryStatus.REQUESTED, 'Склад LOGOff, Москва', 'РЦ Wildberries, Коледино', 18, null, 0],
    [2, LogisticsDeliveryStatus.QUOTED, 'Склад LOGOff, Москва', 'РЦ Ozon, Хоругвино', 6, 4200, 2],
    [3, LogisticsDeliveryStatus.PLANNED, 'Склад LOGOff, Москва', 'Москва, ул. Получателя, д. 5', 4, 1900, 3],
    [4, LogisticsDeliveryStatus.IN_TRANSIT, 'Склад LOGOff, Москва', 'РЦ Яндекс Маркет, Софьино', 12, 5100, -1],
    [5, LogisticsDeliveryStatus.DELIVERED, 'Склад LOGOff, Москва', 'РЦ Wildberries, Электросталь', 9, 3800, -8],
  ] as const;
  for (const [index, status, origin, destination, boxes, total, shipDay] of definitions) {
    const id = `d7000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    await prisma.logisticsDeliveryRequest.upsert({
      where: { id },
      update: { clientId, origin, destination, boxes, desiredShipDate: daysFromNow(shipDay), plannedShipDate: status === LogisticsDeliveryStatus.REQUESTED ? null : daysFromNow(shipDay), status, estimatedTotalRub: total, requiresManualReview: status === LogisticsDeliveryStatus.REQUESTED, comment: 'Демонстрационная доставка', createdByUserId: userId },
      create: { id, clientId, origin, destination, boxes, desiredShipDate: daysFromNow(shipDay), plannedShipDate: status === LogisticsDeliveryStatus.REQUESTED ? null : daysFromNow(shipDay), status, estimatedTotalRub: total, requiresManualReview: status === LogisticsDeliveryStatus.REQUESTED, comment: 'Демонстрационная доставка', createdByUserId: userId, createdAt: daysFromNow(shipDay - 4) },
    });
  }
}

async function ensureNotifications(clientId: string, userId: string) {
  const definitions = [
    [1, 'Новая заявка принята', 'Поставка летней коллекции передана менеджеру на проверку.', ClientNotificationSeverity.INFO, false, -1],
    [2, 'Отгрузка запущена в работу', 'Сборщик начал комплектацию отгрузки на Wildberries.', ClientNotificationSeverity.SUCCESS, false, -1],
    [3, 'Требуется решение по маркировке', 'В коробе DEMO-BOX-004 найдено 12 товаров без этикетки.', ClientNotificationSeverity.WARNING, false, -2],
    [4, 'Выставлен новый счёт', 'Счёт ДЕМО-2026-003 доступен для просмотра и скачивания.', ClientNotificationSeverity.INFO, true, -4],
    [5, 'Получена частичная оплата', 'По счёту ДЕМО-2026-003 учтена оплата 2 200 ₽.', ClientNotificationSeverity.SUCCESS, true, -3],
    [6, 'Доставка в пути', 'Машина с поставкой на РЦ Яндекс Маркет выехала со склада.', ClientNotificationSeverity.INFO, false, 0],
    [7, 'Приближается срок годности', 'Проверьте остаток травяного чая со сроком годности менее 90 дней.', ClientNotificationSeverity.WARNING, true, -6],
    [8, 'Приёмка завершена', 'Партия текстиля полностью принята и размещена.', ClientNotificationSeverity.SUCCESS, true, -10],
    [9, 'Файл добавлен к заявке', 'К заявке на отгрузку приложен состав поставки.', ClientNotificationSeverity.INFO, true, -7],
    [10, 'Демо-кабинет готов', 'Все разделы заполнены безопасными демонстрационными данными одного клиента.', ClientNotificationSeverity.SUCCESS, false, 0],
  ] as const;
  for (const [index, title, body, severity, isRead, day] of definitions) {
    const id = `d8000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    await prisma.clientNotification.upsert({
      where: { id },
      update: { clientId, title, body, severity, isRead, readAt: isRead ? daysFromNow(day + 1) : null, createdByUserId: userId },
      create: { id, clientId, title, body, severity, isRead, readAt: isRead ? daysFromNow(day + 1) : null, createdByUserId: userId, createdAt: daysFromNow(day) },
    });
  }
  for (const eventType of Object.values(ClientNotificationEvent)) {
    await prisma.clientNotificationPreference.upsert({
      where: { clientId_eventType: { clientId, eventType } },
      update: { isEnabled: true, updatedByUserId: userId },
      create: { clientId, eventType, isEnabled: true, updatedByUserId: userId },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
