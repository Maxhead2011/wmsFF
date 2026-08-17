export type AuthUser = {
  id: string;
  email: string;
  name: string;
  isDemo?: boolean;
  analyticsEnabled?: boolean;
  relabelingEnabled?: boolean;
  administrationEnabled?: boolean;
  workspaceVisibility?: Record<string, boolean>;
  roleCodes: string[];
  permissionCodes: string[];
  clientScopeMode: 'ALL' | 'LIMITED';
  clientIds: string[];
  writableClientIds: string[];
  activeWarehouseId?: string | null;
  warehouseIds?: string[];
  writableWarehouseIds?: string[];
  hiddenClientIds?: string[];
  printerGroups?: UserPrinterGroupScope[];
  deviceId?: string;
  deviceCode?: string;
};

export type UserPrinterGroupScope = {
  groupCode: string;
  canPrint: boolean;
  canManage: boolean;
};

export type TokenPayload = {
  sub: string;
  deviceId?: string;
  deviceCode?: string;
  iat: number;
  exp: number;
};
