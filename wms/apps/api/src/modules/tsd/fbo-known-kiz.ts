import { ConflictException } from '@nestjs/common';
// FIX: source and runtime call this before any recovery, binding or quantity change.
export function requireKnownFboKiz(mark: unknown) {
  if (process.env.WMS_INVENTORY_FOUND_UNIT_ENABLED === 'true' && !mark)
    throw new ConflictException('КИЗ не зарегистрирован в WMS. Отбор остановлен. Передайте товар администратору для проверки приёмки и исходного короба.');
}
