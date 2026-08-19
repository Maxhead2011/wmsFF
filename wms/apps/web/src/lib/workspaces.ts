import {
  BriefcaseBusiness,
  BarChart3,
  Building2,
  Boxes,
  Bug,
  Calculator,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Crown,
  Database,
  FolderCog,
  FileSignature,
  HandCoins,
  LayoutDashboard,
  KeyRound,
  MapPinned,
  MessageSquareMore,
  MonitorUp,
  PackageCheck,
  PackageSearch,
  Printer,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  ShoppingBasket,
  Settings2,
  Tags,
  Truck,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AuthUser } from './api';

export type WorkspaceId =
  | 'overview'
  | 'ai'
  | 'cabinet'
  | 'analytics'
  | 'branches'
  | 'access'
  | 'integration-api'
  | 'directories'
  | 'imports'
  | 'logistics'
  | 'warehouse'
  | 'storage-zones'
  | 'inventory'
  | 'kiz'
  | 'turnover'
  | 'requests'
  | 'contracts'
  | 'fbs'
  | 'factory'
  | 'fbs-packed'
  | 'order-assembly'
  | 'monitoring'
  | 'dbs'
  | 'fbo-ozon'
  | 'relabeling'
  | 'catalog'
  | 'billing'
  | 'expenses'
  | 'services'
  | 'own-companies'
  | 'print'
  | 'service'
  | 'debug'
  | 'data'
  | 'administration';

export type WorkspaceNavItem = {
  id: WorkspaceId;
  title: string;
  eyebrow: string;
  description: string;
  permissions: string[];
  permissionMode?: 'any' | 'all';
  icon: LucideIcon;
  status: 'ready' | 'in-progress' | 'planned';
  audience?: 'all' | 'internal' | 'client';
  requiresAnalyticsAccess?: boolean;
  requiresRelabelingAccess?: boolean;
  requiresAdministrationAccess?: boolean;
};

export const workspaceNav: WorkspaceNavItem[] = [
  {
    id: 'overview',
    title: 'Обзор',
    eyebrow: 'Рабочий стол',
    description: 'Быстрый переход к доступным рабочим зонам WMS.',
    permissions: [],
    icon: LayoutDashboard,
    status: 'ready',
    audience: 'all',
  },
  {
    id: 'cabinet',
    title: 'Кабинет',
    eyebrow: 'Клиент',
    description: 'Остатки, заявки, счета и начисления по доступным клиентам.',
    permissions: ['stock:read', 'client-requests:read', 'billing:read'],
    permissionMode: 'all',
    icon: BriefcaseBusiness,
    status: 'in-progress',
    audience: 'client',
  },
  {
    id: 'access',
    title: 'Доступы',
    eyebrow: 'Администрирование',
    description: 'Пользователи, роли, клиентские scope и ТСД-устройства.',
    permissions: ['users:read', 'users:write'],
    permissionMode: 'all',
    icon: ShieldCheck,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'integration-api',
    title: 'API WMS',
    eyebrow: 'Внешние системы',
    description: 'Документация, выпуск, замена и отзыв изолированных API-ключей клиента.',
    permissions: ['integration-api:manage'],
    icon: KeyRound,
    status: 'ready',
    audience: 'all',
  },
  {
    id: 'directories',
    title: 'Справочники',
    eyebrow: 'Клиенты и SKU',
    description: 'Клиенты, товары, штрихкоды, габариты и литраж.',
    permissions: ['clients:write', 'skus:write'],
    icon: FolderCog,
    status: 'in-progress',
    audience: 'internal',
  },
  {
    id: 'warehouse',
    title: 'Склад',
    eyebrow: 'Операции',
    description: 'Короба, перемещения и текущая складская работа.',
    permissions: ['warehouse:read', 'warehouse:write', 'stock:write'],
    icon: Boxes,
    status: 'in-progress',
    audience: 'internal',
  },
  {
    id: 'ai',
    title: 'ИИ',
    eyebrow: 'Локальный WMS-ассистент',
    description: 'Чат для анализа проблем WMS, поиска аномалий, Excel-выгрузок и накопления подтверждённых решений.',
    permissions: ['warehouse:read', 'stock:read'],
    permissionMode: 'all',
    icon: MessageSquareMore,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'branches',
    title: 'Филиалы',
    eyebrow: 'Города и подразделения',
    description: 'Отдельные ФФ, их ИП, менеджеры, остатки и межгородские перемещения клиентов.',
    permissions: ['warehouse:read', 'stock:read'],
    permissionMode: 'all',
    icon: MapPinned,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'storage-zones',
    title: 'Зоны хранения',
    eyebrow: 'Адресное размещение',
    description: 'Зоны, паллет-сорт и фактическое размещение коробов на складе.',
    permissions: ['warehouse:read', 'warehouse:write'],
    permissionMode: 'all',
    icon: MapPinned,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'inventory',
    title: 'Инвентаризация',
    eyebrow: 'Складской контроль',
    description: 'Полная и частичная инвентаризация, проверка коробов и актуализация расхождений.',
    permissions: ['stock:read', 'stock:write'],
    permissionMode: 'all',
    icon: ClipboardCheck,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'kiz',
    title: 'КИЗ',
    eyebrow: 'Контроль маркировки',
    description:
      'Очередь проблемных КИЗ после FBS-отбора, исправление данных WMS и повторная синхронизация с Wildberries.',
    permissions: ['system:admin'],
    icon: ScanLine,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'turnover',
    title: 'Товарооборот',
    eyebrow: 'Движение товаров',
    description: 'История товара от приемки до списания, ручные действия и статистика по штрихкодам.',
    permissions: ['stock:read'],
    icon: RefreshCw,
    status: 'in-progress',
    audience: 'all',
  },
  {
    id: 'requests',
    title: 'Заявки',
    eyebrow: 'Клиентский контур',
    description: 'Заявки клиентов, статусы и операционный процесс.',
    permissions: ['client-requests:read', 'client-requests:write', 'client-requests:status'],
    icon: ClipboardList,
    status: 'in-progress',
    audience: 'all',
  },
  {
    id: 'contracts',
    title: 'Договоры',
    eyebrow: 'Клиентский контур',
    description: 'Создание, хранение и скачивание договоров, подписанных экземпляров и дополнительных соглашений.',
    permissions: [],
    icon: FileSignature,
    status: 'ready',
    audience: 'all',
  },
  {
    id: 'fbs',
    title: 'FBS',
    eyebrow: 'Клиентский контур',
    description: 'Заказы FBS, отгрузки, стоимость обработки и архив.',
    permissions: [],
    icon: ShoppingBasket,
    status: 'in-progress',
    audience: 'client',
  },
  {
    id: 'factory',
    title: 'Фабрика',
    eyebrow: 'Товар в пути',
    description: 'Предварительные отправки с производства и сверка с фактической приёмкой.',
    permissions: ['factory-shipments:read', 'factory-shipments:write'],
    icon: Truck,
    status: 'ready',
    audience: 'all',
  },
  {
    id: 'order-assembly',
    title: 'Сборка заказов',
    eyebrow: 'WB · потоковая печать',
    description: 'Сканирование КИЗ, поиск заказа и печать уникального WB-стикера.',
    permissions: ['stock:write'],
    icon: ScanLine,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'fbs-packed',
    title: 'Упаковка FBS',
    eyebrow: 'Контроль ТСД',
    description: 'Журнал всех товаров, собранных на ТСД: заказ, заявка, КИЗ, короб, палетсорт, стикер и сотрудник.',
    permissions: ['stock:read'],
    icon: PackageCheck,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'monitoring',
    title: 'Мониторинг',
    eyebrow: 'Диспетчерская ТСД',
    description: 'Живой экран всех ТСД: сотрудники, текущие заявки, прогресс сборки и история ошибок.',
    permissions: ['system:admin', 'administration:demo'],
    icon: MonitorUp,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'dbs',
    title: 'DBS',
    eyebrow: 'Доставка силами продавца',
    description: 'Заказы DBS Wildberries, Ozon и Яндекс Маркета в отдельных рабочих контурах.',
    permissions: [],
    icon: Truck,
    status: 'in-progress',
    audience: 'client',
  },
  {
    id: 'fbo-ozon',
    title: 'FBO Ozon',
    eyebrow: 'Поставки на склады Ozon',
    description: 'Импорт распределения из Excel, слоты, короба WMS, сборка и передача поставки в Ozon.',
    permissions: [],
    icon: Boxes,
    status: 'ready',
    audience: 'client',
  },
  {
    id: 'relabeling',
    title: 'Переклейка',
    eyebrow: 'Клиентский контур',
    description: 'Таблица соответствий исходного товара и товара, который должен уехать после переклейки.',
    permissions: ['skus:read'],
    icon: Tags,
    status: 'ready',
    audience: 'all',
    requiresRelabelingAccess: true,
  },
  {
    id: 'analytics',
    title: 'Аналитика',
    eyebrow: 'Клиентский контур',
    description: 'Продажи и воронка WB, остатки на маркетплейсе и в LOGOFF, дефицит, неликвид и рекомендации.',
    permissions: [],
    icon: BarChart3,
    status: 'ready',
    audience: 'client',
    requiresAnalyticsAccess: true,
  },
  {
    id: 'catalog',
    title: 'Каталог',
    eyebrow: 'Товары',
    description: 'Товары клиентов, фото, характеристики, габариты и синхронизация с маркетплейсами.',
    permissions: ['skus:read'],
    icon: PackageSearch,
    status: 'in-progress',
    audience: 'all',
  },
  {
    id: 'imports',
    title: 'Импорт',
    eyebrow: 'XLSX',
    description: 'Загрузка остатков и тарифов через предварительную проверку.',
    permissions: ['imports:write'],
    icon: Upload,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'logistics',
    title: 'Логистика',
    eyebrow: 'Тарифы',
    description: 'Расчет доставки по направлениям и наборам тарифов.',
    permissions: ['logistics:read', 'logistics:write'],
    icon: Truck,
    status: 'ready',
    audience: 'all',
  },
  {
    id: 'services',
    title: 'Услуги',
    eyebrow: 'Цены клиентов',
    description: 'Подключение услуг клиенту, индивидуальные цены и учет налога.',
    permissions: ['billing:write'],
    icon: HandCoins,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'billing',
    title: 'Биллинг',
    eyebrow: 'Финансы',
    description: 'Услуги, хранение, начисления, счета и оплаты.',
    permissions: ['billing:read', 'billing:write'],
    icon: Calculator,
    status: 'in-progress',
    audience: 'all',
  },
  {
    id: 'expenses',
    title: 'Расходы',
    eyebrow: 'Управленческий учёт',
    description: 'Расходные материалы, логистика, ФОТ, ПРР, отдельные работы, отчёты и задолженность клиентов.',
    permissions: ['expenses:read'],
    icon: CircleDollarSign,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'own-companies',
    title: 'Собственные компании',
    eyebrow: 'Реквизиты',
    description: 'Юрлица, расчетные счета и реквизиты для счетов и актов.',
    permissions: ['own-companies:read'],
    icon: Building2,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'print',
    title: 'Печать',
    eyebrow: 'Этикетки',
    description: 'Предпросмотр TSPL для коробов и подготовка печатных потоков.',
    permissions: ['print:write'],
    icon: Printer,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'administration',
    title: 'Администрирование',
    eyebrow: 'Режим владельца',
    description: 'Единый центр системных настроек, префиксов, API, интерфейса, ИИ, алгоритмов и аудита.',
    permissions: ['system:admin'],
    icon: Crown,
    status: 'ready',
    audience: 'internal',
    requiresAdministrationAccess: true,
  },
  {
    id: 'service',
    title: 'Сервис',
    eyebrow: 'Система',
    description: 'Опасные операции владельца и администратора: очистка остатков клиента и системное обслуживание.',
    permissions: ['system:admin'],
    icon: Settings2,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'debug',
    title: 'Отладка',
    eyebrow: 'Контроль',
    description: 'Быстрое редактирование клиентов, пользователей, операторов и служебных параметров БД.',
    permissions: ['system:admin'],
    icon: Bug,
    status: 'ready',
    audience: 'internal',
  },
  {
    id: 'data',
    title: 'Данные',
    eyebrow: 'Контроль',
    description: 'Таблицы остатков, клиентов, SKU и очередь разбора ТСД.',
    permissions: ['clients:read', 'skus:read', 'stock:read'],
    icon: Database,
    status: 'ready',
    audience: 'internal',
  },
];

export function canOpenWorkspace(user: AuthUser, item: WorkspaceNavItem) {
  if (user.workspaceVisibility?.[item.id] === false) {
    return false;
  }
  if (item.requiresAdministrationAccess && !user.administrationEnabled) {
    return false;
  }
  if (item.requiresAnalyticsAccess && !user.analyticsEnabled) {
    return false;
  }
  if (item.requiresRelabelingAccess && !user.relabelingEnabled) {
    return false;
  }

  if (isClientOnlyUser(user) && item.audience === 'internal') {
    return false;
  }

  if (item.permissions.length === 0 || user.permissionCodes.includes('system:admin')) {
    return true;
  }

  if (item.permissionMode === 'all') {
    return item.permissions.every((permission) => user.permissionCodes.includes(permission));
  }

  return item.permissions.some((permission) => user.permissionCodes.includes(permission));
}

function isClientOnlyUser(user: AuthUser) {
  const internalRoles = ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR'];
  return user.roleCodes.includes('CLIENT') && !user.roleCodes.some((roleCode) => internalRoles.includes(roleCode));
}
