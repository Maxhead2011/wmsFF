# Совмещение с действующим учётом отгрузок

Пользователь 18.09.2026 разрешил разрешение конфликта с действующей серверной реализацией `ensureFbsProcessingCharges` с сохранением обеих логик.

В production до финансовой транзакции остаётся существующее получение `wbOrderShipment` страницами по 1000, исключение `LEGACY_WMS_SHIPMENT`, восстановление processingEvidence и processingAttemptId из снимков. После расчёта остаётся существующее сопоставление ключей попыток заказам.

Единственное изменение внутри этой действующей оболочки — выбор способа расчёта:

```ts
// FIX: preserve durable-work recovery, then bound the shipment calculation by day.
const result = process.env.WMS_FBS_BILLING_DAILY_TRANSACTIONS === 'true'
  ? await (async () => {
    await runBillingMutation(this.prisma, db => recoverCompletedWork(db, clientId));
    return this.ensureFbsProcessingChargesByDay(clientId, orders);
  })()
  : await runBillingMutation(this.prisma, async db => {
    await recoverCompletedWork(db, clientId);
    return withBillingDb(this, db).ensureFbsProcessingChargesLocked(clientId, orders);
  });
```

Восстановление ранее выполненных работ выполняется один раз в отдельной финансовой транзакции, затем каждый расчётный день — в своей. Все используют прежнюю глобальную блокировку. При ошибке восстановления расчёт счетов прекращается; обновление остатков к этому моменту уже выполнялось. Восстановление само по себе ещё может достичь своего тайм-аута: успешный health-check не подтверждает завершение биллинга.

Совмещённый исходник сохраняется в артефактах выпуска, проверяется TypeScript-компилятором и регрессиями финансовой логики. База production перед публикацией должна совпадать с базой сборки; при другом конфликте публикация останавливается.
