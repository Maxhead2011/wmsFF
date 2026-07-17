import {
  BriefcaseBusiness,
  Building2,
  Boxes,
  Bug,
  Calculator,
  ClipboardList,
  Database,
  FolderCog,
  HandCoins,
  LayoutDashboard,
  PackageSearch,
  Printer,
  RefreshCw,
  ShieldCheck,
  Settings2,
  Truck,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AuthUser } from './api';

export type WorkspaceId =
  | 'overview'
  | 'cabinet'
  | 'access'
  | 'directories'
  | 'imports'
  | 'logistics'
  | 'warehouse'
  | 'turnover'
  | 'requests'
  | 'catalog'
  | 'billing'
  | 'services'
  | 'own-companies'
  | 'print'
  | 'service'
  | 'debug'
  | 'data';

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
    icon: ShieldCheck,
    status: 'ready',
    audience: 'internal',
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
    id: 'turnover',
    title: 'ТОВАРООБОРОТ',
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
    id: 'own-companies',
    title: 'Собственные компании',
    eyebrow: 'Реквизиты',
    description: 'Юрлица, расчетные счета и реквизиты для счетов и актов.',
    permissions: ['billing:write'],
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
