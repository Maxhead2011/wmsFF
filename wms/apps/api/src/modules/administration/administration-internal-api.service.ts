import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

export const INTERNAL_API_RESTART_CONFIRMATION = 'ПЕРЕЗАПУСТИТЬ API';

export type InternalApiDefinition = {
  id: string;
  name: string;
  prefixes: string[];
  routeCount: number;
  description: string;
  logic: string[];
  dependencies: string[];
  requiresDatabase?: boolean;
};

// ADDED: Explicit registry documents every controller group loaded by AppModule.
// Keeping it declarative avoids a global interceptor and therefore does not touch normal API traffic.
export const INTERNAL_API_DEFINITIONS: readonly InternalApiDefinition[] = Object.freeze([
  {
    id: 'health',
    name: 'Состояние сервиса',
    prefixes: ['/health'],
    routeCount: 1,
    description: 'Публичная проверка, что процесс API запущен и принимает HTTP-запросы.',
    logic: ['Возвращает время сервера и базовый статус процесса.', 'Используется балансировщиком и при проверке восстановления после перезапуска.'],
    dependencies: ['Nest API'],
    requiresDatabase: false,
  },
  {
    id: 'auth',
    name: 'Авторизация',
    prefixes: ['/auth'],
    routeCount: 4,
    description: 'Вход пользователей, выдача токенов и загрузка текущего профиля.',
    logic: ['Проверяет логин и пароль.', 'Формирует права, филиалы и клиентскую область доступа.', 'Возвращает текущую сессию пользователя или ТСД.'],
    dependencies: ['Основная БД', 'JWT'],
  },
  {
    id: 'administration',
    name: 'Администрирование',
    prefixes: ['/administration'],
    // FIX: the current production base already contains three unpalleted-box maintenance routes.
    routeCount: 35,
    description: 'Диагностика WMS, технические работы, настройки, аудит и контроль внутренних API.',
    logic: ['Собирает административные показатели и журнал действий.', 'Диагностирует заявки, паллет-сорты, короба, КИЗ и задания ТСД.', 'Разрешает только серверные, повторно проверяемые исправления.'],
    dependencies: ['Основная БД', 'Права system:admin'],
  },
  {
    id: 'analytics',
    name: 'Аналитика',
    prefixes: ['/analytics'],
    routeCount: 4,
    description: 'Отчёты по продажам, регионам, товарам и синхронизации аналитических данных.',
    logic: ['Читает подготовленные аналитические срезы.', 'Запускает и контролирует синхронизацию источников.', 'Формирует показатели для аналитических экранов.'],
    dependencies: ['Основная БД', 'Аналитическая БД', 'API маркетплейсов'],
  },
  {
    id: 'billing',
    name: 'Биллинг и счета',
    prefixes: ['/billing'],
    routeCount: 39,
    description: 'Расчёт услуг, начислений, счетов, оплат и закрывающих документов.',
    logic: ['Считает услуги по тарифам и операциям WMS.', 'Формирует счета, акты и печатные документы.', 'Учитывает оплаты, долги и ручные корректировки с аудитом.'],
    dependencies: ['Основная БД', 'PDF-генератор'],
  },
  {
    id: 'branches',
    name: 'Филиалы',
    prefixes: ['/branches'],
    routeCount: 10,
    description: 'Справочник филиалов и доступ пользователя к складам.',
    logic: ['Создаёт и обновляет филиалы.', 'Назначает активный склад пользователя.', 'Ограничивает операции разрешёнными филиалами.'],
    dependencies: ['Основная БД'],
  },
  {
    id: 'client-notifications',
    name: 'Уведомления клиентов',
    prefixes: ['/client-notifications'],
    routeCount: 7,
    description: 'Системные уведомления, отметки прочтения и пользовательские настройки доставки.',
    logic: ['Выдаёт ленту уведомлений.', 'Хранит статус прочтения.', 'Управляет каналами и предпочтениями клиента.'],
    dependencies: ['Основная БД', 'Telegram при настройке'],
  },
  {
    id: 'client-requests',
    name: 'Заявки клиентов',
    prefixes: ['/client-requests'],
    routeCount: 38,
    description: 'Онлайн-заявки, документы, маршруты сборки и управление заказами FBS.',
    logic: ['Создаёт и изменяет заявки.', 'Связывает заказы, короба, файлы и события.', 'Перестраивает маршруты и управляет проблемными заказами.'],
    dependencies: ['Основная БД', 'Склад', 'Подключения маркетплейсов'],
  },
  {
    id: 'clients',
    name: 'Клиенты',
    prefixes: ['/clients'],
    routeCount: 8,
    description: 'Карточки клиентов, реквизиты и правила складского обслуживания.',
    logic: ['Хранит юридические и контактные данные.', 'Настраивает режимы остатков и хранения.', 'Связывает клиента с менеджером и собственной компанией.'],
    dependencies: ['Основная БД'],
  },
  {
    id: 'contracts',
    name: 'Договоры',
    prefixes: ['/contracts'],
    routeCount: 12,
    description: 'Создание, проверка, загрузка и архивирование договорных документов.',
    logic: ['Формирует договор по реквизитам.', 'Сверяет изменения реквизитов.', 'Хранит подписанные файлы и дополнительные соглашения.'],
    dependencies: ['Основная БД', 'Файловое хранилище', 'DOCX/PDF'],
  },
  {
    id: 'expenses',
    name: 'Расходы',
    prefixes: ['/expenses'],
    routeCount: 16,
    description: 'Учёт расходов, категорий, статей и подтверждающих документов.',
    logic: ['Регистрирует расходы филиала.', 'Фильтрует операции по периоду и ответственным.', 'Формирует отчётность и вложения.'],
    dependencies: ['Основная БД', 'Файловое хранилище'],
  },
  {
    id: 'factory-shipments',
    name: 'Поставки фабрики',
    prefixes: ['/factory-shipments'],
    routeCount: 7,
    description: 'Планирование и контроль поставок от фабрики до склада.',
    logic: ['Создаёт поставку и её состав.', 'Отслеживает статусы движения.', 'Передаёт данные в складскую приёмку.'],
    dependencies: ['Основная БД', 'Склад'],
  },
  {
    id: 'imports',
    name: 'Импорт данных',
    prefixes: ['/imports'],
    routeCount: 6,
    description: 'Проверка и загрузка файлов с товарами и операционными данными.',
    logic: ['Разбирает входной файл без записи на этапе предпросмотра.', 'Показывает ошибки строк.', 'Сохраняет подтверждённый импорт идемпотентно.'],
    dependencies: ['Основная БД', 'XLSX/CSV'],
  },
  {
    id: 'integration-api',
    name: 'Интеграционный API WMS',
    prefixes: ['/integration-access', '/integration/v1'],
    routeCount: 12,
    description: 'Ключи доступа и защищённые методы для внешних систем клиентов.',
    logic: ['Выпускает и отзывает API-ключи.', 'Отдаёт остатки и справочники.', 'Принимает корректировки остатков с идемпотентностью и аудитом.'],
    dependencies: ['Основная БД', 'X-WMS-API-Key'],
  },
  {
    id: 'inventory',
    name: 'Инвентаризация',
    prefixes: ['/inventory'],
    routeCount: 14,
    description: 'Создание пересчётов, сканирование и безопасная актуализация остатков коробов.',
    logic: ['Фиксирует снимок ожидаемых остатков.', 'Сравнивает факт со снимком.', 'Применяет подтверждённые расхождения через движения склада.'],
    dependencies: ['Основная БД', 'Складские движения'],
  },
  {
    id: 'kiz-circulation',
    name: 'Погашение КИЗ',
    prefixes: ['/kiz-circulation'],
    routeCount: 10,
    description: 'Подготовка КИЗ к погашению, проверка Честного знака и возврат в оборот.',
    logic: ['Собирает КИЗ по отгрузкам маркетплейсов.', 'Хранит настройки OMS и подключения ЧЗ.', 'Записывает результат каждой операции и внешнего ответа.'],
    dependencies: ['Основная БД', 'Честный знак', 'Маркетплейсы'],
  },
  {
    id: 'kiz-issues',
    name: 'Проблемы КИЗ',
    prefixes: ['/kiz'],
    routeCount: 6,
    description: 'Поиск конфликтов КИЗ в приёмке, сборке и истории отгрузок.',
    logic: ['Находит дубли и незавершённые привязки.', 'Показывает доказательства конфликта.', 'Применяет только подтверждённое освобождение или перенос статуса.'],
    dependencies: ['Основная БД', 'Складские движения'],
  },
  {
    id: 'logistics',
    name: 'Логистика',
    prefixes: ['/logistics'],
    routeCount: 15,
    description: 'Маршруты, тарифы, заявки и расчёты логистических услуг.',
    logic: ['Хранит направления и тарифные сетки.', 'Рассчитывает стоимость маршрута.', 'Связывает перевозку с клиентом и филиалом.'],
    dependencies: ['Основная БД'],
  },
  {
    id: 'marketplace-connections',
    name: 'Маркетплейсы и FBS',
    prefixes: ['/marketplace-connections', '/marketplace-connection', '/external/v1/fbs'],
    // FIX: keep the internal API monitor in sync with the two FBS-penalty routes.
    routeCount: 94,
    description: 'Подключения WB/Ozon, заказы FBS, поставки, статусы, финансовые отчёты и распределение остатков.',
    logic: ['Синхронизирует кабинеты, склады и заказы.', 'Резервирует товар WMS и передаёт статусы сборки.', 'Получает финансовые штрафы FBS без передачи токена WB в браузер.', 'Рассчитывает и выгружает распределённые остатки по складам.'],
    dependencies: ['Основная БД', 'WB API', 'Ozon API'],
  },
  {
    id: 'mobile',
    name: 'Мобильное приложение',
    prefixes: ['/mobile'],
    routeCount: 17,
    description: 'Сессии мобильных устройств, команды, синхронизация и автономные операции.',
    logic: ['Регистрирует устройство и сессию.', 'Передаёт команды и получает результаты.', 'Защищает повторные запросы идемпотентностью.'],
    dependencies: ['Основная БД', 'JWT устройства'],
  },
  {
    id: 'own-companies',
    name: 'Собственные компании',
    prefixes: ['/own-companies'],
    routeCount: 6,
    description: 'Реквизиты юридических лиц исполнителя для договоров и счетов.',
    logic: ['Хранит компании и банковские реквизиты.', 'Назначает компанию по умолчанию.', 'Использует реквизиты в документах клиентов.'],
    dependencies: ['Основная БД'],
  },
  {
    id: 'ozon-fbo',
    name: 'Ozon FBO',
    prefixes: ['/ozon-fbo'],
    routeCount: 19,
    description: 'Заявки и операции поставок Ozon по схеме FBO.',
    logic: ['Получает и хранит поставки Ozon.', 'Собирает состав и упаковочные данные.', 'Контролирует статусы подготовки и отгрузки.'],
    dependencies: ['Основная БД', 'Ozon API', 'Склад'],
  },
  {
    id: 'print',
    name: 'Печать',
    prefixes: ['/print'],
    routeCount: 16,
    description: 'Очереди печати, шаблоны, принтеры и повторная печать этикеток.',
    logic: ['Формирует задания печати.', 'Маршрутизирует задание в группу принтеров.', 'Хранит статус, ошибки и историю повторов.'],
    dependencies: ['Основная БД', 'Принтеры/агент печати'],
  },
  {
    id: 'service',
    name: 'Сервисный центр',
    prefixes: ['/service'],
    routeCount: 15,
    description: 'Сервисные обращения, диагностика и история ремонтных работ.',
    logic: ['Регистрирует обращение и устройство.', 'Ведёт этапы диагностики и ремонта.', 'Хранит исполнителей, комментарии и результат.'],
    dependencies: ['Основная БД'],
  },
  {
    id: 'skus',
    name: 'Товары и SKU',
    prefixes: ['/skus'],
    routeCount: 16,
    description: 'Карточки товаров, штрихкоды, характеристики и связи маркетплейсов.',
    logic: ['Создаёт и обновляет SKU.', 'Управляет штрихкодами и заменой ошибочного ШК.', 'Связывает товар с артикулом и идентификатором маркетплейса.'],
    dependencies: ['Основная БД'],
  },
  {
    id: 'stock',
    name: 'Остатки',
    prefixes: ['/stock'],
    routeCount: 23,
    description: 'Доступные, резервные и физические остатки WMS и их движения.',
    logic: ['Считает остаток по коробу, SKU, клиенту и филиалу.', 'Создаёт движения при приёмке, резерве и отгрузке.', 'Формирует отчёты и сверки остатков.'],
    dependencies: ['Основная БД', 'Складские движения'],
  },
  {
    id: 'tsd',
    name: 'ТСД',
    prefixes: ['/tsd'],
    routeCount: 71,
    description: 'Приёмка, размещение, сборка FBS, перемещения и синхронизация ТСД.',
    logic: ['Выдаёт следующее действие сборщику.', 'Проверяет паллет-сорт, короб, товар и КИЗ.', 'Фиксирует сканы, операции и восстановление сессий устройства.'],
    dependencies: ['Основная БД', 'Склад', 'JWT устройства'],
  },
  {
    id: 'turnover',
    name: 'Товарооборот',
    prefixes: ['/turnover'],
    routeCount: 15,
    description: 'История движения товара и отчёты по операциям, КИЗ и отгрузкам.',
    logic: ['Объединяет приёмку, перемещения, резерв и отгрузку.', 'Фильтрует историю по товару, клиенту и периоду.', 'Формирует выгружаемые отчёты.'],
    dependencies: ['Основная БД', 'Складские движения'],
  },
  {
    id: 'users',
    name: 'Пользователи и права',
    prefixes: ['/users'],
    routeCount: 9,
    description: 'Учетные записи, роли, права и доступ к филиалам.',
    logic: ['Создаёт и блокирует пользователей.', 'Назначает роли и разрешения.', 'Ограничивает клиентские и складские области доступа.'],
    dependencies: ['Основная БД'],
  },
  {
    id: 'warehouse',
    name: 'Склад и размещение',
    prefixes: ['/warehouse', '/warehouse/storage-locations'],
    routeCount: 39,
    description: 'Короба, паллет-сорты, зоны, ячейки и физическое размещение товара.',
    logic: ['Создаёт и изменяет складские места.', 'Размещает и перемещает короба.', 'Показывает содержимое и актуальную иерархию хранения.'],
    dependencies: ['Основная БД', 'Складские движения'],
  },
  {
    id: 'wms-ai',
    name: 'WMS AI',
    prefixes: ['/wms-ai'],
    routeCount: 3,
    description: 'Внутренний помощник для анализа WMS на основании разрешённых данных.',
    logic: ['Принимает диагностический запрос.', 'Собирает безопасный контекст WMS.', 'Возвращает объяснение без прямого изменения склада.'],
    dependencies: ['Основная БД', 'Настроенная AI-модель'],
  },
]);

@Injectable()
export class AdministrationInternalApiService {
  private restartScheduled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ADDED: This is a bounded readiness check, not request instrumentation.
  async overview(user: AuthUser) {
    const databaseStartedAt = Date.now();
    let databaseStatus: 'WORKING' | 'ERROR' = 'WORKING';
    let databaseMessage = 'Основная БД отвечает.';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      databaseStatus = 'ERROR';
      // FIX: Do not expose a connection string or database host through a raw driver error.
      databaseMessage = 'Основная БД не ответила. Проверьте журнал API на сервере.';
    }

    const databaseLatencyMs = Date.now() - databaseStartedAt;
    const modules = INTERNAL_API_DEFINITIONS.map((definition) => {
      const requiresDatabase = definition.requiresDatabase !== false;
      const status = requiresDatabase && databaseStatus === 'ERROR' ? 'DEGRADED' : 'WORKING';

      return {
        ...definition,
        status,
        statusText: status === 'WORKING'
          ? 'Маршруты загружены, базовая проверка пройдена.'
          : 'Маршруты загружены, но основная БД недоступна.',
      };
    });
    const canRestart = this.canRestart(user);

    return {
      checkedAt: new Date().toISOString(),
      scopeNote: 'Статус подтверждает загрузку маршрутов и доступность основной БД. Внешние WB, Ozon, ЧЗ, принтеры и AI проверяются в профильных разделах.',
      summary: {
        modules: modules.length,
        routes: modules.reduce((sum, module) => sum + module.routeCount, 0),
        working: modules.filter((module) => module.status === 'WORKING').length,
        degraded: modules.filter((module) => module.status === 'DEGRADED').length,
      },
      runtime: {
        status: 'WORKING' as const,
        uptimeSeconds: Math.floor(process.uptime()),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV ?? 'development',
      },
      dependencies: {
        database: {
          status: databaseStatus,
          latencyMs: databaseLatencyMs,
          message: databaseMessage,
        },
      },
      restart: {
        enabled: this.restartEnabled(),
        scheduled: this.restartScheduled,
        canRestart,
        confirmation: INTERNAL_API_RESTART_CONFIRMATION,
        disabledReason: this.restartDisabledReason(user),
      },
      modules,
    };
  }

  // ADDED: The API exits only after audit persistence and the HTTP response has time to leave.
  async restart(body: { confirmation?: string }, user: AuthUser) {
    if (!user.permissionCodes.includes('system:admin')) {
      throw new ForbiddenException('Перезапуск API доступен только системному администратору.');
    }
    if (!this.restartEnabled()) {
      throw new ServiceUnavailableException('Самоперезапуск API отключён настройкой API_SELF_RESTART_ENABLED.');
    }
    if (body.confirmation !== INTERNAL_API_RESTART_CONFIRMATION) {
      throw new BadRequestException(`Введите точную фразу: ${INTERNAL_API_RESTART_CONFIRMATION}`);
    }
    if (process.uptime() < 30) {
      throw new ConflictException('API был запущен менее 30 секунд назад. Дождитесь завершения запуска.');
    }
    if (this.restartScheduled) {
      throw new ConflictException('Перезапуск API уже запланирован.');
    }

    this.restartScheduled = true;
    try {
      await this.auditLog.write({
        userId: user.id,
        action: 'administration.internal-api.restart',
        entity: 'SystemApi',
        entityId: 'api',
        payload: {
          requestedAt: new Date().toISOString(),
          userEmail: user.email,
          uptimeSeconds: Math.floor(process.uptime()),
        },
      });
    } catch (error) {
      this.restartScheduled = false;
      throw error;
    }

    const acceptedAt = new Date().toISOString();
    setTimeout(() => process.exit(0), 1_500).unref();

    return {
      accepted: true,
      acceptedAt,
      message: 'Команда принята. API-контейнер завершит процесс и будет поднят политикой Docker restart: unless-stopped.',
    };
  }

  private restartEnabled() {
    return process.env.API_SELF_RESTART_ENABLED?.trim().toLowerCase() === 'true';
  }

  private canRestart(user: AuthUser) {
    return user.permissionCodes.includes('system:admin')
      && this.restartEnabled()
      && process.uptime() >= 30
      && !this.restartScheduled;
  }

  private restartDisabledReason(user: AuthUser) {
    if (!user.permissionCodes.includes('system:admin')) return 'Недостаточно прав system:admin.';
    if (!this.restartEnabled()) return 'Включите API_SELF_RESTART_ENABLED=true на сервере.';
    if (process.uptime() < 30) return 'API ещё завершает запуск.';
    if (this.restartScheduled) return 'Перезапуск уже выполняется.';
    return null;
  }
}
