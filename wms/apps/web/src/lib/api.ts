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
  printerGroups?: UserPrinterScope[];
};

export type AuthSession = {
  accessToken: string;
  tokenType: 'Bearer';
  user: AuthUser;
};

export type ClientSummary = {
  id: string;
  ownCompanyId?: string | null;
  ownCompany?: {
    id: string;
    shortName: string;
    fullName: string;
    inn: string;
    isDefault: boolean;
    isActive: boolean;
  } | null;
  code: string;
  name: string;
  clientKind: ClientKind;
  legalName: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  actualAddress: string | null;
  phone: string | null;
  telegramChatId?: string | null;
  email: string | null;
  bankName: string | null;
  bankBik: string | null;
  bankAccount: string | null;
  correspondentAccount: string | null;
  storageAccountingEnabled: boolean;
  storagePriceRubPerLiterDay: string | number | null;
  logisticsInvoiceMode: ClientLogisticsInvoiceMode;
  storageBillingMode: ClientStorageBillingMode;
  storesWithoutBoxes?: boolean;
  stockBalanceMode?: ClientStockBalanceMode;
  onlineReceiptVisibleToClient?: boolean;
  fbsCalculatorEnabled?: boolean;
  relabelingEnabled?: boolean;
  factoryEnabled?: boolean;
  factoryName?: string;
  factoryCode?: string;
  fulfillmentManagerUserId: string | null;
  fulfillmentManager: {
    id: string;
    email: string;
    name: string;
  } | null;
  status: ClientStatus;
  createdAt: string;
};

export type ClientKind = 'LEGAL_ENTITY' | 'INDIVIDUAL_ENTREPRENEUR' | 'SELF_EMPLOYED' | 'INDIVIDUAL';

export type ClientStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export type ClientStockBalanceMode = 'PALLET_SORT' | 'BOXES';

export type ContractClientOption = {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  inn: string | null;
  suggestedLogin: string;
};

export type ClientContractAttachmentSummary = {
  id: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  uploadedBy: { id: string; name: string; email: string } | null;
};

export type ClientContractSummary = {
  id: string;
  number: string;
  clientId: string;
  contractDate: string;
  fileName: string;
  fileSize: number;
  wmsUrl: string;
  wmsLogin: string;
  signedFileName: string | null;
  signedFileSize: number | null;
  signedUploadedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  status: 'AWAITING_SIGNATURE' | 'SIGNED';
  client: { id: string; code: string; name: string; legalName: string | null };
  createdBy: { id: string; name: string; email: string } | null;
  signedUploadedBy: { id: string; name: string; email: string } | null;
  attachments: ClientContractAttachmentSummary[];
};

export type CreateClientContractPayload = {
  clientId: string;
  contractDate?: string;
  contractNumber?: string;
  wmsUrl?: string;
  wmsLogin: string;
  wmsPassword: string;
};

export type ClientContractRequisiteChange = {
  party: 'CLIENT' | 'EXECUTOR';
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
};

export type ClientContractRequisitesCheck = {
  contractId: string;
  contractNumber: string;
  checkedAt: string;
  upToDate: boolean;
  signedFilePresent: boolean;
  signedFileWillBePreserved: boolean;
  fingerprint: string;
  changes: ClientContractRequisiteChange[];
};

export type RefreshClientContractRequisitesResult = {
  contract: ClientContractSummary;
  appliedChanges: ClientContractRequisiteChange[];
  signedFilePreserved: boolean;
};

export type InventorySessionType = 'FULL' | 'PARTIAL' | 'BOX_CHECK';
export type InventorySessionStatus = 'ACTIVE' | 'REVIEW' | 'COMPLETED' | 'CANCELLED';
export type InventoryBoxStatus = 'COUNTING' | 'MATCHED' | 'MISMATCH' | 'RESOLVED';
export type InventoryLineDecision = 'PENDING' | 'APPLY_ACTUAL' | 'KEEP_SYSTEM';
export type InventoryResolutionAction = 'APPLY_ACTUAL' | 'DELETE_FROM_BOX' | 'ACCEPT_AS_IS' | 'LEAVE_FOR_LATER';

export type InventoryAuditLine = {
  id: string;
  skuId: string;
  skuName: string;
  internalSku: string;
  barcode: string | null;
  expectedQuantity: number;
  countedQuantity: number;
  difference: number;
  decision: InventoryLineDecision;
  resolutionAction?: InventoryResolutionAction;
  decisionComment: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
};

export type AnalyticsClientSummary = {
  id: string;
  code: string;
  name: string;
  connection: {
    connected: boolean;
    marketplace: string;
    accountName: string | null;
    lastVerifiedAt: string | null;
  };
  sync: {
    status: string;
    periodDays: number;
    productCount: number;
    lastSyncedAt: string | null;
    lastError: string | null;
  } | null;
};

export type AnalyticsProduct = {
  clientId: string;
  nmId: string;
  name: string;
  vendorCode: string | null;
  brandName: string | null;
  subjectName: string | null;
  photoUrl: string | null;
  availability: string | null;
  stockCount: number;
  stockSum: number;
  avgOrders: number;
  ordersCount: number;
  ordersSum: number;
  buyoutCount: number;
  buyoutSum: number;
  buyoutPercent: number;
  lostOrdersCount: number;
  lostOrdersSum: number;
  lostBuyoutsCount: number;
  lostBuyoutsSum: number;
  turnoverDays: number | null;
  saleRateDays: number | null;
  currentPriceMin: number | null;
  currentPriceMax: number | null;
  openCount: number;
  cartCount: number;
  orderCount: number;
  orderSum: number;
  funnelBuyoutCount: number;
  funnelBuyoutSum: number;
  cancelCount: number;
  cancelSum: number;
  addToCartPercent: number;
  cartToOrderPercent: number;
  funnelBuyoutPercent: number;
  orderCountDynamic: number;
  orderSumDynamic: number;
  openCountDynamic: number;
  cartCountDynamic: number;
  syncedAt: string;
  wmsStock: number;
  wmsSkuCount: number;
};

export type AnalyticsDashboard = {
  generatedAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  access: {
    analyticsEnabled: boolean;
    canManageConnection: boolean;
    canSync: boolean;
  };
  connection: AnalyticsClientSummary['connection'];
  sync: {
    status: string;
    periodDays: number;
    currency: string;
    productCount: number;
    lastStartedAt: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
    sourceStatus: unknown;
  } | null;
  totals: {
    products: number;
    activeProducts: number;
    wbStock: number;
    wmsStock: number;
    wmsMatchedStock: number;
    wmsUnlinkedStock: number;
    wmsMatchPercent: number;
    orders: number;
    ordersSum: number;
    buyouts: number;
    buyoutsSum: number;
    buyoutPercent: number;
    lostOrdersSum: number;
    outOfStock: number;
    lowStock: number;
    overstock: number;
  };
  recommendations: Array<{
    nmId: string;
    name: string;
    vendorCode: string | null;
    photoUrl: string | null;
    kind: string;
    severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'POSITIVE';
    value: number;
    message: string;
  }>;
  regionalAnalytics: {
    available: boolean;
    periodDays: number;
    targetDays: number;
    demandSource: 'REGIONAL_SALES' | 'WB_SALE_RATE';
    dynamicsAvailable: boolean;
    productActionsAvailable: boolean;
    exactProductWarehouseStockAvailable: boolean;
    limitation: string;
    summary: {
      regions: number;
      shortageRegions: number;
      recommendedSupply: number;
      excessStock: number;
      salesQty: number;
      salesAmount: number;
    };
    regions: Array<{
      regionName: string;
      salesQty: number;
      salesAmount: number;
      pastSalesQty: number;
      salesDynamicPercent: number;
      salesSharePercent: number;
      stockCount: number;
      stockSharePercent: number;
      coverageDays: number | null;
      wbSaleRateDays: number | null;
      targetStock: number;
      recommendedSupply: number;
      excessStock: number;
      toClientCount: number;
      fromClientCount: number;
      estimatedLostSales: number;
      topWarehouse: string | null;
      topWarehouseStock: number;
      status: 'CRITICAL' | 'SHORTAGE' | 'OVERSTOCK' | 'BALANCED' | 'NO_DEMAND' | 'NO_DATA';
    }>;
    productActions: Array<{
      nmId: string;
      name: string;
      vendorCode: string | null;
      photoUrl: string | null;
      regionName: string;
      salesQty: number;
      pastSalesQty: number;
      salesDynamicPercent: number;
      demandSharePercent: number;
      estimatedRegionStock: number;
      targetRegionStock: number;
      gap: number;
      wmsStock: number;
      recommendedQty: number;
      uncoveredQty: number;
      confidence: 'ESTIMATE';
      reason: string;
    }>;
  };
  products: {
    total: number;
    limit: number;
    offset: number;
    items: AnalyticsProduct[];
  };
  regions: Array<{
    regionName: string;
    officeId: string | null;
    officeName: string | null;
    stockCount: number;
    stockSum: number;
    toClientCount: number;
    fromClientCount: number;
    saleRateDays: number | null;
  }>;
  history: Array<{
    date: string;
    periodDays: number;
    productCount: number;
    stockCount: number;
    stockSum: number;
    ordersCount: number;
    ordersSum: number;
    buyoutCount: number;
    buyoutSum: number;
    lostOrdersSum: number;
  }>;
};

export type InventoryAuditBox = {
  id: string;
  sessionId: string;
  boxId: string;
  boxCode: string;
  clientId: string;
  clientName: string;
  status: InventoryBoxStatus;
  countedByName: string | null;
  startedAt: string;
  completedAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  lines: InventoryAuditLine[];
};

export type InventorySession = {
  id: string;
  type: InventorySessionType;
  status: InventorySessionStatus;
  clientId: string | null;
  title: string;
  comment: string | null;
  createdByName: string;
  completedByName: string | null;
  startedAt: string;
  completedAt: string | null;
  boxes: InventoryAuditBox[];
  progress?: {
    totalBoxes: number | null;
    checkedBoxes: number;
    mismatchBoxes: number;
    unresolvedLines: number;
  };
};

export type InventoryBoxRescanRequest = {
  id: string;
  boxId: string;
  boxCode: string;
  clientId: string;
  clientName: string;
  sessionId: string;
  sessionTitle: string;
  requestedByUserId: string;
  requestedByName: string;
  status: 'PENDING' | 'APPROVED' | 'CONSUMED';
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryDashboard = {
  movementLock: {
    active: boolean;
    sessionId?: string;
    title?: string;
    startedAt?: string;
    createdByName?: string;
  };
  activeFull: InventorySession | null;
  activeSessions: InventorySession[];
  reviewSessions: InventorySession[];
  historySessions: InventorySession[];
  pendingRescanRequests: InventoryBoxRescanRequest[];
  canApproveRescan: boolean;
  canManage: boolean;
};

export type ClientLogisticsInvoiceMode = 'SEPARATE' | 'SAME_INVOICE' | 'DISABLED';

export type ClientStorageBillingMode = 'MONTHLY' | 'ON_SHIPMENT';

export type MarketplaceType = 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET' | 'SBER_MARKET' | 'OTHER';

export type ClientRequestType = 'INBOUND' | 'OUTBOUND' | 'RETURN' | 'DELIVERY' | 'SERVICE' | 'SKU_COLLECTION' | 'OTHER';

// FIX: expose only the DTOs required by the isolated SKU collection panel.
export type SkuCollectionCandidate = {
  id: string;
  internalSku: string;
  clientSku: string | null;
  article: string | null;
  name: string;
  color: string | null;
  size: string | null;
  needsChestnyZnak: boolean;
  barcodes: string[];
  availableQuantity: number;
  boxes: Array<{ id: string; code: string; palletCode: string | null; quantity: number }>;
};

export type SkuCollectionRequest = ClientRequestSummary & {
  skuCollectionSources: Array<{
    id: string;
    sourceBoxCode: string;
    plannedQuantity: number;
    pickedQuantity: number;
    receivedQuantity: number;
  }>;
};

export type ClientRequestStatus =
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'IN_WORK'
  | 'PACKED'
  | 'DONE'
  | 'CANCELLED'
  | 'REJECTED';

export type PickWaveStatus =
  | 'PLANNED'
  | 'BALANCE_REVIEW'
  | 'FROZEN'
  | 'PICKING'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED';

export type PickWaveBalanceReviewStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'NOT_REQUIRED';

export type PickWaveRequestStatus = 'PLANNED' | 'PICKED' | 'FAILED';

export type ClientRequestPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type ClientRequestEventType = 'CREATED' | 'STATUS_CHANGED' | 'COMMENT' | 'FILE_UPLOADED';

export type ClientNotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export type ClientNotificationEvent =
  | 'REQUEST_COMMENT'
  | 'REQUEST_STATUS_CHANGED'
  | 'REQUEST_FILE_UPLOADED'
  | 'BILLING_INVOICE_STATUS_CHANGED'
  | 'BILLING_PAYMENT_RECORDED'
  | 'LOGISTICS_DELIVERY_STATUS_CHANGED'
  | 'SKU_EXPIRATION'
  | 'MANUAL';

export type BillingUnit = 'SERVICE' | 'PIECE' | 'BOX' | 'PALLET' | 'LITER' | 'LITER_DAY' | 'DAY' | 'HOUR';

export type BillingChargeStatus = 'DRAFT' | 'APPROVED' | 'CANCELLED';

export type BillingChargeSource = 'MANUAL' | 'STORAGE' | 'LOGISTICS';

export type BillingInvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED';

export type BillingInvoiceSource = 'MANUAL' | 'REQUEST_DONE' | 'LOGISTICS';

export type BillingPaymentStatus = 'RECORDED' | 'CANCELLED';

export type BillingPriceTaxMode = 'INCLUDED' | 'ADD_6_PERCENT';

export type BillingServiceSummary = {
  id: string;
  code: string;
  name: string;
  unit: BillingUnit;
  defaultPriceRub: string | number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ClientBillingServiceSummary = {
  id: string | null;
  clientId: string;
  service: BillingServiceSummary;
  priceRub: string | number | null;
  taxMode: BillingPriceTaxMode;
  isActive: boolean;
  comment: string | null;
};

export type BillingChargeSummary = {
  id: string;
  clientId: string;
  serviceId: string | null;
  requestId: string | null;
  description: string;
  unit: BillingUnit;
  quantity: string | number;
  unitPriceRub: string | number;
  totalRub: string | number;
  status: BillingChargeStatus;
  serviceDate: string;
  source: BillingChargeSource;
  sourceKey: string | null;
  metadata: Record<string, unknown> | null;
  comment: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  service: BillingServiceSummary | null;
  request: Pick<ClientRequestSummary, 'id' | 'title' | 'type' | 'status'> | null;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  approvedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type BillingServiceHistoryGroup = {
  key: string;
  clientId: string;
  serviceId: string | null;
  serviceCode: string;
  serviceName: string;
  source: BillingChargeSource;
  unit: BillingUnit;
  chargesCount: number;
  quantity: number;
  totalRub: number;
  draftRub: number;
  approvedRub: number;
  cancelledRub: number;
  firstServiceDate: string;
  lastServiceDate: string;
  latestStatus: BillingChargeStatus;
  charges: BillingChargeSummary[];
};

export type BillingServiceHistory = {
  periodFrom: string | null;
  periodTo: string | null;
  generatedAt: string;
  totals: {
    chargesCount: number;
    totalRub: number;
    draftRub: number;
    approvedRub: number;
    cancelledRub: number;
  };
  groups: BillingServiceHistoryGroup[];
};

export type BillingReconciliationInvoice = {
  id: string;
  number: string;
  status: BillingInvoiceStatus;
  periodFrom: string;
  periodTo: string;
  dueDate: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  totalRub: number;
  paidRub: number;
  remainingRub: number;
  overdueDays: number;
};

export type BillingReconciliationClient = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  invoicesCount: number;
  openInvoicesCount: number;
  paidInvoicesCount: number;
  overdueInvoicesCount: number;
  totalRub: number;
  paidRub: number;
  grossDebtRub: number;
  advanceRub: number;
  debtRub: number;
  creditRub: number;
  grossOverdueRub: number;
  overdueRub: number;
  nearestDueDate: string | null;
  latestInvoiceDate: string | null;
  invoices: BillingReconciliationInvoice[];
};

export type BillingReconciliation = {
  periodFrom: string | null;
  periodTo: string | null;
  generatedAt: string;
  totals: {
    invoicesCount: number;
    openInvoicesCount: number;
    paidInvoicesCount: number;
    overdueInvoicesCount: number;
    totalRub: number;
    paidRub: number;
    grossDebtRub: number;
    advanceRub: number;
    debtRub: number;
    creditRub: number;
    grossOverdueRub: number;
    overdueRub: number;
  };
  clients: BillingReconciliationClient[];
};

export type ExpenseCategory =
  | 'MATERIALS'
  | 'LOGISTICS'
  | 'PAYROLL_PICKERS'
  | 'HANDLING_PPR'
  | 'CONTRACT_WORK'
  | 'RENT'
  | 'UTILITIES'
  | 'TAXES'
  | 'SOFTWARE'
  | 'EQUIPMENT'
  | 'MARKETING'
  | 'OTHER';

export type ExpenseEntry = {
  id: string;
  category: ExpenseCategory;
  source:
    | 'MANUAL'
    | 'MATERIAL_PURCHASE'
    | 'AUTO_MATERIAL_CONSUMPTION'
    | 'MATERIAL_WRITE_OFF'
    | 'LOGISTICS';
  status: 'ACTIVE' | 'CANCELLED';
  expenseDate: string;
  amountRub: number;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPriceRub: number | null;
  workerName: string | null;
  sourceKey: string | null;
  comment: string | null;
  client: { id: string; code: string; name: string } | null;
  request: { id: string; number: number; title: string } | null;
  material: { id: string; code: string; name: string; unit: string } | null;
  createdBy: { id: string; name: string; email: string } | null;
  cancelledBy: { id: string; name: string; email: string } | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseMaterial = {
  id: string;
  code: string;
  name: string;
  unit: string;
  stockQuantity: number;
  averageUnitCostRub: number;
  stockValueRub: number;
  minStockQuantity: number;
  isLowStock: boolean;
  isActive: boolean;
  comment: string | null;
  rulesCount: number;
  movementsCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseMaterialMovement = {
  id: string;
  type: 'INITIAL' | 'PURCHASE' | 'CONSUMPTION' | 'ADJUSTMENT' | 'WRITE_OFF';
  quantity: number;
  unitCostRub: number | null;
  comment: string | null;
  client: { id: string; code: string; name: string } | null;
  request: { id: string; number: number; title: string } | null;
  createdBy: { id: string; name: string; email: string } | null;
  createdAt: string;
};

export type ClientExpenseMaterialRules = {
  client: { id: string; code: string; name: string };
  materials: Array<{
    material: ExpenseMaterial;
    isEnabled: boolean;
    quantityPerShippedUnit: number;
    chargeSeparately: boolean;
    billingUnitPriceRub: number | null;
    comment: string | null;
    updatedAt: string | null;
  }>;
};

export type ExpensePayrollReport = {
  period: { dateFrom: string; dateTo: string; from: string; to: string };
  defaultRateRub: number;
  summary: { users: number; activeWorkers: number; orders: number; units: number; productiveDurationSeconds: number; payrollRub: number };
  workers: Array<{
    userId: string; userName: string; email: string; status: string; deviceCodes: string[];
    orders: number; units: number; measuredOrders: number; workStartedAt: string | null; workEndedAt: string | null;
    workSpanSeconds: number | null; productiveDurationSeconds: number; averageDurationSecondsPerOrder: number | null;
    averageDurationSecondsPerUnit: number | null; rateRub: number; rateIsDefault: boolean; rateUpdatedAt: string | null;
    resetAt: string | null; payrollRub: number;
  }>;
  generatedAt: string;
};

export type ExpenseReport = {
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  totals: {
    totalRub: number;
    entriesCount: number;
    linkedToClientsRub: number;
    overheadRub: number;
    materialsRub: number;
    logisticsRub: number;
    payrollPickersRub: number;
    handlingPprRub: number;
    contractWorkRub: number;
  };
  byCategory: Array<{
    category: ExpenseCategory;
    amountRub: number;
    entriesCount: number;
  }>;
  byClient: Array<{
    client: { id: string; code: string; name: string } | null;
    amountRub: number;
    entriesCount: number;
  }>;
  byWorker: Array<{
    workerName: string;
    totalRub: number;
    payrollPickersRub: number;
    handlingPprRub: number;
    contractWorkRub: number;
    entriesCount: number;
  }>;
  daily: Array<{ date: string; amountRub: number }>;
  entries: ExpenseEntry[];
};

export type ExpenseDebtReport = Omit<BillingReconciliation, 'clients'> & {
  clients: Array<
    Omit<BillingReconciliationClient, 'invoices'> & {
      invoices: Array<
        BillingReconciliationInvoice & {
          comment: string | null;
          items: Array<{
            id: string;
            description: string;
            unit: BillingUnit;
            quantity: number;
            unitPriceRub: number;
            totalRub: number;
            serviceDate: string;
          }>;
        }
      >;
    }
  >;
};

export type BillingInvoiceItemSummary = {
  id: string;
  invoiceId: string;
  chargeId: string | null;
  description: string;
  unit: BillingUnit;
  quantity: string | number;
  unitPriceRub: string | number;
  totalRub: string | number;
  serviceDate: string;
  charge:
    | (Pick<BillingChargeSummary, 'id' | 'serviceId' | 'description' | 'status'> & {
        sourceKey: string | null;
        metadata: unknown | null;
      })
    | null;
};

export type BillingPaymentSummary = {
  id: string;
  invoiceId: string | null;
  clientId: string;
  amountRub: string | number;
  paidAt: string;
  method: string | null;
  reference: string | null;
  comment: string | null;
  status: BillingPaymentStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingInvoiceSummary = {
  id: string;
  number: string;
  clientId: string;
  periodFrom: string;
  periodTo: string;
  dueDate: string | null;
  status: BillingInvoiceStatus;
  source: BillingInvoiceSource;
  sourceKey: string | null;
  requestId: string | null;
  totalRub: string | number;
  paidRub: string | number;
  issuedAt: string | null;
  paidAt: string | null;
  comment: string | null;
  paymentBankAccountId: string | null;
  paymentBankName: string | null;
  paymentBankBik: string | null;
  paymentBankInn: string | null;
  paymentBankKpp: string | null;
  paymentBankAccount: string | null;
  paymentCorrespondentAccount: string | null;
  createdAt: string;
  updatedAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  items: BillingInvoiceItemSummary[];
  payments: BillingPaymentSummary[];
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type BillingInvoiceRecheckResult = {
  invoiceId: string;
  number: string;
  checkedAt: string;
  status: 'OK' | 'WARNING' | 'ERROR';
  kind: 'FBS' | 'STANDARD';
  summary: {
    invoiceItems: number;
    serviceRows: number;
    zeroCostRows: number;
    invoiceTotalRub: number;
    calculatedTotalRub: number;
    unbilledCharges: number;
    fbsOrders: number;
    fbsItems: number;
    fbsPrimaryRows: number;
    fbsPrimaryQuantity: number;
    fbsLogisticsRows: number;
  };
  checks: Array<{
    code: string;
    label: string;
    status: 'OK' | 'WARNING' | 'ERROR';
    message: string;
  }>;
  actions: {
    addPrimaryProcessing: {
      available: boolean;
      reason: string | null;
    };
  };
  unbilledServices: Array<{
    chargeId: string;
    serviceCode: string | null;
    name: string;
    description: string;
    quantity: number;
    unitPriceRub: number;
    totalRub: number;
  }>;
};

export type FbsInvoiceMergePreview = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  draftInvoices: number;
  sourceInvoiceNumbers: string[];
  existingMergedInvoiceId: string | null;
  processingTotalRub: number;
  primaryProcessing: {
    available: boolean;
    included: boolean;
    invoices: number;
    shipments: number;
    itemCount: number;
    totalRub: number;
  };
  orders: Array<{
    orderId: string;
    itemCount: number;
    date: string;
  }>;
  logisticsDays: Array<{
    date: string;
    shipments: number;
    orders: number;
    itemCount: number;
    currentAmountRub: number | null;
    suggestedAmountRub: number;
  }>;
};

export type MergeFbsInvoicesPayload = {
  clientId: string;
  invoiceIds?: string[];
  includePrimaryProcessing?: boolean;
  aggregateSameItems?: boolean;
  excludeZeroTotalItems?: boolean;
  logisticsDays: Array<{
    date: string;
    amountRub: number;
  }>;
};

export type MergeBillingInvoicesPayload = {
  invoiceIds: string[];
  aggregateSameItems?: boolean;
  excludeZeroTotalItems?: boolean;
};

export type BillingAdvanceEntry = BillingPaymentSummary & {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type BillingAdvanceClientSummary = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  balanceRub: number;
  recordedCount: number;
  cancelledCount: number;
  latestPaidAt: string | null;
};

export type BillingAdvancesOverview = {
  totalBalanceRub: number;
  clients: BillingAdvanceClientSummary[];
  entries: BillingAdvanceEntry[];
};

export type IssueRequestBillingInvoicesResult = {
  requestId: string;
  status: 'ISSUED' | 'DRAFT_REVIEW';
  issuedCount: number;
  invoices: BillingInvoiceSummary[];
};

export type BillingInvoiceDocument = {
  invoiceId: string;
  number: string;
  documentKind?: 'invoice' | 'act';
  actNumber?: string;
  title: string;
  fileName: string;
  status: BillingInvoiceStatus;
  statusLabel: string;
  periodFrom: string;
  periodTo: string;
  dueDate: string | null;
  issuedAt: string | null;
  totalRub: number;
  paidRub: number;
  remainingRub: number;
  comment: string | null;
  seller: OwnCompanySellerSnapshot;
  client: {
    id: string;
    code: string;
    name: string;
    legalName: string | null;
    inn: string | null;
    kpp: string | null;
    ogrn: string | null;
    legalAddress: string | null;
    actualAddress: string | null;
    email: string | null;
    phone: string | null;
    bankName: string | null;
    bankBik: string | null;
    bankAccount: string | null;
    correspondentAccount: string | null;
  };
  rows: Array<{
    position: number;
    description: string;
    unit: BillingUnit;
    quantity: number;
    unitPriceRub: number;
    totalRub: number;
    serviceDate: string;
  }>;
  payments: Array<{
    id: string;
    amountRub: number;
    paidAt: string;
    method: string | null;
    reference: string | null;
    comment: string | null;
  }>;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  html: string;
};

export type ClientRequestDocument = {
  requestId: string;
  requestNumber: number;
  title: string;
  fileName: string;
  type: ClientRequestType;
  typeLabel: string;
  status: ClientRequestStatus;
  statusLabel: string;
  priority: ClientRequestPriority;
  priorityLabel: string;
  createdAt: string;
  updatedAt: string;
  desiredDate: string | null;
  comment: string | null;
  managerComment: string | null;
  contactName: string | null;
  contactPhone: string | null;
  destinationCity: string | null;
  deliveryAddress: string | null;
  rowsCount: number;
  totalQuantity: number;
  client: {
    id: string;
    code: string;
    name: string;
    inn: string | null;
    kpp: string | null;
    legalAddress: string | null;
    actualAddress: string | null;
    email: string | null;
    phone: string | null;
  };
  rows: Array<{
    position: number;
    skuId: string | null;
    internalSku: string | null;
    clientSku: string | null;
    article: string | null;
    barcode: string | null;
    name: string | null;
    quantity: number;
    comment: string | null;
  }>;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    name: string;
  } | null;
  html: string;
};

export type CreateBillingServicePayload = {
  code: string;
  name: string;
  unit?: BillingUnit;
  defaultPriceRub?: number;
  isActive?: boolean;
};

export type CreateBillingChargePayload = {
  clientId: string;
  serviceId?: string;
  requestId?: string;
  description?: string;
  unit?: BillingUnit;
  quantity: number;
  unitPriceRub?: number;
  serviceDate?: string;
  comment?: string;
};

export type CreateBillingInvoicePayload = {
  clientId: string;
  periodFrom: string;
  periodTo: string;
  dueDate?: string;
  chargeIds?: string[];
  comment?: string;
  paymentBankAccountId?: string;
};

export type UpsertClientBillingServicePayload = {
  serviceId: string;
  priceRub: number;
  taxMode?: BillingPriceTaxMode;
  isActive?: boolean;
  comment?: string;
};

export type UpsertOwnCompanyPayload = {
  warehouseId?: string | null;
  shortName: string;
  fullName: string;
  inn: string;
  kpp?: string;
  ogrn?: string;
  legalAddress?: string;
  bankName?: string;
  bankBik?: string;
  bankAccount?: string;
  correspondentAccount?: string;
  paymentCode?: string;
  paymentPurposeCode?: string;
  isDefault?: boolean;
  isActive?: boolean;
  comment?: string;
  bankAccounts?: Array<{
    id?: string;
    bankName: string;
    bankBik: string;
    bankInn?: string;
    bankKpp?: string;
    bankAccount: string;
    correspondentAccount?: string;
    isDefault?: boolean;
    comment?: string;
  }>;
};

export type CreateManualBillingInvoiceLinePayload = {
  invoiceItemId?: string;
  serviceId?: string;
  description?: string;
  unit?: BillingUnit;
  quantity: number;
  unitPriceRub?: number;
  taxMode?: BillingPriceTaxMode;
  serviceDate?: string;
  comment?: string;
};

export type CreateManualBillingInvoicePayload = {
  clientId: string;
  requestId?: string;
  periodFrom: string;
  periodTo: string;
  dueDate?: string;
  rows: CreateManualBillingInvoiceLinePayload[];
  comment?: string;
  paymentBankAccountId?: string;
};

export type GenerateStorageChargePayload = {
  clientId: string;
  periodFrom: string;
  periodTo: string;
  unitPriceRub?: number;
  serviceDate?: string;
  approve?: boolean;
  comment?: string;
};

export type CreateBillingPaymentPayload = {
  invoiceId: string;
  amountRub: number;
  paidAt?: string;
  method?: string;
  reference?: string;
  comment?: string;
};

export type ClientRequestItem = {
  id: string;
  requestId: string;
  skuId: string | null;
  barcode: string | null;
  name: string | null;
  quantity: number;
  comment: string | null;
  sku: {
    id: string;
    internalSku: string;
    name: string;
    clientSku: string | null;
    article: string | null;
    color: string | null;
    size: string | null;
  } | null;
};

export type CreateBillingAdvancePayload = {
  clientId: string;
  amountRub: number;
  paidAt?: string;
  method?: string;
  reference?: string;
  comment?: string;
};

export type CreateIncomingPaymentPayload = {
  clientId: string;
  totalRub: number;
  allocations: Array<{ invoiceId: string; amountRub: number }>;
  paidAt?: string;
  method?: string;
  reference?: string;
  comment?: string;
};

export type IncomingPaymentResult = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  totalRub: number;
  paidAt: string;
  invoices: BillingInvoiceSummary[];
};

export type OwnCompanySellerSnapshot = {
  shortName: string;
  fullName: string;
  inn: string;
  kpp: string;
  address: string;
  bankName: string;
  bankBik: string;
  bankAccount: string;
  correspondentAccount: string;
  paymentCode: string;
  paymentPurposeCode: string;
  stampDataUrl: string | null;
  signatureDataUrl: string | null;
};

export type OwnCompanyBankAccountSummary = {
  id: string;
  companyId: string;
  bankName: string;
  bankBik: string;
  bankInn: string | null;
  bankKpp: string | null;
  bankAccount: string;
  correspondentAccount: string | null;
  isDefault: boolean;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OwnCompanySummary = {
  id: string;
  warehouseId: string | null;
  shortName: string;
  fullName: string;
  inn: string;
  kpp: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  bankName: string | null;
  bankBik: string | null;
  bankAccount: string | null;
  correspondentAccount: string | null;
  paymentCode: string | null;
  paymentPurposeCode: string | null;
  isDefault: boolean;
  isActive: boolean;
  comment: string | null;
  stampFileName: string | null;
  stampMimeType: string | null;
  signatureFileName: string | null;
  signatureMimeType: string | null;
  hasStamp: boolean;
  hasSignature: boolean;
  bankAccounts: OwnCompanyBankAccountSummary[];
  createdAt: string;
  updatedAt: string;
};

export type ClientRequestFileSummary = {
  id: string;
  requestId: string;
  clientId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string | null;
  createdAt: string;
  uploadedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type ClientNotificationSummary = {
  id: string;
  clientId: string;
  requestId: string | null;
  title: string;
  body: string | null;
  severity: ClientNotificationSeverity;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  request: Pick<ClientRequestSummary, 'id' | 'title' | 'type' | 'status'> | null;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type ClientNotificationPreferenceSummary = {
  id: string | null;
  clientId: string;
  eventType: ClientNotificationEvent;
  isEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  updatedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type ClientRequestCommentSummary = {
  id: string;
  requestId: string;
  clientId: string;
  authorUserId: string | null;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type ClientRequestEventSummary = {
  id: string;
  requestId: string;
  clientId: string;
  eventType: ClientRequestEventType;
  title: string;
  body: string | null;
  statusFrom: ClientRequestStatus | null;
  statusTo: ClientRequestStatus | null;
  createdByUserId: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type ClientRequestTimeline = {
  request: {
    id: string;
    number: number;
    clientId: string;
    title: string;
    type: ClientRequestType;
    status: ClientRequestStatus;
    createdAt: string;
    client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  };
  comments: ClientRequestCommentSummary[];
  events: ClientRequestEventSummary[];
};

export type ClientRequestSummary = {
  id: string;
  number: number;
  clientId: string;
  type: ClientRequestType;
  status: ClientRequestStatus;
  priority: ClientRequestPriority;
  title: string;
  comment: string | null;
  contactName: string | null;
  contactPhone: string | null;
  destinationCity: string | null;
  deliveryAddress: string | null;
  desiredDate: string | null;
  managerComment: string | null;
  createdAt: string;
  updatedAt: string;
  // FIX: existing server flag also marks local-only FBS delivery recovery.
  fbsEmergencyAssemblyAt?: string | null;
  fbsEmergencyAssemblyByName?: string | null;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'> & {
    storesWithoutBoxes?: boolean;
  };
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    name: string;
  } | null;
  items: ClientRequestItem[];
  files: ClientRequestFileSummary[];
  packages: ClientRequestPackage[];
  _count?: {
    fbsOrderLinks: number;
  };
  // ADDED: WB supply numbers are returned for shipped requests, including archived ones.
  wbSupplyIds?: string[];
  fbsCompletion?: {
    totalOrders: number;
    completedOrders: number;
    percent: number;
    completed: boolean;
  };
};

export type ClientRequestManualBoxSelection = {
  request: {
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
    clientId: string;
  };
  editable: boolean;
  summary: {
    items: number;
    requestedQuantity: number;
    selectedQuantity: number;
  };
  items: Array<{
    requestItemId: string;
    requestedQuantity: number;
    selectedQuantity: number;
    sku: {
      id: string;
      internalSku: string;
      article: string | null;
      name: string;
      barcodes: string[];
    } | null;
    requestedBarcode: string | null;
    requestedName: string | null;
    itemComment: string | null;
    fbsOrders: Array<{
      orderId: string;
      assemblyStatus: string;
      sourceBoxPending: boolean;
      boxCode: string | null;
      barcode: string | null;
      stickerPartB: string | null;
      wbStatus: string | null;
    }>;
    boxes: Array<{
      boxId: string;
      boxCode: string;
      boxStatus: string;
      availableQuantity: number;
      selectedQuantity: number;
      statuses: Array<{ status: string; quantity: number }>;
    }>;
  }>;
};

export type RequisitesDocumentFields = {
  clientKind: ClientKind;
  shortName: string;
  fullName: string;
  name: string;
  legalName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  bankName: string;
  bankBik: string;
  bankInn: string | null;
  bankKpp: string | null;
  bankAccount: string;
  correspondentAccount: string;
};

export type RequisitesDocumentResult = {
  fileName: string;
  sourceType: 'PDF' | 'EXCEL';
  fields: RequisitesDocumentFields;
  recognizedFields: string[];
  warnings: string[];
};

export type ClientRequestFbsBoxSearch = {
  stockMode: 'BOXES' | 'WITHOUT_BOXES';
  request: {
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
    client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  };
  summary: {
    boxes: number;
    orders: number;
    confirmedOrders: number;
    unmatchedOrders: number;
  };
  warehouseStock: Array<{
    requestItemId: string;
    skuId: string;
    productName: string;
    article: string | null;
    barcodes: string[];
    requestedQuantity: number;
    availableQuantity: number;
    reservedQuantity: number;
    freeQuantity: number;
    orderIds: string[];
    reservedOrderIds: string[];
  }>;
  boxes: Array<{
    boxId: string;
    boxCode: string;
    boxStatus: string;
    orderIds: string[];
    confirmedOrderIds: string[];
    candidateOrderIds: string[];
    items: Array<{
      requestItemId: string;
      skuId: string;
      productName: string;
      article: string | null;
      barcodes: string[];
      requestedQuantity: number;
      availableQuantity: number;
      freeQuantity: number;
      orderIds: string[];
      confirmedOrderIds: string[];
      candidateOrderIds: string[];
    }>;
  }>;
  unmatchedOrderIds: string[];
};

export type ClientRequestBoxOverlapStatistics = {
  generatedAt: string;
  activeRequestsCount: number;
  checkedRequestsCount: number;
  requestsWithOverlapsCount: number;
  overlappingBoxesCount: number;
  statusCounts: Array<{ status: ClientRequestStatus; count: number }>;
  overlaps: Array<{
    boxCode: string;
    clientId: string;
    client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
    requests: Array<{
      id: string;
      number: number;
      title: string;
      status: ClientRequestStatus;
      destinationCity: string | null;
      createdAt: string;
    }>;
  }>;
  errors: Array<{ requestId: string; title: string; message: string }>;
};

export type EmergencyPackedXlsxResult = {
  status: 'APPLIED' | 'ALREADY_APPLIED';
  requestId: string;
  boxes: number;
  pallets: number;
  packedUnits: number;
  rows: number;
  wbFilesReady?: boolean;
  shortageQuantity: number;
  excessQuantity: number;
  warnings: Array<{
    code: 'SHORTAGE' | 'RELABEL_DIFFERENCE' | 'EXCESS' | 'UNLISTED_ITEM' | 'EMPTY_BOX';
    message: string;
    quantity: number;
    boxCode?: string;
    skuId?: string;
    barcode?: string | null;
  }>;
  packages?: Array<{
    packageCode: string;
    packageType: string;
    items: Array<{ requestItemId: string; quantity: number }>;
  }>;
};

export type EmergencyPackedXlsxRollbackResult = {
  status: 'REVERSED';
  requestId: string;
  restoredStatus: ClientRequestStatus;
  restoredBoxes: number;
  restoredUnits: number;
  removedPackages: number;
  restoredPackages: number;
  removedAutoItems: number;
  removedInvoices: number;
  removedDeliveryRequests: number;
  removedBillingCharges: number;
};

export type OutboundRequestXlsxIssue = {
  row: number;
  barcode?: string;
  message: string;
  severity: 'warning' | 'error';
};

export type OutboundRequestActionSuggestion = {
  type: 'RELABEL' | 'CREATE_SKU';
  title: string;
  message: string;
  sourceSkuId?: string;
  sourceInternalSku?: string;
  sourceName?: string;
  sourceBarcode?: string;
  targetBarcode?: string;
  availableQuantity?: number;
  quantity?: number;
};

export type OutboundRequestXlsxLine = {
  barcode?: string;
  originalName?: string;
  requestedQuantity: number;
  relabelTargetBarcode?: string;
  relabelQuantity?: number;
  city?: string;
  artSeller?: string;
  size?: string;
  needsRelabel?: boolean;
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
  sourceRows: number[];
  skuId: string | null;
  internalSku: string | null;
  name: string | null;
  canFulfill: boolean;
  conflicts: ClientRequestAvailabilityConflict[];
  actionSuggestions: OutboundRequestActionSuggestion[];
};

export type OutboundRequestRelabelSourceOption = {
  skuId: string;
  internalSku: string;
  clientSku?: string | null;
  article?: string | null;
  name: string;
  barcode?: string | null;
  size?: string | null;
  availableQuantity: number;
};

export type OutboundRequestXlsxPreview = {
  clientId: string;
  title: string;
  canCommit: boolean;
  summary: {
    sourceRows: number;
    lines: number;
    totalQuantity: number;
    availableQuantity: number;
    shortageQuantity: number;
  };
  issues: OutboundRequestXlsxIssue[];
  relabelSourceOptions: OutboundRequestRelabelSourceOption[];
  lines: OutboundRequestXlsxLine[];
};

export type CommitOutboundRequestXlsxResult = {
  request: ClientRequestSummary;
  preview: OutboundRequestXlsxPreview;
};

export type ClientRequestAvailabilityConflict = {
  requestId: string;
  title: string;
  type: ClientRequestType;
  status: ClientRequestStatus;
  createdAt: string;
  desiredDate: string | null;
  quantity: number;
};

export type ClientRequestAvailabilityLine = {
  index: number;
  skuId: string | null;
  internalSku: string | null;
  name: string | null;
  barcode: string | null;
  requestedQuantity: number;
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
  canFulfill: boolean;
  conflicts: ClientRequestAvailabilityConflict[];
};

export type ClientRequestAvailabilityPreview = {
  clientId: string;
  type: ClientRequestType;
  canCommit: boolean;
  summary: {
    lines: number;
    requestedQuantity: number;
    stockQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
    shortageQuantity: number;
    conflictsCount: number;
  };
  lines: ClientRequestAvailabilityLine[];
};

export type ClientRequestPackageItem = {
  id: string;
  packageId: string;
  requestItemId: string;
  skuId: string | null;
  barcode: string | null;
  quantity: number;
  requestItem: Pick<ClientRequestItem, 'id' | 'barcode' | 'name' | 'quantity'> & {
    sku: {
      id: string;
      internalSku: string;
      name: string;
    } | null;
  };
  sku: {
    id: string;
    internalSku: string;
    name: string;
  } | null;
};

export type ClientRequestPackage = {
  id: string;
  requestId: string;
  clientId: string;
  packageCode: string;
  packageType: string | null;
  weightGrams: number | null;
  lengthCm: string | number | null;
  widthCm: string | number | null;
  heightCm: string | number | null;
  comment: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  items: ClientRequestPackageItem[];
};

export type PickWaveRequestSummary = {
  waveId: string;
  requestId: string;
  status: PickWaveRequestStatus;
  result: Record<string, unknown> | null;
  pickedAt: string | null;
  request: Pick<ClientRequestSummary, 'id' | 'clientId' | 'title' | 'type' | 'status' | 'priority' | 'items'> & {
    client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  };
};

export type PickWaveSummary = {
  id: string;
  waveNumber: string;
  status: PickWaveStatus;
  comment: string | null;
  createdByUserId: string | null;
  assignedPickerUserId: string | null;
  planVersion: number;
  planGeneratedAt: string | null;
  planFrozenAt: string | null;
  balanceReviewStatus: PickWaveBalanceReviewStatus;
  balanceReviewSubmittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  assignedPicker: {
    id: string;
    email: string;
    name: string;
  } | null;
  requests: PickWaveRequestSummary[];
  balanceLines: Array<{
    id: string;
    isReviewed: boolean;
    remainingQuantity: number;
  }>;
};

export type PickWaveBalanceReviewAllocation = {
  id: string;
  requestId: string;
  quantity: number;
  needsRelabel: boolean;
  targetBarcode: string | null;
  comment: string | null;
};

export type ClientFbsTurnkeyPricing = {
  clientId: string;
  enabled: boolean;
  unitPriceRub: number;
  fixedPlusLogisticsEnabled: boolean;
  fixedPlusLogisticsUnitPriceRub: number;
  fixedPlusLogisticsDestination: string;
  tieredLogisticsEnabled: boolean;
  logisticsFreeItemsLimit: number;
  logisticsCubicMeterLiters: number;
  logisticsCubicMeterPriceRub: number;
  logisticsPalletPriceRub: number;
  primaryProcessingEnabled: boolean;
  primaryWhiteUnitPriceRub: number;
  primaryGrayUnitPriceRub: number;
  primaryReturnUnitPriceRub: number;
  primaryServices: Array<{
    serviceId: string;
    quantityMultiplier: number;
    matchKeywords: string;
  }>;
  recalculation?: {
    recalculatedCharges: number;
    recalculatedInvoices: number;
  };
  updatedByUserId?: string;
};

export type PickWaveBalanceReview = {
  id: string;
  waveNumber: string;
  status: PickWaveStatus;
  balanceReviewStatus: PickWaveBalanceReviewStatus;
  planVersion: number;
  planGeneratedAt: string | null;
  planFrozenAt: string | null;
  createdAt: string;
  updatedAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'> | null;
  requests: Array<{
    id: string;
    title: string;
    status: ClientRequestStatus;
    destinationCity: string | null;
  }>;
  summary: {
    lines: number;
    reviewedLines: number;
    pendingLines: number;
    totalRemaining: number;
    allocatedQuantity: number;
    keepQuantity: number;
    smallBalanceLines: number;
  };
  lines: Array<{
    id: string;
    balanceId: string;
    sourceBoxCode: string;
    skuId: string;
    internalSku: string;
    barcode: string | null;
    name: string;
    color: string | null;
    size: string | null;
    originalQuantity: number;
    plannedQuantity: number;
    remainingQuantity: number;
    keepQuantity: number | null;
    isReviewed: boolean;
    isSmallBalance: boolean;
    comment: string | null;
    allocations: PickWaveBalanceReviewAllocation[];
  }>;
};

export type PickWaveBalanceDecisionInput = {
  lineId: string;
  keepQuantity: number;
  comment?: string;
  allocations: Array<{
    requestId: string;
    quantity: number;
    needsRelabel?: boolean;
    targetBarcode?: string;
    comment?: string;
  }>;
};

export type PickWaveRunResult = {
  wave: PickWaveSummary;
  results: Array<{
    requestId: string;
    status: string;
    message?: string;
  }>;
};

export type PickWaveDocument = {
  waveId: string;
  waveNumber: string;
  title: string;
  fileName: string;
  status: PickWaveStatus;
  statusLabel: string;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  generatedAt: string;
  assignedPicker: {
    id: string;
    email: string;
    name: string;
  } | null;
  requestsCount: number;
  rowsCount: number;
  totalRequested: number;
  totalPicked: number;
  rows: Array<{
    position: number;
    requestId: string;
    requestTitle: string;
    requestStatus: string;
    waveRequestStatus: PickWaveRequestStatus;
    clientCode: string;
    clientName: string;
    itemId: string;
    skuId: string | null;
    internalSku: string | null;
    name: string | null;
    barcode: string | null;
    requestedQuantity: number;
    pickedQuantity: number;
    allocations: Array<{
      boxId: string | null;
      boxCode: string | null;
      palletId: string | null;
      palletCode: string | null;
      quantity: number;
      source: 'planned' | 'picked';
    }>;
  }>;
  html: string;
};

export type PickInstructionDocument = {
  requestId: string;
  title: string;
  fileName: string;
  requestTitle: string;
  requestStatus: ClientRequestStatus;
  requestStatusLabel: string;
  priority: ClientRequestPriority;
  priorityLabel: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  generatedAt: string;
  desiredDate: string | null;
  destinationCity: string | null;
  deliveryAddress: string | null;
  totalRequested: number;
  totalAllocated: number;
  totalShortage: number;
  rowsCount: number;
  readyRowsCount: number;
  shortageRowsCount: number;
  boxesCount: number;
  fullBoxesCount: number;
  instructionSource: 'AUTOMATIC' | 'MANUAL';
  manualInstructionFileName: string | null;
  manualInstructionUploadedAt: string | null;
  html: string;
  rows?: Array<{
    position: number;
    itemId: string;
    skuId: string | null;
    internalSku: string | null;
    name: string | null;
    barcode: string | null;
    requestedQuantity: number;
    allocatedQuantity: number;
    shortageQuantity: number;
    status: string;
    statusLabel: string;
    comment: string | null;
    allocations: Array<{
      balanceId: string;
      boxId: string;
      boxCode: string;
      palletId: string | null;
      palletCode: string | null;
      quantity: number;
    }>;
  }>;
  boxes?: Array<{
    boxId: string;
    boxCode: string;
    palletId: string | null;
    palletCode: string | null;
    allocatedQuantity: number;
    availableQuantity: number;
    linesCount: number;
    isFullBox: boolean;
    comment: string;
  }>;
  warehouseRows?: Array<{
    city: string;
    sourceBox: string;
    targetBox: string;
    pallet: string;
    artOnBox: string;
    barcodeOnBox: string;
    size: string;
    quantity: number;
    comment: string;
    rebrandNote: string;
    note: string;
  }>;
  warehouseWholeBoxes?: Array<{
    box: string;
    status: string;
    city: string;
    pallet: string;
    balanceBox: string;
  }>;
  warehouseBalanceMoves?: Array<{
    sourceBox: string;
    newBox: string;
    pallet: string;
    artOnBox: string;
    barcodeOnBox: string;
    size: string;
    quantity: number;
    note: string;
  }>;
  warehouseBalanceLabels?: Array<{
    newBox: string;
    sourceBox: string;
    tspl: string;
  }>;
  warehouseMarkRows?: Array<{
    comment: string;
    city: string;
    sourceBox: string;
    brand: string;
    ip: string;
    name: string;
    article: string;
    wbArticle: string;
    color: string;
    size: string;
    barcode: string;
    quantity: number;
  }>;
};

export type TsdAssemblyPlan = {
  id: string;
  requestId: string;
  title: string;
  name: string;
  status: ClientRequestStatus;
  statusLabel?: string;
  destinationCity: string | null;
  city: string | null;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  rowsCount: number;
  totalRequested?: number;
  totalQuantity?: number;
  boxesTotal?: number;
  boxesCount?: number;
  foundCount?: number;
  remainingCount?: number;
  activeTsdProcess?: {
    stage?: string;
    stageLabel?: string;
    deviceCode?: string;
    workerName?: string | null;
    updatedAt?: string;
    foundCount?: number;
    totalBoxCount?: number;
    progressText?: string;
  } | null;
  relabelTotal?: number;
  movementTotal?: number;
  movementRequiredTotal?: number;
  searchBoxes?: Array<{
    boxCode?: string;
    code?: string;
    found?: boolean;
    isFound?: boolean;
    servesMultipleCities?: boolean;
    multiCityLabel?: string;
    storageLocation?: {
      palletId: string;
      palletCode: string;
      zoneId: string | null;
      zoneCode: string | null;
      zoneName: string | null;
    } | null;
  }>;
  shipmentBoxes?: Array<{ boxCode?: string; code?: string; found?: boolean; isFound?: boolean }>;
  outgoingBoxes?: Array<{
    boxCode?: string;
    code?: string;
    type?: string;
    typeLabel?: string;
    sourceBox?: string;
    quantity?: number;
    status?: string;
    city?: string | null;
    pallet?: string | null;
  }>;
  shipmentBoxCodes?: string[];
  outgoingBoxCodes?: string[];
  boxesToSearch?: Array<{
    boxCode?: string;
    code?: string;
    found?: boolean;
    isFound?: boolean;
    storageLocation?: {
      palletId: string;
      palletCode: string;
      zoneId: string | null;
      zoneCode: string | null;
      zoneName: string | null;
    } | null;
  }>;
  foundBoxes?: Array<{ boxCode?: string; code?: string; found?: boolean; isFound?: boolean }>;
  foundBoxCodes?: string[];
  foundBoxesCodes?: string[];
  boxSearchProgress?: {
    total?: number;
    found?: number;
    remaining?: number;
    foundBoxCodes?: string[];
    remainingBoxCodes?: string[];
  };
  relabelTasks?: Array<{
    sourceBox: string;
    oldBarcode?: string;
    newBarcode?: string;
    barcode?: string;
    name?: string;
    size?: string;
      quantity: number;
      note?: string;
  }>;
  allMovementTasks?: Array<{
    sourceBox: string;
    targetBox: string;
    purpose?: string;
    targetRole?: string;
    barcode?: string;
    name?: string;
    size?: string;
    quantity: number;
    note?: string;
  }>;
  movementTasks?: Array<{
    sourceBox: string;
    targetBox: string;
    purpose?: string;
    targetRole?: string;
    barcode?: string;
    name?: string;
    size?: string;
    quantity: number;
    note?: string;
  }>;
  movementProgress?: {
    totalRequired?: number;
    totalMoved?: number;
    totalRemaining?: number;
    doneSourceBoxes?: string[];
    sourceBoxes?: Array<{
      sourceBox: string;
      requiredQuantity: number;
      movedQuantity: number;
      remainingQuantity: number;
      done: boolean;
      targetBoxes: string[];
    }>;
    rows?: Array<{
      sourceBox: string;
      targetBox: string;
      purpose?: string;
      targetRole?: string;
      barcode?: string;
      name?: string;
      size?: string;
      quantity: number;
      requiredQuantity?: number;
      movedQuantity?: number;
      remainingQuantity?: number;
      done?: boolean;
      note?: string;
      actualTargetBoxes?: string[];
    }>;
    actualRows?: Array<{
      sourceBox: string;
      targetBox: string;
      purpose?: string;
      targetRole?: string;
      barcode?: string;
      name?: string | null;
      size?: string | null;
      quantity: number;
      movedAt?: string | null;
    }>;
  };
  fbsAssembly?: {
    totalOrders: number;
    startedOrders: number;
    completedOrders: number;
    duplicateKizScans: Array<{
      id: string;
      eventKey: string;
      kiz: string;
      detectedAt: string;
      attempt: {
        requestId: string;
        requestNumber: number | null;
        requestTitle: string | null;
        assemblyId: string;
        orderId: string;
        boxCode: string;
        deviceCode: string | null;
        workerName: string | null;
        status: string | null;
        scannedAt: string;
      };
      existing: {
        requestId: string;
        requestNumber: number | null;
        requestTitle: string | null;
        assemblyId: string;
        orderId: string;
        boxCode: string;
        deviceCode: string | null;
        workerName: string | null;
        status: string | null;
        scannedAt: string;
      };
    }>;
    kizConflicts: Array<{
      id: string;
      orderId: string;
      productName: string;
      article: string | null;
      sourceBoxCode: string | null;
      kiz: string;
      message: string;
      updatedAt: string;
    }>;
    returnRequired: {
      orders: number;
      units: number;
      rows: Array<{
        id: string;
        orderId: string;
        sourceBoxCode: string | null;
        productName: string;
        article: string | null;
        productBarcode: string | null;
        kiz: string | null;
        size: string | null;
        wbStickerPartB: string | null;
        wbStickerBarcode: string | null;
        status: string;
        statusLabel: string;
        syncIssue: string | null;
        workerName: string | null;
        completedAt: string | null;
        updatedAt: string;
      }>;
    };
    wmsBoxes: {
      totalBoxes: number;
      closedBoxes: number;
      packedUnits: number;
      remainingUnits: number;
      boxes: Array<{
        id: string;
        code: string;
        status: string;
        deviceCode: string | null;
        openedByName: string | null;
        openedAt: string;
        closedByName: string | null;
        closedAt: string | null;
        items: Array<{
          id: string;
          orderId: string;
          productName: string;
          article: string | null;
          productBarcode: string | null;
          size: string | null;
          kiz: string | null;
          wbStickerPartB: string | null;
          packedByName: string | null;
          packedAt: string | null;
          quantity: number;
        }>;
      }>;
      notPacked: Array<{
        orderId: string;
        productName: string;
        article: string | null;
        productBarcode: string | null;
        size: string | null;
        wbStickerPartB: string | null;
        assemblyStatus: string;
        assemblyStatusLabel: string;
        readyForPacking: boolean;
      }>;
    };
    notCollected: {
      remainingOrders: number;
      remainingPositions: number;
      remainingUnits: number;
      pendingOrderIds: string[];
      rows: Array<{
        requestItemId: string;
        skuId: string | null;
        name: string | null;
        article: string | null;
        color: string | null;
        size: string | null;
        barcode: string | null;
        requiredQuantity: number;
        collectedQuantity: number;
        remainingQuantity: number;
        orderIds: string[];
        orders: Array<{
          id: string;
          connectionId: string;
          assemblyId: string | null;
          requiresKiz: boolean;
          kizAccepted: boolean;
        }>;
        availableBoxes: Array<{
          boxCode: string;
          quantity: number;
          palletId?: string | null;
          palletCode?: string | null;
          storageLocation?: {
            palletId: string;
            palletCode: string;
            zoneId: string | null;
            zoneCode: string | null;
            zoneName: string | null;
          } | null;
        }>;
      }>;
    };
    rows: Array<{
      id: string;
      orderId: string;
      sourceBoxCode: string | null;
      productName: string;
      article: string | null;
      productBarcode: string | null;
      kiz: string | null;
      size: string | null;
      wbStickerPartB: string | null;
      wbStickerBarcode: string | null;
      status: string;
      statusLabel: string;
      sourceBoxPending: boolean;
      syncIssue: string | null;
      workerName: string | null;
      completionSource: 'SOS_WB' | 'STANDARD';
      completedAt: string | null;
      updatedAt: string;
    }>;
  } | null;
};

export type CreateClientRequestPayload = {
  clientId: string;
  warehouseId?: string;
  type: ClientRequestType;
  priority?: ClientRequestPriority;
  title: string;
  comment?: string;
  contactName?: string;
  contactPhone?: string;
  destinationCity: string;
  deliveryAddress?: string;
  desiredDate?: string;
  items?: Array<{
    skuId?: string;
    barcode?: string;
    name?: string;
    quantity: number;
    comment?: string;
  }>;
};

export type UpdateClientRequestPayload = Partial<Omit<CreateClientRequestPayload, 'clientId'>>;

export type PreviewClientRequestAvailabilityPayload = Pick<CreateClientRequestPayload, 'clientId' | 'warehouseId' | 'type' | 'items'> & {
  excludeRequestId?: string;
};

export type OutboundRequestXlsxPayload = {
  file: File;
  clientId: string;
  title?: string;
  priority?: ClientRequestPriority;
  comment?: string;
  contactName?: string;
  contactPhone?: string;
  destinationCity: string;
  deliveryAddress?: string;
  desiredDate?: string;
};

export type CreateClientPayload = {
  clientKind: ClientKind;
  name: string;
  legalName: string;
  inn: string;
  kpp?: string;
  ogrn?: string;
  legalAddress?: string;
  actualAddress?: string;
  phone?: string;
  telegramChatId?: string;
  email?: string;
  bankName?: string;
  bankBik?: string;
  bankAccount?: string;
  correspondentAccount?: string;
  storageAccountingEnabled?: boolean;
  logisticsInvoiceMode?: ClientLogisticsInvoiceMode;
  storageBillingMode?: ClientStorageBillingMode;
  storesWithoutBoxes?: boolean;
  stockBalanceMode?: ClientStockBalanceMode;
  onlineReceiptVisibleToClient?: boolean;
  fbsCalculatorEnabled?: boolean;
  relabelingEnabled?: boolean;
  factoryEnabled?: boolean;
  factoryName?: string;
  factoryCode?: string;
  fulfillmentManagerUserId?: string;
  ownCompanyId?: string;
};

export type ClientTelegramSettings = {
  clientId: string;
  enabled: boolean;
  chatId: string;
};

export type UpdateClientPayload = Partial<CreateClientPayload>;

export type FactoryShipment = {
  id: string; number: number; clientId: string; title: string; factoryName: string;
  status: 'DRAFT' | 'PICKING' | 'SHIPPED' | 'RECEIVING' | 'RECONCILED' | 'CANCELLED';
  comment?: string | null; receiptRequestId?: string | null; createdAt: string; shippedAt?: string | null;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'> & { factoryName?: string | null; factoryCode?: string | null };
  items: Array<{ id: string; skuId: string; barcode?: string | null; name: string; article?: string | null; size?: string | null; plannedQty: number; scannedQty: number; receivedQty: number }>;
};

export type ClientImportIssue = {
  row: number;
  code?: string;
  name?: string;
  message: string;
  severity: 'warning' | 'error';
};

export type ClientImportResult = {
  fileName: string;
  summary: {
    sourceRows: number;
    created: number;
    skipped: number;
    errors: number;
    warnings: number;
  };
  issues: ClientImportIssue[];
  clients: ClientSummary[];
};

export type SkuImportIssue = {
  row: number;
  internalSku?: string;
  name?: string;
  message: string;
  severity: 'warning' | 'error';
};

export type NomenclatureSummary = {
  id: string;
  internalSku: string;
  article: string | null;
  barcode: string | null;
  name: string;
  printName: string | null;
  unit: string | null;
  itemType: string | null;
  color: string | null;
  size: string | null;
  needsChestnyZnak: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateNomenclaturePayload = {
  internalSku?: string;
  article?: string;
  barcode?: string;
  name: string;
  printName?: string;
  unit?: string;
  itemType?: string;
  color?: string;
  size?: string;
  needsChestnyZnak?: boolean;
};

export type NomenclatureImportResult = {
  fileName: string;
  summary: {
    sourceRows: number;
    rows: number;
    barcodes: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    warnings: number;
  };
  issues: SkuImportIssue[];
  items: NomenclatureSummary[];
};

export type ArticleMappingSummary = {
  id: string;
  clientId: string;
  sourceArticle: string;
  targetArticle: string;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateArticleMappingPayload = {
  clientId: string;
  sourceArticle: string;
  targetArticle: string;
  comment?: string;
};

export type ArticleMappingImportResult = {
  fileName: string;
  summary: {
    sourceRows: number;
    rows: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    warnings: number;
  };
  issues: Array<{
    row: number;
    message: string;
    severity: 'warning' | 'error';
  }>;
  items: ArticleMappingSummary[];
};

export type FbsRelabelReconciliationSku = {
  id: string;
  internalSku: string;
  clientSku: string | null;
  article: string | null;
  name: string;
  color: string | null;
  size: string | null;
  barcodes: string[];
  primaryBarcode: string | null;
};

export type FbsRelabelReconciliationIssue = {
  id: string;
  kind:
    | 'MISSING_RELABEL'
    | 'RELABEL_NOT_RECORDED'
    | 'WB_SHIPPED_WMS_OPEN'
    | 'WMS_DONE_WB_ACTIVE';
  severity: 'CRITICAL' | 'WARNING';
  title: string;
  explanation: string;
  correctable: boolean;
  assemblyId?: string;
  request: {
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
  } | null;
  order: {
    id: string;
    supplierStatus: string | null;
    wbStatus: string | null;
  };
  supplyId: string | null;
  quantity: number;
  boxCode: string | null;
  sourceSku: FbsRelabelReconciliationSku | null;
  targetSku: FbsRelabelReconciliationSku | null;
  correction: {
    mode: 'APPLY_RELABEL' | 'MANUAL_REVIEW' | 'CLOSE_REQUEST_REVIEW' | 'WB_REVIEW';
    sourceDelta: number;
    targetDelta: number;
    availableSourceQuantity?: number;
  };
};

export type FbsRelabelReconciliationReport = {
  generatedAt: string;
  period: { from: string; to: string };
  filter: { barcode: string | null };
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  wb: {
    checked: boolean;
    fetchedAt: string;
    ordersChecked: number;
    suppliesChecked: number;
    supplies: Array<{
      connectionId: string;
      accountName: string | null;
      supplyId: string;
      checked: boolean;
      done: boolean | null;
      closedAt: string | null;
      error: string | null;
    }>;
  };
  totals: {
    mappings: number;
    sentRequests: number;
    stockUnits: number;
    reservedUnits: number;
    freeUnits: number;
    pendingReservedUnits: number;
    assembledReservedUnits: number;
    issues: number;
    criticalIssues: number;
    correctableIssues: number;
  };
  stockRows: Array<{
    mappingId: string;
    sourceArticle: string;
    targetArticle: string;
    sourceSku: FbsRelabelReconciliationSku;
    targetSku: FbsRelabelReconciliationSku | null;
    stock: {
      available: number;
      reserved: number;
      free: number;
      targetAvailable: number;
      boxes: Array<{ code: string; quantity: number }>;
    };
    reservations: {
      pending: number;
      assembled: number;
      returnRequired: number;
      requestNumbers: number[];
      orderIds: string[];
    };
  }>;
  requests: Array<{
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
    shippedAt: string;
    supplies: string[];
    orders: number;
    wbShippedOrders: number;
    relabelExpected: number;
    relabelConfirmed: number;
    issues: number;
  }>;
  issues: FbsRelabelReconciliationIssue[];
};

export type KizIssue = {
  issueKey: string;
  kind:
    | 'WB_REJECTED'
    | 'WB_SYNC_STUCK'
    | 'COMPLETED_WITHOUT_ACCEPTED_KIZ'
    | 'MARK_MISSING'
    | 'MARK_WRONG_CLIENT'
    | 'MARK_WRONG_SKU'
    | 'MARK_WRONG_BOX'
    | 'MARK_WRONG_STATUS'
    | 'LOCAL_STATUS_CONFLICT'
    | 'DUPLICATE_SCAN'
    | 'BOX_KIZ_EXHAUSTED';
  status: 'OPEN' | 'RESOLVED';
  severity: 'CRITICAL' | 'WARNING';
  title: string;
  explanation: string;
  detectedAt: string;
  isUnread: boolean;
  readAt: string | null;
  resolvedAt: string | null;
  resolution: {
    action: string;
    comment: string | null;
    userName: string | null;
  } | null;
  client: { id: string; code: string; name: string } | null;
  branch: { id: string; code: string; city: string; name: string } | null;
  request: {
    id: string;
    number: number;
    title: string;
    status: string;
  } | null;
  orderId: string | null;
  assemblyId: string | null;
  sku: {
    id: string;
    internalSku: string;
    article: string | null;
    name: string;
    color: string | null;
    size: string | null;
  } | null;
  boxCode: string | null;
  kiz: string | null;
  wbMetaStatus: string | null;
  workerName: string | null;
  errorMessage: string | null;
  duplicate: {
    existingRequestNumber: number | null;
    existingOrderId: string | null;
    existingBoxCode: string | null;
    existingWorkerName: string | null;
    existingProduct: {
      internalSku: string | null;
      article: string | null;
      name: string | null;
      color: string | null;
      size: string | null;
    } | null;
  } | null;
  stockConflict: {
    availableQuantity: number;
    registeredKizCount: number;
    usedKizCount: number;
    usedAssignments: Array<{
      requestNumber: number | null;
      orderId: string | null;
      boxCode: string | null;
      status: string | null;
    }>;
  } | null;
  canReplace: boolean;
  allowedActions: Array<
    | 'REPLACE_KIZ'
    | 'REGISTER_EXTRA_UNIT'
    | 'PREPARE_EXTRA_UNIT'
    | 'RELEASE_BOX'
    | 'MARK_RESOLVED'
  >;
};

export type KizIssuesReport = {
  generatedAt: string;
  activeWarehouseId: string | null;
  status: 'open' | 'resolved' | 'all';
  summary: {
    all: number;
    open: number;
    critical: number;
    warning: number;
    unread: number;
    resolved: number;
  };
  issues: KizIssue[];
};

export type BoxKizDiscrepancy = {
  boxId: string;
  boxCode: string;
  boxStatus: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  warehouseId: string | null;
  warehouseCode: string | null;
  warehouseCity: string | null;
  warehouseName: string | null;
  skuId: string;
  internalSku: string;
  article: string | null;
  productName: string;
  color: string | null;
  size: string | null;
  boxQuantity: number;
  registeredKizCount: number;
  excessKizCount: number;
  protectedKizCount: number;
  removableKizCount: number;
  canWriteOff: boolean;
  totalRows: number;
  totalExcessKiz: number;
  totalBlockedRows: number;
};

export type BoxKizDiscrepancyReport = {
  generatedAt: string;
  activeWarehouseId: string | null;
  summary: {
    rows: number;
    boxes: number;
    excessKiz: number;
    blockedRows: number;
  };
  discrepancies: BoxKizDiscrepancy[];
};

export type DeleteClientResult = {
  id: string;
  code: string;
  name: string;
  deleted: true;
};

export type MarketplaceConnectionSummary = {
  id: string;
  clientId: string;
  marketplace: MarketplaceType;
  accountName: string | null;
  sellerId: string | null;
  apiKeyMask: string;
  hasApiKey: boolean;
  isActive: boolean;
  comment: string | null;
  fbsExecutionWarehouseId: string | null;
  fbsWarehouseId: string | null;
  fbsWarehouseName: string | null;
  fbsDropoffWarehouseId: string | null;
  fbsAutoRouteNewWarehouses: boolean;
  createdAt: string;
  updatedAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
};

export type MarketplaceProductSyncResult = {
  marketplace: MarketplaceType;
  clientId: string;
  productsReceived: number;
  created: number;
  updated: number;
  mergedDrafts: number;
  barcodesTouched: number;
  skipped: number;
  errors: Array<{
    offerId: string;
    message: string;
  }>;
};

export type DbsIntegrationSummary = {
  id: string;
  clientId: string;
  marketplace: 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET';
  senderName: string;
  contactName: string | null;
  phone: string;
  email: string | null;
  city: string;
  address: string;
  postalCode: string | null;
  deliveryProvider: string;
  deliveryServiceName: string | null;
  deliveryApiUrl: string | null;
  deliveryAccountId: string | null;
  deliveryApiKeyMask: string;
  hasDeliveryApiKey: boolean;
  hasDeliveryApiSecret: boolean;
  hasMarketplaceApi: boolean;
  isActive: boolean;
  ready: boolean;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckMessage: string | null;
  createdAt: string;
  updatedAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
};

export type UpsertDbsIntegrationPayload = {
  clientId: string;
  marketplace: 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET';
  senderName: string;
  contactName?: string;
  phone: string;
  email?: string;
  city: string;
  address: string;
  postalCode?: string;
  deliveryProvider: string;
  deliveryServiceName?: string;
  deliveryApiUrl?: string;
  deliveryAccountId?: string;
  deliveryApiKey: string;
  deliveryApiSecret?: string;
  isActive?: boolean;
};

export type FbsOrderCategory = 'active' | 'shipped' | 'cancelled' | 'archive';

export type FbsProductShipmentReportRow = {
  skuId: string | null;
  internalSku: string;
  clientSku: string;
  article: string;
  productName: string;
  color: string;
  size: string;
  barcode: string;
  quantity: number;
  orders: number;
  wbOrderNumbers: string;
  wbSupplyNumbers: string;
  wmsRequestNumbers: string;
  firstShippedAt: string;
  lastShippedAt: string;
};

export type FbsProductShipmentReport = {
  client: { id: string; code: string; name: string };
  warehouse: { id: string; code: string; name: string; city: string };
  period: { dateFrom: string; dateTo: string };
  search: string;
  summary: {
    products: number;
    quantity: number;
    orders: number;
    requests: number;
  };
  rows: FbsProductShipmentReportRow[];
  generatedAt: string;
};

export type FbsPenaltyReportRow = {
  id: string;
  connectionId: string;
  accountName: string;
  reportDate: string;
  reason: string;
  penalty: number;
  currency: string;
  orderId: string;
  orderUid: string;
  cargoPlaceId: string;
  vendorCode: string;
  productName: string;
  size: string;
  barcode: string;
  nmId: string;
  officeName: string;
  deliveryMethod: string;
  reportId: string;
  rrdId: string;
};

export type FbsPenaltiesReport = {
  client: { id: string; code: string; name: string };
  period: { dateFrom: string; dateTo: string };
  selectedConnectionId: string | null;
  search: string;
  summary: {
    penalties: number;
    chargedPenalty: number;
    reversedPenalty: number;
    netPenalty: number;
    orders: number;
    reasons: number;
    accounts: number;
    currency: string;
  };
  reasons: Array<{
    reason: string;
    penalties: number;
    chargedPenalty: number;
    reversedPenalty: number;
    netPenalty: number;
  }>;
  rows: FbsPenaltyReportRow[];
  sources: Array<{
    connectionId: string;
    accountName: string;
    status: 'READY' | 'ERROR';
    rows: number;
    error: string | null;
  }>;
  truncated: boolean;
  generatedAt: string;
};

export type FbsDeliveryDestination = 'PICKUP_POINT' | 'VNUKOVO_SORTING_CENTER';

export type FbsOrderSummary = {
  id: string;
  orderUid: string | null;
  connectionId: string;
  accountName: string | null;
  marketplace: 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET';
  category: FbsOrderCategory;
  supplierStatus: string;
  wbStatus: string;
  statusLabel: string;
  article: string | null;
  nmId: string | null;
  chrtId: string | null;
  barcodes: string[];
  itemCount: number;
  product: {
    id: string;
    name: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    size: string | null;
  } | null;
  storageBoxes: Array<{
    code: string;
    quantity: number;
    status: string;
  }>;
  relabeling: {
    required: true;
    sourceSkuId: string | null;
    sourceProductName: string | null;
    sourceArticle: string;
    sourceBarcodes: string[];
  } | null;
  createdAt: string | null;
  sellerDate: string | null;
  deliveryDate: string | null;
  supplyId: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  officeId: string | null;
  cargoType: string | null;
  crossBorderType: string | null;
  pickupPointShipmentAllowed: boolean;
  requiresReshipment: boolean;
  shipmentPlan: {
    destination: FbsDeliveryDestination;
    itemsPerCargoPlace: number;
    requiresCargoPlaces: boolean;
    cargoPlaceCount: number;
    cargoPlaceIds: string[];
    sentToWbAt: string | null;
    sentToWbBy: {
      id: string | null;
      name: string;
    } | null;
  } | null;
  requiredMeta: string[];
  optionalMeta: string[];
  comment: string | null;
  request: {
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
    fbsEmergencyAssemblyAt: string | null;
    fbsEmergencyAssemblyByUserId: string | null;
    fbsEmergencyAssemblyByName: string | null;
  } | null;
  reservation?: {
    status: string;
    withoutBox: boolean;
    boxCode: string | null;
    palletCode: string | null;
    warehouseId: string | null;
    reservedAt: string | null;
    problem: string | null;
  } | null;
  billing: {
    chargeId: string;
    status: BillingChargeStatus;
    unitPriceRub: number;
    totalRub: number;
    invoiceNumber: string | null;
    invoiceStatus: BillingInvoiceStatus | null;
    breakdown: {
      fbsProcessingRub: number;
      additionalServicesRub: number;
      deliveryRub: number;
      boxFormationRub: number;
      boxMaterialRub: number;
      palletRub: number;
      shipmentKey: string;
      shipmentItems: number;
      boxCount: number;
      palletCount: number;
      deliveryDestination: FbsDeliveryDestination;
    };
  } | null;
};

export type ClientFbsOrders = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  connected: boolean;
  connections: Array<{
    id: string;
    marketplace: 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET';
    accountName: string | null;
  }>;
  fetchedAt: string;
  deliveryPlan: {
    destination: FbsDeliveryDestination;
    itemsPerCargoPlace: number;
    requiresCargoPlaces: boolean;
  };
  counts: {
    active: number;
    shipped: number;
    cancelled: number;
    archive: number;
    all: number;
  };
  orders: FbsOrderSummary[];
};

export type FbsActiveClientSummary = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  activeOrders: number;
  fetchedAt: string;
};

export type FbsCargoPackingOrder = {
  orderId: string;
  requestId: string;
  productName: string;
  article: string | null;
  color: string | null;
  size: string | null;
  productBarcode: string | null;
  wbStickerPartB: string | null;
  wbStickerBarcode: string | null;
  sourceBoxCode: string | null;
  quantity: number;
  packedByName: string | null;
  packedAt: string | null;
};

export type FbsCargoPackingPlace = {
  id: string | null;
  supplyId?: string;
  requestNumbers?: number[];
  cargoPlaceId: string;
  cargoPlaceBarcode: string | null;
  capacityItems: number;
  packedItems: number;
  status: 'NOT_STARTED' | 'OPEN' | 'CLOSED';
  deviceCode: string | null;
  openedByName: string | null;
  openedAt: string | null;
  closedByName: string | null;
  closedAt: string | null;
  orders: FbsCargoPackingOrder[];
};

export type FbsCargoPackingSupply = {
  id: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  connectionId: string;
  supplyId: string;
  requestNumbers: number[];
  hasActiveRequest: boolean;
  ignored: boolean;
  ignoredAt: string | null;
  ignoredByName: string | null;
  ignoreReason: string | null;
  deliveryDestination: FbsDeliveryDestination;
  packingMode: 'WB_CARGO_PLACE' | 'SORTING_CENTER_BOX';
  itemsPerCargoPlace: number;
  cargoPlaceCount: number;
  totalPlannedItems: number;
  completedItems: number;
  packedItems: number;
  remainingToPack: number;
  waitingAssembly: number;
  closedCargoPlaces: number;
  readyToDeliver: boolean;
  cargoPlaces: FbsCargoPackingPlace[];
  createdAt: string;
  updatedAt: string;
};

export type ClientPaymentAccounts = {
  company: {
    id: string;
    shortName: string;
    fullName: string;
    inn: string;
  } | null;
  bankAccounts: OwnCompanyBankAccountSummary[];
};

export type FbsCargoPackingsResponse = {
  clientId: string;
  fetchedAt: string;
  supplies: FbsCargoPackingSupply[];
};

export type FbsPackedItem = {
  id: string;
  marketplace: 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET';
  client: Pick<ClientSummary, 'id' | 'code' | 'name'> | null;
  request: {
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
  } | null;
  orderId: string;
  supplyId: string | null;
  accountName: string | null;
  marketplaceWarehouse: { id: string | null; name: string | null };
  executionWarehouse: { id: string; code: string; name: string; city: string } | null;
  product: {
    skuId: string;
    internalSku: string | null;
    clientSku: string | null;
    name: string | null;
    article: string | null;
    color: string | null;
    size: string | null;
    barcode: string | null;
    quantity: number;
    requiresKiz: boolean;
    kiz: string | null;
  };
  relabeling: {
    sourceSkuId: string | null;
    sourceInternalSku: string | null;
    sourceProductName: string | null;
    sourceArticle: string | null;
    sourceBarcode: string | null;
  } | null;
  source: {
    boxId: string | null;
    boxCode: string | null;
    boxStatus: string | null;
    zone: { id: string; code: string; name: string } | null;
    palletSort: { id: string; code: string; status: string } | null;
    placementScannedAt: string | null;
  };
  sticker: {
    partA: string | null;
    partB: string | null;
    barcode: string | null;
    labelSaved: boolean;
  };
  cargoPlace: {
    id: string;
    barcode: string | null;
    status: string;
    closedAt: string | null;
  } | null;
  assembly: {
    status: string;
    wbMetaStatus: string;
    deviceCode: string;
    workerUserId: string | null;
    workerName: string | null;
    completedAt: string | null;
    cargoPackedAt: string | null;
    cargoPackedByName: string | null;
    marketplaceSubmittedAt: string | null;
    marketplaceSubmitError: string | null;
    errorMessage: string | null;
  };
  comparison?: FbsPackedItemComparison | null;
};

export type FbsPackedItemComparison = {
  status: 'MATCHED' | 'STICKER_MISMATCH' | 'ORDER_CANCELLED' | 'ORDER_NOT_FOUND' | 'ISSUES' | 'CHECK_ERROR' | 'NOT_AVAILABLE';
  issues: string[];
  actualSticker: { partA: string | null; partB: string | null; barcode: string | null } | null;
  expectedSticker: { partA: string | null; partB: string | null; barcode: string | null } | null;
  order: {
    category: 'active' | 'shipped' | 'cancelled' | 'archive';
    supplierStatus: string;
    wbStatus: string;
    statusLabel: string;
    supplyId: string | null;
    productName: string | null;
    article: string | null;
    barcode: string | null;
  } | null;
};

export type FbsPackedItemsReport = {
  generatedAt: string;
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  items: FbsPackedItem[];
};

export type FbsStockItem = {
  skuId: string;
  internalSku: string;
  clientSku: string | null;
  article: string | null;
  name: string;
  color: string | null;
  size: string | null;
  barcode: string | null;
  nmId: string;
  chrtId: string;
  status: 'SELLING' | 'STOPPED' | 'UNMANAGED';
  enabled: boolean | null;
  wmsAvailable: number;
  reserved: number;
  sellable: number;
  wbAmount: number;
  /**
   * Manually configured cap for the quantity published to WB. `null` means
   * that the whole available WMS balance is used.
   */
  saleLimit: number | null;
  /** Manual WB quantity for a SKU assembled from relabeled source stock. */
  relabelManualAmount: number | null;
  relabeling: {
    isSource: boolean;
    isTarget: boolean;
    sources: Array<{ skuId: string; label: string; sellable: number; allocated: number }>;
    allocatedFromSources: number;
    allocatedToTargets: number;
    capacity: number;
  };
  /** Quantity requested by the current publication setting. */
  requestedAmount: number | null;
  /** Quantity that the WMS plans to publish after all limits are applied. */
  targetAmount: number | null;
  /** Quantity currently confirmed by Wildberries (kept alongside wbAmount for compatibility). */
  publishedAmount: number | null;
  /** Whether the requested limit is currently higher than the free WMS balance. */
  shortage: boolean;
  /** Number of units missing to cover the requested limit. */
  shortageAmount: number;
  difference: number | null;
  lastSyncedAmount: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type FbsStocksResponse = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  connected: boolean;
  connections: Array<{
    id: string;
    marketplace: 'WILDBERRIES';
    accountName: string | null;
    fbsExecutionWarehouseId: string | null;
    fbsDropoffWarehouseId: string | null;
    fbsAutoRouteNewWarehouses: boolean;
  }>;
  selectedConnectionId: string | null;
  warehouses: Array<{
    id: string;
    name: string;
    officeId: string | null;
    cargoType: number | null;
    deliveryType: number | null;
  }>;
  selectedWarehouseId: string | null;
  connectedWarehouseId: string | null;
  connectedWarehouseName: string | null;
  warehouseConnectedAt: string | null;
  fetchedAt: string;
  summary: {
    products: number;
    enabled: number;
    disabled: number;
    unmanaged: number;
    wmsAvailable: number;
    sellable: number;
    wbAmount: number;
    requestedAmount: number;
    targetAmount: number;
    differences: number;
    excessProducts: number;
    excessUnits: number;
    shortages: number;
  };
  items: FbsStockItem[];
};

export type FbsStockAllocationResponse = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  connection: { id: string; accountName: string | null; primaryWarehouseId: string | null };
  policy: {
    id: string | null;
    enabled: boolean;
    lowStockThreshold: number;
    recommendationDays: number;
    updatedSource: 'WMS' | 'CLIENT_PORTAL' | 'EXTERNAL_CLIENT' | string;
    changedByClientAt: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
    overrideCount: number;
  };
  shares: Array<{
    warehouseId: string;
    warehouseName: string;
    routeMode: FbsWarehouseRouteMode;
    percent: number;
    isPrimary: boolean;
    recommendedPercent: number;
  }>;
  recommendation: { periodDays: number; basedOnOrders: number };
  integrationKeys: Array<{
    id: string;
    name: string;
    keyPrefix: string;
    isActive: boolean;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }>;
  changes: Array<{
    id: string;
    source: string;
    changeType: string;
    externalReference: string | null;
    payload: unknown;
    acknowledged: boolean;
    acknowledgedAt: string | null;
    createdAt: string;
    integration: { id: string; name: string; keyPrefix: string } | null;
  }>;
  unacknowledgedChanges: number;
};

export type FbsWarehouseRouteMode =
  | 'DEFAULT'
  | 'CENTRAL'
  | 'BRANCH'
  | 'EXCLUDED';

export type FbsWarehouseRoutesResponse = {
  connection: {
    id: string;
    clientId: string;
    accountName: string | null;
    isActive: boolean;
    fbsExecutionWarehouseId: string | null;
    fbsDropoffWarehouseId: string | null;
    fbsAutoRouteNewWarehouses: boolean;
  };
  branches: Array<{
    id: string;
    code: string;
    name: string;
    city: string;
    isActive: boolean;
    sortOrder: number;
  }>;
  warehouses: Array<{
    marketplaceWarehouseId: string;
    marketplaceWarehouseName: string;
    existsInMarketplace: boolean;
    officeId: string | null;
    officeName: string | null;
    officeCity: string | null;
    mode: FbsWarehouseRouteMode;
    executionWarehouseId: string | null;
    dropoffWarehouseId: string | null;
    effectiveExecutionWarehouseId: string | null;
    effectiveDropoffWarehouseId: string | null;
    updatedAt: string | null;
  }>;
  fetchedAt: string;
};

export type UpdateFbsWarehouseRoutesPayload = {
  items: Array<{
    marketplaceWarehouseId: string;
    marketplaceWarehouseName?: string;
    officeId?: string;
    officeName?: string;
    officeCity?: string;
    mode: FbsWarehouseRouteMode;
    executionWarehouseId?: string;
    dropoffWarehouseId?: string;
  }>;
};

export type FbsOrderSelectionPayload = {
  clientId: string;
  orders: Array<{ connectionId: string; id: string }>;
  deliveryDestination?: FbsDeliveryDestination;
  destinationOfficeId?: string;
  plannedDeliveryDate?: string;
  marketplaceWarehouseKey?: string;
  sourceRequestId?: string;
};

function sanitizeFbsOrderSelectionPayload(
  payload: FbsOrderSelectionPayload,
): FbsOrderSelectionPayload {
  return {
    clientId: payload.clientId,
    orders: payload.orders.map(({ connectionId, id }) => ({ connectionId, id })),
    ...(payload.deliveryDestination === undefined
      ? {}
      : { deliveryDestination: payload.deliveryDestination }),
    ...(payload.destinationOfficeId === undefined
      ? {}
      : { destinationOfficeId: payload.destinationOfficeId }),
    ...(payload.plannedDeliveryDate === undefined
      ? {}
      : { plannedDeliveryDate: payload.plannedDeliveryDate }),
    ...(payload.marketplaceWarehouseKey === undefined
      ? {}
      : { marketplaceWarehouseKey: payload.marketplaceWarehouseKey }),
    ...(payload.sourceRequestId === undefined
      ? {}
      : { sourceRequestId: payload.sourceRequestId }),
  };
}

export type AssembleFbsOrdersResult = {
  assembled: number;
  reshipped: number;
  submitted?: number;
  marketplace?: MarketplaceType;
  message?: string;
  orderIds?: string[];
  deliveryPlan: ClientFbsOrders['deliveryPlan'];
  supplies: Array<{
    id: string;
    connectionId: string;
    orderIds: string[];
    itemCount: number;
    cargoPlaceCount: number;
    cargoPlaceIds: string[];
  }>;
  orders: ClientFbsOrders;
};

export type MoveFbsOrdersToNewSupplyResult = {
  moved: number;
  skipped: number;
  skippedOrders: Array<{ id: string; reason: string }>;
  sourceSupplyId: string;
  sourceSupplyIds: string[];
  targetSupply: {
    id: string;
    cargoPlaceCount: number;
    cargoPlaceIds: string[];
  };
  sourceRequest: { id: string; number: number };
  sourceRequests: Array<{ id: string; number: number }>;
  targetRequest: {
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
  };
  orders: ClientFbsOrders;
};

// ADDED: compact report returned by the online-request recovery action.
export type RepairFbsOrdersMoveResult = {
  moved: number;
  skipped: number;
  skippedOrders: Array<{ id: string; reason: string }>;
  targetSupply: MoveFbsOrdersToNewSupplyResult['targetSupply'] | null;
  targetRequest: MoveFbsOrdersToNewSupplyResult['targetRequest'] | null;
  sourceRequests: Array<{ id: string; number: number }>;
  partialFailure: string | null;
};

export type MergeFbsRequestTailsResult =
  MoveFbsOrdersToNewSupplyResult & {
    selectedRequestCount: number;
  };

export type MergeFbsRequestTailsPreview = {
  clientId: string;
  sourceRequests: Array<{ id: string; number: number }>;
  orderCount: number;
  itemCount: number;
  skuCount: number;
  orders: Array<{
    connectionId: string;
    id: string;
    sourceRequest: { id: string; number: number } | null;
    sourceSupplyId: string;
    itemCount: number;
    article: string | null;
    barcodes: string[];
    product: {
      id: string;
      name: string;
      internalSku: string;
      clientSku: string | null;
      article: string | null;
      size: string | null;
    };
    storageBoxes: Array<{ code: string; quantity: number }>;
  }>;
  skippedOrders: Array<{ id: string; reason: string }>;
};

export type FbsOrderActionResult = {
  cancelled?: number;
  delivered?: number;
  failed: Array<{ id?: string; supplyId?: string; message: string }>;
  recovery?: {
    rescanOrders: FbsDeliveryRecoveryItem[];
    cancelledOrders: FbsDeliveryRecoveryItem[];
  };
  orders: ClientFbsOrders;
};

export type FbsSupplyDeliveryOptions = {
  supplies: Array<{
    connectionId: string;
    supplyId: string;
    orderCount: number;
    itemCount: number;
    destinationOfficeId: string | null;
    destinationOfficeName: string | null;
  }>;
  offices: Array<{
    id: string;
    name: string;
    city: string;
    compatible: boolean;
  }>;
  requiredDestinationOfficeId: string | null;
  earliestWbDeliveryDate: string | null;
  defaultPlannedDeliveryDate: string;
  blockers: string[];
};

export type FbsDeliveryRecoveryItem = {
  orderId: string;
  requestId: string | null;
  requestNumber: number | null;
  productName: string;
  article: string | null;
  size: string | null;
  barcode: string | null;
  kiz: string | null;
  boxCode: string | null;
  cargoPlaceCode: string | null;
  reason: string;
};

export type FbsDeliveryRecoveryAction = 'ASSEMBLE' | 'COMPLETE' | 'REASSEMBLE';

export type FbsDeliveryRecoveryOrder = {
  connectionId: string;
  orderId: string;
  supplyId: string;
  warehouseId: string | null;
  warehouseName: string | null;
  requestId: string | null;
  requestNumber: number | null;
  requestStatus: ClientRequestStatus | null;
  action: FbsDeliveryRecoveryAction;
  actionLabel: string;
  reason: string;
  canSelect: boolean;
  blocker: string | null;
  itemCount: number;
  skuId: string | null;
  productName: string;
  article: string | null;
  size: string | null;
  barcode: string | null;
  requiresKiz: boolean;
  assemblyId: string | null;
  assemblyStatus: string | null;
  scannedBarcode: string | null;
  kiz: string | null;
  boxCode: string | null;
};

export type FbsBranchDeliveryRecoveryReport = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  branch: { id: string; code: string; name: string; city: string };
  checkedAt: string;
  counts: {
    supplies: number;
    orders: number;
    assembled: number;
    recoveryRequired: number;
    assemble: number;
    complete: number;
    reassemble: number;
    readyToSendWb: number;
    routeIssues: number;
  };
  supplies: Array<{
    connectionId: string;
    supplyId: string;
    warehouseId: string | null;
    warehouseName: string | null;
    orderCount: number;
    wbDeliveredOrders: number;
    assembledOrders: number;
    recoveryRequired: number;
    readyToSendWb: number;
    status: 'OK' | 'RECOVERY_REQUIRED' | 'READY_TO_SEND_WB' | 'ASSEMBLY_INCOMPLETE';
    statusLabel: string;
  }>;
  recoveryOrders: FbsDeliveryRecoveryOrder[];
  routeIssues: Array<{
    connectionId: string;
    orderId: string;
    supplyId: string | null;
    warehouseId: string | null;
    reason: string;
  }>;
};

export type CreateFbsDeliveryRecoveryRequestResult = {
  status: 'CREATED' | 'ALREADY_EXISTS';
  linkedOrders: number;
  request: {
    id: string;
    number: number;
    title?: string;
    status: ClientRequestStatus;
    fbsEmergencyAssemblyAt: string;
  };
};

export type ChangeFbsSupplyDestinationResult = {
  changed: number;
  removedCargoPlaces: number;
  detachedOrders: number;
  cancelledPackings: number;
  supplies: Array<{
    supplyId: string;
    removedCargoPlaces: number;
    detachedOrders: number;
    cancelledPackings: number;
  }>;
  failed: Array<{ supplyId: string; message: string }>;
  orders: ClientFbsOrders;
};

export type FbsPassOffice = {
  id: number;
  name: string;
  address: string;
};

export type FbsPass = {
  id: number;
  firstName: string;
  lastName: string;
  carModel: string;
  carNumber: string;
  officeId: number;
  officeName?: string;
  dateEnd: string;
};

export type FbsPassesResponse = {
  connections: Array<{ id: string; accountName: string | null }>;
  selectedConnectionId: string | null;
  offices: FbsPassOffice[];
  passes: FbsPass[];
};

export type FbsPassPayload = {
  clientId: string;
  connectionId: string;
  firstName: string;
  lastName: string;
  carModel: string;
  carNumber: string;
  officeId: number;
};

export type CreateFbsRequestResult = {
  request: {
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
    items: Array<{ id: string; skuId: string | null; name: string | null; quantity: number }>;
  };
  linkedOrders: number;
};

export type CreateFbsRequestFromSupplyResult = CreateFbsRequestResult & {
  supplyId: string;
  supplyOrders: number;
  skippedLinkedOrders: number;
  skippedInactiveOrders: number;
};

// ADDED: complete WB supply-to-WMS-request audit, independent of table pagination.
export type FbsSupplyRequestAudit = {
  checkedAt: string;
  checkedConnections: number;
  checkedSupplies: number;
  checkedOrders: number;
  missingRequestSupplies: number;
  missingRequestOrders: number;
  issues: Array<{
    connectionId: string;
    accountName: string | null;
    supplyId: string;
    warehouseId: string | null;
    warehouseName: string | null;
    status: 'MISSING' | 'PARTIAL';
    activeOrderCount: number;
    linkedOrderCount: number;
    unlinkedOrderCount: number;
    unlinkedOrderIds: string[];
    requestNumbers: number[];
  }>;
};

// ADDED: preview/apply contract for supplies combined manually in WB.
export type FbsSupplyReconciliation = {
  clientId: string;
  connectionId: string;
  supplyId: string;
  wbOrderCount: number;
  localTargetOrderCount: number;
  linkedOrderCount: number;
  taskCount: number;
  linkUpdates: number;
  taskUpdates: number;
  unlinkedOrderCount: number;
  changed: boolean;
  canApply: boolean;
  fingerprint: string;
  blockers: string[];
  plans: Array<{
    supplyId: string;
    beforeCount: number;
    afterCount: number;
    movedToTarget: number;
    target: boolean;
  }>;
  requests: Array<{
    id: string;
    number: number;
    status: ClientRequestStatus;
    orderCount: number;
  }>;
  applied?: boolean;
  message?: string;
};

export type FbsBillingSettings = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  settings: {
    id: string;
    primaryProcessingEnabled: boolean;
    defaultDeliveryDestination: FbsDeliveryDestination;
    pickupPointBasePriceRub: number;
    vnukovoBasePriceRub: number;
    baseIncludedItems: number;
    extraBlockItems: number;
    extraBlockPriceRub: number;
    tieredLogisticsEnabled: boolean;
    logisticsFreeItemsLimit: number;
    logisticsCubicMeterLiters: number;
    logisticsCubicMeterPriceRub: number;
    logisticsPalletPriceRub: number;
    boxCapacityItems: number;
    palletsEnabled: boolean;
    boxesPerPallet: number;
    fbsProcessingPriceRub: number;
    boxFormationServiceId: string | null;
    boxMaterialServiceId: string | null;
    palletServiceId: string | null;
    additionalServices: Array<{
      serviceId: string;
      quantityMultiplier: number;
      matchKeywords: string;
    }>;
  };
  serviceOptions: Array<{
    id: string;
    code: string;
    name: string;
    unit: BillingUnit;
    priceRub: number;
    isActive: boolean;
    isPallet: boolean;
    quantityMultiplier: number;
  }>;
  excludedRule: string;
};

export type UpdateFbsBillingSettingsPayload = Omit<FbsBillingSettings['settings'], 'id'>;

export type FbsCalculatorQuote = {
  destination: string;
  totalWithTax: number | null;
  requiresManualReview: boolean;
};

export type UpsertMarketplaceConnectionPayload = {
  clientId: string;
  marketplace: MarketplaceType;
  accountName?: string;
  sellerId?: string;
  apiKey: string;
  isActive?: boolean;
  comment?: string;
  fbsExecutionWarehouseId?: string;
  fbsDropoffWarehouseId?: string;
  fbsAutoRouteNewWarehouses?: boolean;
};

export type StockBalance = {
  id: string;
  clientId: string;
  skuId: string;
  boxId: string | null;
  palletId: string | null;
  status: string;
  quantity: number;
  updatedAt: string;
  sku: {
    id: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    name: string;
    barcodes: Array<{
      id: string;
      value: string;
      isPrimary: boolean;
    }>;
  };
  box: {
    id: string;
    code: string;
    status: string;
    warehouse?: {
      id: string;
      code: string;
      name: string;
      city: string;
    } | null;
  } | null;
  pallet: {
    id: string;
    code: string;
    status: string;
  } | null;
};

export type BranchSummary = {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  ownCompanyId: string | null;
  isActive: boolean;
  sortOrder: number;
  ownCompany?: {
    id: string;
    shortName: string;
    fullName: string;
    inn: string;
    isActive: boolean;
  } | null;
  userScopes?: Array<{
    canRead: boolean;
    canWrite: boolean;
    isResponsible: boolean;
    user: { id: string; name: string; email: string; status: string };
  }>;
  _count?: { clients: number; boxes: number; requests: number };
  _stock?: {
    totalQuantity: number;
    availableQuantity: number;
    skuCount: number;
    balanceRows: number;
  };
};

export type ClientBranchAccessResponse = {
  client: {
    id: string;
    code: string;
    name: string;
  };
  branches: Array<
    Pick<BranchSummary, 'id' | 'code' | 'name' | 'city' | 'address' | 'isActive' | 'sortOrder'> & {
      enabled: boolean;
      status: string | null;
      source: string | null;
      activatedAt: string | null;
    }
  >;
};

// ADDED: отдельные типы контура True API, не смешанные с исправлением складских КИЗ.
export type KizCirculationOperation = 'RETIRE' | 'RETURN';
export type KizCirculationItemStatus =
  | 'NEEDS_REVIEW'
  | 'READY'
  | 'ALREADY_APPLIED'
  | 'IN_BATCH'
  | 'SUBMITTED'
  | 'APPLIED'
  | 'ERROR'
  | 'EXCLUDED';
export type KizCirculationBatchStatus = 'DRAFT' | 'SIGNED' | 'SUBMITTED' | 'APPLIED' | 'REJECTED';

export type KizCirculationItem = {
  id: string;
  clientId: string;
  marketplace: MarketplaceType;
  operation: KizCirculationOperation;
  orderId: string | null;
  requestId: string | null;
  assemblyId: string | null;
  skuId: string | null;
  kizRaw: string;
  cis: string;
  productGroup: string;
  productCostKopecks: number | null;
  eventAt: string;
  status: KizCirculationItemStatus;
  remoteStatus: string | null;
  remoteMessage: string | null;
  metadata: Record<string, unknown> | null;
  batchId: string | null;
  batch: { id: string; status: KizCirculationBatchStatus; crptDocumentId: string | null } | null;
};

export type KizCirculationBatch = {
  id: string;
  clientId: string;
  operation: KizCirculationOperation;
  productGroup: string;
  documentType: 'LK_RECEIPT' | 'LP_RETURN';
  status: KizCirculationBatchStatus;
  payload: Record<string, unknown>;
  payloadJson: string;
  payloadHash: string;
  crptDocumentId: string | null;
  crptStatus: string | null;
  crptError: string | null;
  submittedAt: string | null;
  processedAt: string | null;
  createdAt: string;
  itemCount: number;
};

export type KizCirculationOverview = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name' | 'inn' | 'kpp' | 'clientKind'>;
  connection: {
    id: string;
    inn: string;
    kpp: string | null;
    fiasId: string | null;
    productGroup: string;
    apiBaseUrl: string;
    tokenConfigured: boolean;
    tokenExpiresAt: string | null;
    certificateSubject: string | null;
    certificateThumbprint: string | null;
    isActive: boolean;
    lastCheckedAt: string | null;
    lastCheckOk: boolean | null;
    lastCheckMessage: string | null;
  } | null;
  marketplaceConnections: Array<{
    id: string;
    marketplace: MarketplaceType;
    accountName: string | null;
    isActive: boolean;
  }>;
  counts: Partial<Record<KizCirculationItemStatus, number>>;
  items: KizCirculationItem[];
  batches: KizCirculationBatch[];
};

export type BranchStockSummary = {
  warehouse: Pick<BranchSummary, 'id' | 'code' | 'name' | 'city' | 'address'>;
  totalQuantity: number;
  availableQuantity: number;
  skuCount: number;
  balanceRows: number;
  outgoingInTransitQuantity: number;
  incomingInTransitQuantity: number;
};

export type InterBranchTransfer = {
  id: string;
  number: number;
  status: string;
  totalQuantity: number;
  items: Array<{ skuId: string; quantity: number; internalSku: string; name: string }>;
  manifest: {
    boxes: Array<{
      boxId: string;
      code: string;
      generated: boolean;
      quantity: number;
    }>;
  } | null;
  sourceBoxCodes: string[] | null;
  receivedBoxCodes: string[] | null;
  destinationBoxCode: string | null;
  receivedQuantity: number;
  comment: string | null;
  createdByName: string;
  receivedByName: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  fromWarehouse: Pick<BranchSummary, 'id' | 'code' | 'name' | 'city'>;
  toWarehouse: Pick<BranchSummary, 'id' | 'code' | 'name' | 'city'>;
  issues?: Array<{
    id: string;
    boxCode: string | null;
    type: string;
    status: string;
    message: string;
    createdAt: string;
  }>;
  alreadyReceived?: boolean;
};

export type BranchTransferBoxesFilePreview = {
  fileName: string;
  sheetName: string;
  warehouse: Pick<BranchSummary, 'id' | 'code' | 'name' | 'city'>;
  validCodes: string[];
  duplicateCodes: string[];
  rows: Array<{
    row: number;
    code: string;
    status: 'READY' | 'ERROR';
    quantity: number;
    skuCount: number;
    reason: string | null;
  }>;
  summary: {
    sourceRows: number;
    uniqueCodes: number;
    readyBoxes: number;
    errorBoxes: number;
    duplicateBoxes: number;
    totalQuantity: number;
  };
};

export type ServiceClientStockSummary = {
  balanceRows: number;
  quantity: number;
  uniqueSkusInStock: number;
  movements: number;
  boxes: number;
  pallets: number;
  productMarks: number;
};

export type ServiceStorageOptimizationReport = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  generatedAt: string;
  summary: {
    totalUnits: number;
    sourceBoxes: number;
    targetBoxes: number;
    sourcePalletSorts: number;
    targetPalletSorts: number;
    idealTargetPalletSorts: number;
    movementUnits: number;
    idealTargetBoxes: number;
    excludedUnits: number;
  };
  targetBoxes: Array<{
    id: string;
    label: string;
    physicalBoxCode: string | null;
    warehouseId: string;
    warehouseName: string;
    strategy: 'BARCODE' | 'ARTICLE';
    article: string;
    colors: string[];
    sizes: string[];
    barcodes: string[];
    plannedQuantity: number;
    targetPalletSort: string;
  }>;
  rows: Array<{
    warehouseId: string;
    warehouseName: string;
    skuId: string;
    barcode: string | null;
    article: string | null;
    productName: string;
    color: string | null;
    size: string | null;
    sourcePalletSort: string | null;
    sourceBox: string;
    quantity: number;
    destinationBox: string;
    destinationPhysicalBox: string | null;
    destinationPalletSort: string;
    strategy: 'BARCODE' | 'ARTICLE';
    action: 'KEEP' | 'MOVE';
  }>;
};

export type ServiceClientStockCleanupPreview = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name' | 'status'>;
  summary: ServiceClientStockSummary;
  confirmationText: string;
  warning: string;
};

export type ServiceClientStockCleanupResult = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name' | 'status'>;
  before: ServiceClientStockSummary;
  deleted: {
    productMarks: number;
    balances: number;
    movements: number;
    boxes: number;
    pallets: number;
  };
  after: ServiceClientStockSummary;
};

export type ServiceClientRequestsCleanupPreview = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name' | 'status'>;
  confirmationText: string;
  total: number;
  statuses: Array<{ status: ClientRequestStatus; count: number }>;
  requests: Array<{
    id: string;
    title: string;
    status: ClientRequestStatus;
    destinationCity: string | null;
    createdAt: string;
    _count: {
      items: number;
      files: number;
      comments: number;
      events: number;
      packages: number;
    };
  }>;
  warning: string;
};

export type ServiceClientRequestsCleanupResult = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name' | 'status'>;
  deleted: {
    requests: number;
    pickWaveRequests: number;
    detachedBillingCharges: number;
    detachedLogistics: number;
  };
};

export type ServiceMaintenanceMode = {
  enabled: boolean;
  message: string;
  updatedAt: string | null;
};

export type ServiceSessionSummary = {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  client: string;
  ip: string;
  userAgent: string;
  appName: string;
  browserName: string;
  openedAt: string;
  lastSeenAt: string;
  expiresAt: string | null;
  isActive: boolean;
  minutesAgo: number;
};

export type TelegramNotificationSection = 'REQUESTS' | 'FBS' | 'WAREHOUSE' | 'LOGISTICS' | 'BILLING' | 'KIZ' | 'SYSTEM';

export type ServiceTelegramGroup = {
  id: string;
  title: string;
  type: 'group' | 'supergroup' | 'channel';
  username: string | null;
};

export type ServiceTelegramSettings = {
  global: {
    enabled: boolean;
    botToken: string;
    fulfillmentChatIds: string[];
    sections: TelegramNotificationSection[];
  };
  client: {
    clientId: string;
    enabled: boolean;
    chatId: string;
    sections: TelegramNotificationSection[];
  } | null;
};

export type TurnoverMovementType =
  | 'INITIAL_IMPORT'
  | 'RECEIPT'
  | 'MOVE'
  | 'RESERVE'
  | 'PICK'
  | 'PACK'
  | 'SHIP'
  | 'RETURN'
  | 'INVENTORY_ADJUSTMENT';

export type TurnoverActionKind = 'ADD' | 'WRITE_OFF' | 'TRANSFER' | 'UTILIZE' | 'HOLD' | 'REPLACE_BARCODE';

export type TurnoverSkuReport = {
  skuId: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  internalSku: string;
  clientSku: string | null;
  article: string | null;
  name: string;
  color: string | null;
  size: string | null;
  primaryBarcode: string | null;
  barcodes: string[];
  volumeLiters: number | null;
  firstReceiptAt: string | null;
  firstCell: string | null;
  shippedByRequest: {
    id: string;
    title: string;
    status: string;
    destinationCity: string | null;
    createdAt: string;
  } | null;
  latestShipAt: string | null;
  writtenOffAt: string | null;
  storageDays: number;
  receivedQuantity: number;
  shippedQuantity: number;
  writtenOffQuantity: number;
  currentQuantity: number;
  currentCells: Array<{
    boxId: string | null;
    boxCode: string;
    palletCode: string | null;
    palletSortCode: string | null;
    storageZone: { id: string; code: string; name: string } | null;
    placementSource: string | null;
    status: string;
    quantity: number;
  }>;
  kiz: Array<{
    id: string;
    value: string;
    status: string;
    createdAt: string;
  }>;
  movements: Array<{
    id: string;
    date: string;
    type: TurnoverMovementType;
    typeLabel: string;
    status: string;
    statusLabel: string;
    quantity: number;
    boxCode: string | null;
    palletCode: string | null;
    sourceDocument: string | null;
    request: {
      id: string;
      title: string;
      status: string;
      destinationCity: string | null;
      createdAt: string;
    } | null;
    comment: string | null;
    kiz: string[];
  }>;
};

export type TurnoverReport = {
  generatedAt: string;
  filters: Record<string, string | null>;
  totals: {
    skuCount: number;
    currentQuantity: number;
    receivedQuantity: number;
    shippedQuantity: number;
    writtenOffQuantity: number;
  };
  items: TurnoverSkuReport[];
};

// ADDED: read-only FBS/WMS report contracts. These endpoints never mutate stock.
export type FbsShipmentReport = {
  period: { dateFrom: string; dateTo: string };
  summary: { orders: number; units: number };
  daily: Array<{ date: string; orders: number; units: number }>;
  items: Array<{
    orderId: string;
    marketplace: string;
    shippedAt: string;
    warehouseId: string | null;
    warehouse: string;
    units: number;
    requestNumber: number;
  }>;
  pagination: { page: number; pageSize: number; total: number; pages: number };
  generatedAt: string;
};

export type FbsBoxStockReport = {
  withoutPallet: {
    summary: { boxes: number; units: number; rows: number };
    items: Array<{
      boxCode: string;
      warehouse: string;
      location: string;
      status: string;
      barcode: string;
      article: string;
      quantity: number;
      boxTotal: number;
    }>;
    pagination: { page: number; pageSize: number; total: number; pages: number };
  };
  onPallet: {
    summary: { boxes: number; units: number; barcodes: number; pallets: number };
    items: Array<{ palletCode: string; barcode: string; quantity: number; boxes: number }>;
    pagination: { page: number; pageSize: number; total: number; pages: number };
  };
  generatedAt: string;
};

export type WmsAvailabilityReport = {
  totals: { total: number; reserved: number; available: number; barcodes: number };
  missingBarcodeCount: number;
  generatedAt: string;
};

export type TurnoverKizReportRow = {
  id: string;
  assemblyId: string;
  clientId: string;
  clientName: string;
  requestId: string;
  requestNumber: number;
  requestTitle: string;
  orderId: string | null;
  supplyId: string | null;
  skuId: string;
  internalSku: string;
  barcode: string | null;
  article: string | null;
  productName: string;
  color: string | null;
  size: string | null;
  kiz: string;
  sourceBoxCode: string | null;
  arrivalAt: string | null;
  shippedAt: string;
  stickerPartB: string | null;
  stickerBarcode: string | null;
  assemblyStatus: string | null;
  wbCategory: string | null;
  wbSupplierStatus: string | null;
  wbStatus: string | null;
  wbStatusUpdatedAt: string | null;
};

export type TurnoverKizReport = {
  generatedAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  filters: { dateFrom: string | null; dateTo: string | null; search: string | null };
  pagination: { page: number; limit: number; total: number; pages: number };
  items: TurnoverKizReportRow[];
};

export type TurnoverStatistics = {
  generatedAt: string;
  filters: Record<string, string | null>;
  groupBy: 'day' | 'month' | 'quarter' | 'year';
  totals: {
    receivedQuantity: number;
    shippedQuantity: number;
    writtenOffQuantity: number;
    currentQuantity: number;
  };
  rows: Array<{
    skuId: string;
    clientId: string;
    client: Pick<ClientSummary, 'id' | 'code' | 'name'> | null;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    name: string;
    primaryBarcode: string | null;
    receivedQuantity: number;
    shippedQuantity: number;
    writtenOffQuantity: number;
    currentQuantity: number;
  }>;
  trend: Array<{
    period: string;
    receivedQuantity: number;
    shippedQuantity: number;
    writtenOffQuantity: number;
  }>;
  clientWidgetCandidate: boolean;
};

export type TurnoverActionPayload = {
  clientId: string;
  skuId?: string;
  barcode?: string;
  action: TurnoverActionKind;
  quantity: number;
  sourceBoxCode?: string;
  sourceBalanceId?: string; // ADDED: exact stock row being corrected.
  targetBarcode?: string; // ADDED: barcode of the correct SKU.
  targetBoxCode?: string;
  reason?: string;
  kiz?: string;
  photoFileName?: string;
  comment?: string;
  idempotencyKey?: string;
};

export type TurnoverActionResult = {
  status: 'APPLIED' | 'ALREADY_APPLIED';
  idempotencyKey: string;
  skuId?: string;
  skuName?: string;
  quantity?: number;
  targetBoxCode?: string | null;
};

export type TurnoverSuggestions = {
  products: Array<{
    skuId: string;
    client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
    label: string;
    name: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    color: string | null;
    size: string | null;
    barcode: string | null;
    quantity: number;
    boxCode: string | null;
    status: string | null;
  }>;
  barcodes: Array<{
    value: string;
    label: string;
    skuId: string;
    client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
    name: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    color: string | null;
    size: string | null;
  }>;
  kiz: Array<{
    id: string;
    value: string;
    status: string;
    skuId: string;
    name: string;
    internalSku: string;
    article: string | null;
    barcode: string | null;
    boxCode: string | null;
  }>;
  boxes: Array<{
    id: string;
    value: string;
    code: string;
    status: string;
  }>;
};

export type MarketplaceConnectionCheckResult = {
  connectionId: string;
  clientId: string;
  marketplace: MarketplaceType;
  checkedAt: string;
  ok: boolean;
  checks: Array<{
    key: 'products' | 'fbsOrders' | 'warehouses';
    label: string;
    ok: boolean;
    message: string;
  }>;
};

export type TurnoverBoxDetails = {
  generatedAt: string;
  box: {
    id: string;
    code: string;
    status: string;
    client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
    storagePlacement: {
      source: string;
      scannedAt: string;
      pallet: {
        id: string;
        code: string;
        zone: { id: string; code: string; name: string } | null;
      };
    } | null;
  };
  totals: {
    rows: number;
    skuCount: number;
    quantity: number;
    kizCount: number;
  };
  contents: Array<{
    balanceId: string;
    skuId: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    name: string;
    color: string | null;
    size: string | null;
    barcode: string | null;
    status: string;
    statusLabel: string;
    quantity: number;
    kiz: string[];
    kizCount: number;
  }>;
  movements: Array<{
    id: string;
    date: string;
    type: TurnoverMovementType;
    typeLabel: string;
    status: string;
    statusLabel: string;
    quantity: number;
    skuId: string;
    name: string;
    barcode: string | null;
    sourceDocument: string | null;
    comment: string | null;
  }>;
};

export type TurnoverMovementDocument = {
  movementId: string;
  sourceDocument: string | null;
  type: TurnoverMovementType;
  typeLabel: string;
  generatedAt: string;
  periodFrom: string;
  periodTo: string;
  totalQuantity: number;
  skuCount: number;
  boxesCount: number;
  fileName: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  rows: Array<{
    position: number;
    movementId: string;
    date: string;
    boxCode: string | null;
    barcode: string | null;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    name: string;
    quantity: number;
    status: string;
    statusLabel: string;
    kiz: string | null;
    sourceRows: number[];
    comment: string | null;
  }>;
};

export type ServiceKizSearchRow = {
  id: string;
  value: string;
  sourceDocument: string | null;
  sourceRow: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  sku: {
    id: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    name: string;
    barcodes: Array<{ value: string }>;
  };
  box: { id: string; code: string; status: string } | null;
  stockMovement: {
    id: string;
    type: string;
    status: string;
    sourceDocument: string | null;
    comment: string | null;
    createdAt: string;
  } | null;
};

export type BillingStorageBreakdown = {
  chargeId: string;
  description: string;
  periodFrom: string | null;
  periodTo: string | null;
  unitPriceRub: number;
  quantity: number;
  totalRub: number;
  canDeleteRows: boolean;
  rows: Array<{
    date: string;
    document: string;
    description: string;
    totalLiters: number;
    literDays: number;
    positions: number;
    unitPriceRub: number;
    totalRub: number;
  }>;
};

export type StorageOverviewRow = {
  skuId: string;
  barcode: string;
  name: string;
  internalSku: string;
  marketplaceArticle: string;
  size: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  volumeLiters: number;
  quantity: number;
  totalLiters: number;
  boxesCount: number;
  palletsCount: number;
  boxCodes: string[];
  palletCodes: string[];
  firstReceiptDate: string | null;
  literDays: number;
  storageCostRub: number;
};

export type StorageOverview = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'> & {
    storageAccountingEnabled: boolean;
    storagePriceRubPerLiterDay: string | number | null;
  };
  periodFrom: string;
  periodTo: string;
  tariffRubPerLiterDay: number;
  totals: {
    skuCount: number;
    quantity: number;
    totalLiters: number;
    literDays: number;
    storageCostRub: number;
  };
  rows: StorageOverviewRow[];
  daily: Array<{
    date: string;
    totalLiters: number;
    literDays: number;
    positions: number;
  }>;
  dailyRows: Array<{
    date: string;
    skuId: string;
    barcode: string;
    name: string;
    internalSku: string;
    marketplaceArticle: string;
    size: string;
    quantity: number;
    volumeLiters: number;
    totalLiters: number;
    literDays: number;
  }>;
  skippedWithoutVolume: number;
};

export type SkuSummary = {
  id: string;
  clientId: string;
  client?: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  internalSku: string;
  clientSku: string | null;
  article: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  color: string | null;
  size: string | null;
  weightGrams: string | number | null;
  lengthCm: string | number | null;
  widthCm: string | number | null;
  heightCm: string | number | null;
  volumeLiters: string | number | null;
  volumeSource: string;
  needsChestnyZnak: boolean;
  isUnmarked: boolean;
  needsLabel: boolean;
  needsRelabel: boolean;
  isDraft: boolean;
  draftSource: string | null;
  marketplace: MarketplaceType | null;
  marketplaceProductId: string | null;
  marketplaceOfferId: string | null;
  marketplacePayload: unknown | null;
  marketplaceSyncedAt: string | null;
  marketplacePhotos: string[];
  marketplaceCharacteristics: Array<{ name: string; value: string }>;
  barcodes: Array<{
    id: string;
    value: string;
    isPrimary: boolean;
  }>;
  _count?: {
    balances: number;
    movements: number;
  };
};

export type SkuDetail = SkuSummary & {
  balances?: Array<{
    id: string;
    clientId: string;
    skuId: string;
    boxId: string | null;
    palletId: string | null;
    status: string;
    quantity: number;
    updatedAt: string;
    box: { id: string; code: string; status: string } | null;
    pallet: { id: string; code: string; status: string } | null;
  }>;
};

export type BulkSkuVolumeItem = Pick<
  SkuSummary,
  | 'id'
  | 'internalSku'
  | 'clientSku'
  | 'article'
  | 'name'
  | 'lengthCm'
  | 'widthCm'
  | 'heightCm'
  | 'volumeLiters'
  | 'volumeSource'
  | 'barcodes'
>;

export type BulkSkuVolumeData = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  volumes: Array<{ key: string; value: number | null; count: number }>;
  items: BulkSkuVolumeItem[];
  total: number;
};

export type BulkSkuVolumeResult = {
  clientId: string;
  sourceVolumeFrom: number;
  sourceVolumeTo: number;
  newVolumeLiters: number;
  updated: number;
};

export type CreateSkuPayload = {
  clientId: string;
  internalSku: string;
  clientSku?: string;
  article?: string;
  name: string;
  barcode?: string;
  photoUrls?: string[];
  brand?: string;
  category?: string;
  color?: string;
  size?: string;
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  volumeLiters?: number;
  needsChestnyZnak?: boolean;
  isUnmarked?: boolean;
  needsLabel?: boolean;
  needsRelabel?: boolean;
};

export type UpdateSkuPayload = Partial<CreateSkuPayload> & {
  brand?: string;
  category?: string;
  weightGrams?: number;
  isUnmarked?: boolean;
  needsLabel?: boolean;
  needsRelabel?: boolean;
  isDraft?: boolean;
};

export type SkuDraftImportResult = {
  fileName: string;
  summary: {
    sourceRows: number;
    rows: number;
    barcodes: number;
    created: number;
    updated: number;
    completedDrafts: number;
    skipped: number;
    errors: number;
    warnings: number;
  };
  issues: Array<{
    row: number;
    barcode?: string;
    message: string;
    severity: 'warning' | 'error';
  }>;
  items: SkuSummary[];
};

export type WarehouseBoxSummary = {
  id: string;
  clientId: string;
  zoneId: string | null;
  palletId: string | null;
  code: string;
  status: string;
  client: ClientSummary;
  zone: {
    id: string;
    code: string;
    name: string;
  } | null;
  pallet: {
    id: string;
    code: string;
    status: string;
  } | null;
  storagePlacement: {
    id: string;
    source: string;
    scannedAt: string;
    pallet: {
      id: string;
      code: string;
      zone: {
        id: string;
        code: string;
        name: string;
      } | null;
    };
  } | null;
  _count: {
    balances: number;
    movements: number;
  };
};

export type WarehouseBoxCheckDecision =
  | 'PENDING'
  | 'WRITE_OFF'
  | 'KEEP_AS_IS'
  | 'SET_QUANTITY';

export type WarehouseBoxCheckRow = {
  id: string;
  checkId: string;
  boxId: string | null;
  boxCode: string;
  clientId: string;
  clientName: string;
  skuId: string | null;
  internalSku: string;
  skuName: string;
  barcode: string | null;
  currentQuantity: number;
  suspectQuantity: number;
  relabelQuantity: number;
  fbsPickedQuantity: number;
  restoredQuantity: number;
  markCount: number;
  excessMarkCount: number;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  reasonCode: string;
  reasonLabel: string;
  evidence: {
    relabelOrders?: string[];
    restoredDocuments?: string[];
    periodFrom?: string;
    periodTo?: string;
  } | null;
  decision: WarehouseBoxCheckDecision;
  decidedQuantity: number | null;
  beforeQuantity: number | null;
  afterQuantity: number | null;
  decisionComment: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WarehouseBoxCheck = {
  id: string;
  periodFrom: string;
  periodTo: string;
  clientId: string | null;
  boxesChecked: number;
  findingsCount: number;
  probableUnits: number;
  highConfidenceRows: number;
  createdByUserId: string;
  createdByName: string;
  rows: WarehouseBoxCheckRow[];
  createdAt: string;
  updatedAt: string;
};

export type ShippedKizHistoryRow = {
  id: string;
  assemblyId: string;
  clientId: string;
  clientName: string;
  requestId: string;
  requestNumber: number;
  requestTitle: string;
  orderId: string | null;
  supplyId: string | null;
  skuId: string;
  internalSku: string;
  barcode: string | null;
  article: string | null;
  productName: string;
  color: string | null;
  size: string | null;
  kiz: string;
  sourceBoxCode: string | null;
  arrivalAt: string | null;
  shippedAt: string;
  createdAt: string;
};

export type WarehousePalletSummary = {
  id: string;
  clientId: string;
  zoneId: string | null;
  code: string;
  status: string;
  client: ClientSummary;
  zone: {
    id: string;
    code: string;
    name: string;
  } | null;
  boxes: Array<{
    id: string;
    code: string;
    status: string;
  }>;
  _count: {
    balances: number;
  };
};

export type StorageLayout = {
  warehouse: {
    id: string;
    code: string;
    name: string;
  };
  codePrefixes: {
    pallet: string;
    storageCell: string;
    rackSlot: string;
    rack: string;
    storageBox: string;
  };
  zones: Array<{
    id: string;
    warehouseId: string;
    code: string;
    name: string;
    palletCount: number;
    boxCount: number;
  }>;
  pallets: Array<{
    id: string;
    warehouseId: string;
    clientId: string;
    zoneId: string | null;
    code: string;
    status: string;
    source: string;
    client: {
      id: string;
      code: string;
      name: string;
    };
    deviceCode: string | null;
    workerName: string | null;
    lastSyncedAt: string | null;
    closedAt: string | null;
    updatedAt: string;
    zone: {
      id: string;
      code: string;
      name: string;
    } | null;
    boxes: Array<{
      id: string;
      boxId: string | null;
      boxCode: string;
      source: string;
      scannedAt: string;
      box: {
        id: string;
        status: string;
        client: {
          id: string;
          code: string;
          name: string;
        };
      } | null;
    }>;
  }>;
  summary: {
    zones: number;
    pallets: number;
    boxes: number;
    unassignedPallets: number;
    boxesMissingInWms: number;
  };
  googleSync: {
    sourceUrl: string;
    lastSyncedAt: string | null;
    lastAttemptAt: string | null;
    error: string | null;
  };
};

export type OnlineReceiptOverview = {
  clientId: string;
  generatedAt: string;
  currentBatchDate: string | null;
  receipts: Array<{
    sourceDocument: string;
    boxes: number;
    quantity: number;
    kizCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    operators: string[];
    devices: string[];
  }>;
  boxes: OnlineReceiptBoxSummary[];
  deletedBoxes?: OnlineReceiptBoxSummary[];
};

export type ReceiptBatchSummary = {
  id: string;
  date: string;
  title: string;
  boxes: number;
  quantity: number;
  kizCount: number;
  boxCodes: string[];
};

export type GoodsArrivalSummary = {
  id: string;
  clientId: string;
  arrivalDate: string;
  bagCount: number;
  boxCount: number;
  comment: string | null;
  status: string;
  billingInvoiceId: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type GoodsArrivalEstimate = {
  clientId: string;
  periodFrom: string;
  periodTo: string;
  bagCount: number;
  boxCount: number;
  bagPriceRub: number;
  boxPriceRub: number;
  estimatedRub: number;
  pricesConfigured: boolean;
};

export type OnlineReceiptBoxSummary = {
  key: string;
  boxId: string | null;
  boxCode: string;
  sourceDocument: string;
  status: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  openedAt: string | null;
  closedAt: string | null;
  deletedAt?: string | null;
  operator: string | null;
  deviceCode: string | null;
  sourceDocuments?: string[];
  totalQuantity: number;
  kizCount: number;
  items: OnlineReceiptItemSummary[];
  currentBalances: Array<{
    balanceId: string;
    skuId: string;
    barcode: string;
    name: string;
    quantity: number;
    status: string;
  }>;
  kizValues: Array<{
    id: string;
    skuId: string;
    value: string;
    status: string;
  }>;
};

export type OnlineReceiptItemSummary = {
  movementId: string;
  skuId: string;
  barcode: string;
  name: string;
  article: string;
  color: string | null;
  size: string | null;
  quantity: number;
  kiz: string | null;
  kizId: string | null;
  hasError: boolean;
  errorMessage: string | null;
  duplicateBoxCode: string | null;
  status: string;
  sourceDocument: string;
  createdAt: string;
  operatorName: string | null;
  deviceCode: string | null;
};

export type OnlineReceiptItemPayload = {
  clientId: string;
  boxCode: string;
  sourceDocument?: string;
  barcode?: string;
  skuId?: string;
  kiz?: string;
  quantity?: number;
  comment?: string;
};

export type TransferBetweenBoxesPayload = {
  clientId: string;
  skuId?: string;
  barcode?: string;
  fromBoxCode: string;
  toBoxCode: string;
  quantity: number;
  status?: string;
  idempotencyKey: string;
  comment?: string;
};

export type TransferBetweenBoxesResult = {
  idempotencyKey: string;
  status: 'APPLIED' | 'ALREADY_APPLIED';
  skuId?: string;
  fromBox?: string;
  toBox?: string;
  quantity?: number;
  targetBalance?: {
    id: string;
    balanceKey: string;
    clientId: string;
    skuId: string;
    boxId: string | null;
    palletId: string | null;
    status: string;
    quantity: number;
    updatedAt: string;
  };
};

export type BoxTransferPreviewRow = {
  rowNumber: number;
  fromBoxCode: string;
  barcode: string;
  toBoxCode: string;
  quantity: number;
  status: 'READY' | 'ERROR' | 'APPLIED' | 'REJECTED';
  message: string;
  errors: string[];
  skuId?: string;
  skuName?: string;
  internalSku?: string;
  availableQuantity: number;
  targetBoxExists: boolean;
  stockStatus?: string;
  idempotencyKey?: string;
};

export type BoxTransferPreview = {
  clientId: string;
  fileName: string;
  summary: {
    rows: number;
    readyRows: number;
    errorRows: number;
    quantity: number;
  };
  rows: BoxTransferPreviewRow[];
};

export type StockTransferBatch = {
  id: string;
  clientId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'APPLIED' | 'APPLIED_WITH_ERRORS' | 'REVERSED' | string;
  rowCount: number;
  appliedRowCount: number;
  rejectedRowCount: number;
  quantity: number;
  rows: BoxTransferPreviewRow[];
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  reversedByUserId: string | null;
  reversedByName: string | null;
  reversedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BoxTransferCommitResult = {
  status: 'APPLIED' | 'APPLIED_WITH_ERRORS';
  rows: number;
  quantity: number;
  results: Array<TransferBetweenBoxesResult & { rowNumber: number }>;
  preview: BoxTransferPreview;
  batch: StockTransferBatch;
};

type FulfillmentAllocation = {
  boxId: string | null;
  palletId: string | null;
  quantity: number;
};

type FulfillmentLineBase = {
  itemId: string;
  skuId: string;
  requestedQuantity: number;
  allocations: FulfillmentAllocation[];
};

export type PickClientRequestResult = {
  idempotencyKey: string;
  status: 'APPLIED' | 'ALREADY_APPLIED';
  requestId: string;
  clientId?: string;
  pickedLines?: Array<
    FulfillmentLineBase & {
    pickedQuantity: number;
    }
  >;
};

export type FulfillClientRequestResult = {
  idempotencyKey: string;
  status: 'APPLIED' | 'ALREADY_APPLIED';
  requestId: string;
  clientId?: string;
  packedLines?: Array<
    FulfillmentLineBase & {
      packedQuantity: number;
    }
  >;
  packages?: ClientRequestPackage[];
  shippedLines?: Array<
    FulfillmentLineBase & {
      shippedQuantity: number;
    }
  >;
};

export type RoleSummary = {
  id: string;
  code: string;
  name: string;
  permissions: Array<{
    code: string;
    name: string;
  }>;
};

export type UserClientScope = {
  canRead: boolean;
  canWrite: boolean;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
};

export type UserPrinterScope = {
  groupCode: string;
  canPrint: boolean;
  canManage: boolean;
};

export type UserSummary = {
  id: string;
  email: string;
  name: string;
  status: string;
  analyticsEnabled: boolean;
  activeWarehouseId?: string | null;
  createdAt?: string;
  hasTsdActivationCode?: boolean;
  roles: Array<{
    role: {
      code: string;
      name: string;
    };
  }>;
  clientScopes: UserClientScope[];
  printerScopes: UserPrinterScope[];
  warehouseScopes?: Array<{
    canRead: boolean;
    canWrite: boolean;
    warehouse: Pick<BranchSummary, 'id' | 'code' | 'name' | 'city'>;
  }>;
};

export type UserReferralClientSummary = {
  clientId: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  percent: number;
  isActive: boolean;
  startsAt: string;
  expiresAt: string | null;
  termMonths: number | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type CreateUserPayload = {
  email: string;
  name: string;
  password: string;
  roleCodes?: string[];
  clientIds?: string[];
  writableClientIds?: string[];
  warehouseId?: string;
};

export type UpdateUserClientScopesPayload = {
  allClients?: boolean;
  scopes: Array<{
    clientId: string;
    canRead?: boolean;
    canWrite?: boolean;
  }>;
};

export type UpdateUserReferralClientsPayload = {
  assignments: Array<{
    clientId: string;
    percent: number;
    termMonths?: number | null;
    isActive?: boolean;
  }>;
};

export type ReferralReportServiceRow = {
  serviceId: string | null;
  serviceCode: string | null;
  serviceName: string;
  quantity: number;
  totalRub: number;
  chargesCount: number;
};

export type ReferralReportClientRow = {
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  percent: number;
  startsAt: string;
  expiresAt: string | null;
  termMonths: number | null;
  servicesRub: number;
  referralRub: number;
  chargesCount: number;
  latestServiceAt: string | null;
  services: ReferralReportServiceRow[];
};

export type ReferralReport = {
  generatedAt: string;
  periodFrom: string;
  periodTo: string;
  totals: {
    clientsCount: number;
    servicesRub: number;
    referralRub: number;
    chargesCount: number;
  };
  clients: ReferralReportClientRow[];
};

export type UpdateUserRolesPayload = {
  roleCodes: string[];
};

export type UpdateUserProfilePayload = {
  email?: string;
  name?: string;
  password?: string;
  status?: string;
  analyticsEnabled?: boolean;
  warehouseId?: string | null;
};

export type UpdateUserPrinterScopesPayload = {
  scopes: Array<{
    groupCode: string;
    canPrint?: boolean;
    canManage?: boolean;
  }>;
};

export type TsdDeviceSummary = {
  id: string;
  code: string;
  name: string;
  status: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
  };
};

export type CreateTsdDevicePayload = {
  code: string;
  name: string;
  userId: string;
};

export type CreatedTsdDevice = Omit<TsdDeviceSummary, 'lastLoginAt' | 'lastSeenAt' | 'user'> & {
  userId: string;
  deviceSecret: string;
};

export type TsdReviewReason =
  | 'INVENTORY_MISMATCH'
  | 'SKU_NOT_FOUND'
  | 'BOX_NOT_FOUND'
  | 'RECEIPT_FAILED'
  | 'DEVICE_MISMATCH'
  | 'VALIDATION_ERROR'
  | 'MANUAL_REJECT'
  | 'OTHER';

export type TsdReviewOperation = {
  id: string;
  deviceId: string;
  operationKey: string;
  operationType: string;
  payload: Record<string, unknown>;
  status: 'ACCEPTED' | 'NEEDS_REVIEW' | 'REJECTED';
  serverMessage: string | null;
  reviewReason: TsdReviewReason | null;
  resolutionMessage: string | null;
  reviewAction: 'APPLY_INVENTORY_ADJUSTMENT' | 'REJECT' | null;
  reviewComment: string | null;
  reviewedByUserId: string | null;
  reviewedBy?: {
    id: string;
    email: string;
    name: string;
  } | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TsdOperationHistoryItem = TsdReviewOperation & {
  device: { id: string | null; code: string; name: string };
  actor: { id: string | null; name: string; email: string | null } | null;
  hasScreenshot: boolean;
  screenshotCapturedAt: string | null;
};

export type TsdOperationHistoryPage = {
  items: TsdOperationHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type TsdOperationHistoryFilters = {
  dateFrom?: string;
  dateTo?: string;
  deviceId?: string;
  operationType?: string;
  status?: TsdOperationHistoryItem['status'] | '';
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ResolveTsdReviewPayload = {
  action: 'APPLY_INVENTORY_ADJUSTMENT' | 'ACCEPT_RECEIPT_WITH_ERROR' | 'REJECT';
  comment?: string;
  reason?: TsdReviewReason;
};

export type TsdReceiptReviewResult = 'ACCEPTED' | 'NOT_ACCEPTED' | 'ACCEPTED_WITH_ERROR' | 'REJECTED';

export type TsdReceiptKizAssessmentKind =
  | 'NOT_PROVIDED'
  | 'ALREADY_IN_TARGET_BOX'
  | 'REGISTERED_IN_OTHER_BOX'
  | 'REGISTERED_WITHOUT_BOX'
  | 'REPEATED_SCAN'
  | 'SCANNED_IN_MULTIPLE_BOXES'
  | 'UNCONFIRMED';

export type TsdReceiptReviewItem = {
  id: string;
  operationKey: string;
  result: TsdReceiptReviewResult;
  client: { id: string; code: string; name: string };
  boxCode: string;
  sourceDocument: string;
  quantity: number;
  barcode: string;
  kiz: string;
  sku: {
    id: string;
    internalSku: string;
    article: string | null;
    name: string;
    color: string | null;
    size: string | null;
    barcode: string;
  } | null;
  duplicate: {
    markId: string;
    boxCode: string | null;
    skuId: string;
    name: string;
    article: string;
    color: string | null;
    size: string | null;
    barcode: string;
  } | null;
  kizAssessment: {
    kind: TsdReceiptKizAssessmentKind;
    label: string;
    likelyAccidental: boolean | null;
    scanOccurrences: number;
    scannedBoxCodes: string[];
    registeredBoxCode: string | null;
    guidance: string;
  };
  reviewReason: TsdReviewReason | null;
  message: string | null;
  deviceCode: string;
  operatorName: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type TsdReceiptReviewBoxCheck = {
  client: { id: string; code: string; name: string };
  boxCode: string;
  boxExists: boolean;
  accountedQuantity: number;
  notAcceptedQuantity: number;
  maximumPhysicalQuantity: number;
  issueOperations: number;
  duplicateKizQuantity: number;
  lastIssueAt: string;
};

export type TsdReceiptReviewDashboard = {
  generatedAt: string;
  periodFrom: string;
  stats: {
    acceptedQuantity: number;
    notAcceptedQuantity: number;
    acceptedWithErrorQuantity: number;
    duplicateKizQuantity: number;
    totalOperations: number;
    shownOperations: number;
  };
  boxesToCheck: TsdReceiptReviewBoxCheck[];
  items: TsdReceiptReviewItem[];
};

export type ResolveTsdReviewResult = {
  operation: TsdReviewOperation;
  resolution: {
    action: ResolveTsdReviewPayload['action'];
    adjustment?: {
      idempotencyKey: string;
      status: 'APPLIED' | 'ALREADY_APPLIED' | 'NO_CHANGE';
      skuId?: string;
      box?: string;
      previousQuantity?: number;
      countedQuantity?: number;
      delta?: number;
    };
    receipt?: {
      status: 'APPLIED' | 'ALREADY_APPLIED';
      box?: string;
      quantity?: number;
      skuId?: string;
    };
    duplicate?: {
      boxCode: string | null;
      skuName: string;
    } | null;
  };
};

export type LogisticsTariffSetSummary = {
  id: string;
  name: string;
  sourceFile: string | null;
  note: string | null;
  activeFrom: string | null;
  activeTo: string | null;
  createdAt: string;
  _count: {
    directions: number;
  };
};

export type LogisticsRateTierSummary = {
  id: string;
  directionId: string;
  label: string;
  minPallets: number | null;
  maxPallets: number | null;
  maxBoxes: number | null;
  pricingMode: LogisticsPricingMode;
  priceRub: string | number;
};

export type LogisticsDirectionSummary = {
  id: string;
  tariffSetId: string;
  origin: string;
  destination: string;
  note: string | null;
  pricingMode: LogisticsPricingMode;
  tiers: LogisticsRateTierSummary[];
};

export type LogisticsTariffSetDetail = LogisticsTariffSetSummary & {
  directions: LogisticsDirectionSummary[];
};

export type LogisticsDestinationSuggestion = {
  value: string;
  label: string;
  description: string;
  origin: string;
  destination: string;
  tariffSetId: string;
  tariffSetName: string;
  sourceFile: string | null;
};

export type LogisticsQuotePayload = {
  tariffSetId?: string;
  destination: string;
  pallets?: number;
  boxes?: number;
  quoteDate?: string;
};

export type LogisticsQuoteResult = {
  tariffSet: {
    id: string;
    name: string;
    sourceFile: string | null;
  };
  route: {
    origin: string;
    destination: string;
  };
  input: {
    boxes: number | null;
    pallets: number | null;
  };
  tier: {
    label: string;
    minPallets: number | null;
    maxPallets: number | null;
    maxBoxes: number | null;
    pricingMode: LogisticsPricingMode;
    priceRub: number;
  };
  estimatedTotalRub: number | null;
  requiresManualReview: boolean;
  note: string | null;
};

export type BoxLabelPreviewPayload = {
  boxCode: string;
  clientName: string;
  quantity?: number;
};

export type LabelPreview = {
  printerLanguage: 'TSPL';
  tspl: string;
  templateVersion?: number;
};

export type BoxLabelPreview = LabelPreview;

export type LabelTemplateType = 'BOX' | 'SKU' | 'PALLET' | 'CUSTOM';

export type LabelTemplateSummary = {
  id: string;
  code: string;
  name: string;
  type: LabelTemplateType;
  description: string | null;
  widthMm: number;
  heightMm: number;
  tspl: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LabelTemplateVersionSummary = {
  id: string;
  templateId: string;
  version: number;
  code: string;
  name: string;
  type: LabelTemplateType;
  description: string | null;
  widthMm: number;
  heightMm: number;
  tspl: string;
  isActive: boolean;
  changeReason: string | null;
  createdAt: string;
};

export type CreateLabelTemplatePayload = {
  code: string;
  name: string;
  type: LabelTemplateType;
  description?: string;
  widthMm?: number;
  heightMm?: number;
  tspl: string;
  isActive?: boolean;
};

export type UpdateLabelTemplatePayload = Partial<CreateLabelTemplatePayload> & {
  changeReason?: string;
};

export type PreviewLabelTemplatePayload = {
  variables?: Record<string, string | number | boolean | null>;
};

export type PrintJobStatus = 'queued' | 'sent' | 'printed' | 'failed' | 'cancelled';

export type PrintJobSummary = {
  id: string;
  printerCode: string;
  labelType: string;
  payload: Record<string, unknown>;
  tspl: string;
  status: PrintJobStatus;
  attempts: number;
  processedAt: string | null;
  createdAt: string;
};

export type PrintPrinterConnectionType = 'dry_run' | 'tcp';

export type PrintPrinterSummary = {
  id: string;
  code: string;
  groupCode: string;
  name: string;
  connectionType: PrintPrinterConnectionType;
  host: string | null;
  port: number | null;
  isActive: boolean;
  autoProcess: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertPrintPrinterPayload = {
  code: string;
  name: string;
  groupCode?: string;
  connectionType?: PrintPrinterConnectionType;
  host?: string;
  port?: number;
  isActive?: boolean;
  autoProcess?: boolean;
};

export type PrintPrinterGroupSummary = {
  groupCode: string;
};

export type ProcessPrintQueueResult = {
  processed: number;
  printed: number;
  sent: number;
  failed: number;
  skipped: number;
};

export type CreatePrintJobFromTemplatePayload = {
  printerCode: string;
  variables?: Record<string, string | number | boolean | null>;
  copies?: number;
};

export type SkuLabelPreviewPayload = {
  skuCode: string;
  name: string;
  barcode?: string;
  clientName?: string;
  article?: string;
  color?: string;
  size?: string;
};

export type PalletLabelPreviewPayload = {
  palletCode: string;
  clientName: string;
  zoneCode?: string;
  boxesCount?: number;
};

export type StockImportIssue = {
  row: number;
  message: string;
  severity: 'warning' | 'error';
};

export type StockImportSuggestion = {
  row: number;
  type: 'FILL_BARCODE_FROM_CATALOG';
  title: string;
  message: string;
  barcode?: string;
  name?: string;
  article?: string | null;
  color?: string | null;
  size?: string | null;
  applied: boolean;
};

export type StockImportSummary = {
  rows: number;
  boxes: number;
  barcodes: number;
  totalQuantity: number;
};

export type ReceiptImportSummary = StockImportSummary & {
  kiz: number;
};

export type StockImportSampleItem = {
  clientId: string;
  boxCode: string;
  barcode: string;
  name: string;
  color?: string;
  size?: string;
  quantity: number;
  sourceRow: number;
};

export type StockImportPreview = {
  clientId: string;
  summary: StockImportSummary;
  issues: StockImportIssue[];
  suggestions?: StockImportSuggestion[];
  sample: StockImportSampleItem[];
};

export type ReceiptImportSampleItem = StockImportSampleItem & {
  kiz: string;
};

export type ReceiptImportPreview = {
  clientId: string;
  summary: ReceiptImportSummary;
  issues: StockImportIssue[];
  sample: ReceiptImportSampleItem[];
};

export type StockImportCommitResult = {
  sourceDocument: string;
  summary: StockImportSummary;
  suggestions?: StockImportSuggestion[];
  warnings: StockImportIssue[];
  result: {
    boxesTouched: number;
    skusTouched: number;
    movementsCreated: number;
    balancesTouched: number;
  };
};

export type ReceiptImportCommitResult = {
  sourceDocument: string;
  summary: ReceiptImportSummary;
  warnings: StockImportIssue[];
  result: {
    boxesTouched: number;
    skusTouched: number;
    movementsCreated: number;
    balancesTouched: number;
    kizCreated: number;
  };
};

export type LogisticsPricingMode = 'TOTAL' | 'PER_PALLET' | 'MANUAL_REVIEW';

export type LogisticsDeliveryStatus = 'REQUESTED' | 'QUOTED' | 'PLANNED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';

export type LogisticsTripStatus = 'PLANNED' | 'LOADING' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

export type LogisticsCarrierSummary = {
  id: string;
  name: string;
  phone: string | null;
  contactName: string | null;
  comment: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    trips: number;
  };
};

export type LogisticsTripSummary = {
  id: string;
  code: string;
  carrierId: string | null;
  plannedDate: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  status: LogisticsTripStatus;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  carrier: Pick<LogisticsCarrierSummary, 'id' | 'name' | 'phone' | 'contactName' | 'isActive'> | null;
  deliveries: Array<{
    id: string;
    clientId: string;
    origin: string;
    destination: string;
    boxes: number | null;
    pallets: number | null;
    desiredShipDate: string | null;
    plannedShipDate: string | null;
    status: LogisticsDeliveryStatus;
    client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  }>;
};

export type LogisticsDeliveryRequestSummary = {
  id: string;
  clientId: string;
  requestId: string | null;
  tariffSetId: string | null;
  billingChargeId: string | null;
  tripId: string | null;
  origin: string;
  destination: string;
  boxes: number | null;
  pallets: number | null;
  desiredShipDate: string | null;
  plannedShipDate: string | null;
  status: LogisticsDeliveryStatus;
  estimatedTotalRub: string | number | null;
  requiresManualReview: boolean;
  comment: string | null;
  managerComment: string | null;
  createdAt: string;
  updatedAt: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  request: Pick<ClientRequestSummary, 'id' | 'title' | 'type' | 'status'> | null;
  tariffSet: Pick<LogisticsTariffSetSummary, 'id' | 'name'> | null;
  billingCharge: Pick<BillingChargeSummary, 'id' | 'description' | 'status' | 'totalRub'> | null;
  trip: Pick<LogisticsTripSummary, 'id' | 'code' | 'plannedDate' | 'status' | 'vehicleNumber' | 'driverName'> & {
    carrier: Pick<LogisticsCarrierSummary, 'id' | 'name' | 'phone'> | null;
  } | null;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type CreateLogisticsDeliveryRequestPayload = {
  clientId: string;
  requestId?: string;
  tariffSetId?: string;
  destination: string;
  boxes?: number;
  pallets?: number;
  desiredShipDate?: string;
  comment?: string;
};

export type FinalizeLogisticsDeliveryQuotePayload = {
  estimatedTotalRub: number;
  managerComment?: string;
};

export type CreateLogisticsCarrierPayload = {
  name: string;
  phone?: string;
  contactName?: string;
  comment?: string;
};

export type CreateLogisticsTripPayload = {
  code?: string;
  carrierId?: string;
  plannedDate?: string;
  vehicleNumber?: string;
  driverName?: string;
  driverPhone?: string;
  comment?: string;
};

export type LogisticsImportTier = {
  label: string;
  priceRub: number;
  minPallets?: number;
  maxPallets?: number;
  maxBoxes?: number;
  pricingMode: LogisticsPricingMode;
};

export type LogisticsImportDirection = {
  origin: string;
  destination: string;
  pricingMode: LogisticsPricingMode;
  tiers: LogisticsImportTier[];
};

export type LogisticsImportIssue = {
  row: number;
  message: string;
};

export type LogisticsImportPreview = {
  note: string;
  directionsCount: number;
  directions: LogisticsImportDirection[];
  issues: LogisticsImportIssue[];
};

export type LogisticsImportCommitResult = {
  tariffSetId: string;
  name: string;
  sourceFile: string | null;
  directionsCount: number;
  tiersCount: number;
};

type LoginPayload = {
  email: string;
  password: string;
};

type BootstrapPayload = LoginPayload & {
  name: string;
  bootstrapSecret: string;
};

export type AdministrationOverview = {
  owner: { id: string; name: string; email: string };
  metrics: Record<string, number>;
  system: {
    apiUptimeSeconds: number;
    memoryMb: number;
    nodeVersion: string;
    environment: string;
  };
  boxCodePolicy: BoxCodePolicy;
  ai: {
    settings: Record<string, unknown>;
    apiKeyConfigured: boolean;
    liveProviderAvailable: boolean;
    mode: string;
  };
  safeguards: Record<string, boolean>;
};

export type AdministrationTechnicalWorkCategory =
  | 'REQUESTS'
  | 'PALLET_SORTS'
  | 'BOXES'
  | 'MARKETPLACE_STATUS';

export type AdministrationTechnicalWorkOverview = {
  checkedAt: string;
  activeRequests: number;
  statusProblems: number;
};

// ADDED: Internal API status describes loaded route groups and the dependency scope that was checked.
export type AdministrationInternalApiOverview = {
  checkedAt: string;
  scopeNote: string;
  summary: {
    modules: number;
    routes: number;
    working: number;
    degraded: number;
  };
  runtime: {
    status: 'WORKING';
    uptimeSeconds: number;
    startedAt: string;
    memoryMb: number;
    nodeVersion: string;
    environment: string;
  };
  dependencies: {
    database: {
      status: 'WORKING' | 'ERROR';
      latencyMs: number;
      message: string;
    };
  };
  restart: {
    enabled: boolean;
    scheduled: boolean;
    canRestart: boolean;
    confirmation: string;
    disabledReason: string | null;
  };
  modules: Array<{
    id: string;
    name: string;
    prefixes: string[];
    routeCount: number;
    description: string;
    logic: string[];
    dependencies: string[];
    status: 'WORKING' | 'DEGRADED';
    statusText: string;
  }>;
};

export type AdministrationInternalApiRestartResult = {
  accepted: true;
  acceptedAt: string;
  message: string;
};

export type AdministrationTechnicalWorkIssue = {
  id: string;
  category: AdministrationTechnicalWorkCategory;
  severity: 'WARNING' | 'CRITICAL';
  title: string;
  explanation: string;
  recommendation: string;
  request: {
    id: string;
    number: number;
    title: string;
    status: string;
    client: { id: string; code: string; name: string };
  } | null;
  orderId: string | null;
  objectCode: string | null;
  state: string;
  evidence: string[];
  actions: Array<{
    id: 'REPAIR_REQUEST_ROUTE' | 'RETURN_TO_STOCK' | 'MANAGER_CONFIRMED';
    label: string;
    tone: 'PRIMARY' | 'DANGER';
    confirmation: string;
    requiresComment: boolean;
  }>;
};

export type AdministrationTechnicalWorkDiagnosis = {
  category: AdministrationTechnicalWorkCategory;
  checkedAt: string;
  summary: { issues: number; uniqueObjects: number; critical: number; actionable: number };
  issues: AdministrationTechnicalWorkIssue[];
};

export type AdministrationPalletSortScanPreview = {
  checkedAt: string;
  pallet: {
    id: string | null;
    code: string;
    exists: boolean;
    willCreate: boolean;
    client: { id: string; code: string; name: string } | null;
    warehouse: { id: string; code: string; name: string } | null;
  };
  boxes: Array<{
    code: string;
    boxId: string | null;
    currentPalletCode: string | null;
    action: 'PLACE' | 'MOVE' | 'UNCHANGED' | 'ERROR';
  }>;
  affectedRequests: Array<{ id: string; number: number }>;
  errors: Array<{ code: string; message: string }>;
  summary: { requested: number; place: number; move: number; unchanged: number; affectedRequests: number };
  canApply: boolean;
  confirmation: 'РАЗМЕСТИТЬ';
};

export type AdministrationPalletSortScanResult = {
  applied: boolean;
  pallet: { id: string; code: string };
  placed: number;
  moved: number;
  unchanged: number;
  affectedRequests: number;
  repairedRequests: number;
  failedRoutes: Array<{ requestId: string; number: number; repaired: false; message: string }>;
  message: string;
};

export type AdministrationUnpalletedWriteoffBlocker =
  | 'NON_AVAILABLE_BALANCE'
  | 'ACTIVE_CLIENT_REQUEST'
  | 'ACTIVE_FBS_ASSEMBLY'
  | 'OPEN_INVENTORY'
  | 'FOREIGN_CLIENT_DATA'
  | 'ACTIVE_PICK_WAVE'
  | 'PENDING_BOX_CHECK';

export type AdministrationUnpalletedWriteoffWarning = 'KIZ_COUNT_MISMATCH';

export type AdministrationUnpalletedWriteoffPreview = {
  checkedAt: string;
  client: { id: string; code: string; name: string; stockBalanceMode: 'PALLET_SORT' };
  summary: {
    scanned: number;
    candidates: number;
    safe: number;
    blocked: number;
    units: number;
    safeUnits: number;
    warnings: number;
  };
  blockerSummary: Array<{
    blocker: AdministrationUnpalletedWriteoffBlocker;
    boxes: number;
    units: number;
  }>;
  warningSummary: Array<{
    warning: AdministrationUnpalletedWriteoffWarning;
    boxes: number;
    units: number;
  }>;
  rows: Array<{
    boxId: string;
    boxCode: string;
    warehouseId: string | null;
    quantity: number;
    statuses: string[];
    safe: boolean;
    blockers: AdministrationUnpalletedWriteoffBlocker[];
    warnings: AdministrationUnpalletedWriteoffWarning[];
  }>;
};

export type AdministrationUnpalletedBlockerRecheckResult = {
  fbs: { refreshed: boolean; error: string | null };
  inventory: { checked: number; completed: number; sessionIds: string[] };
  preview: AdministrationUnpalletedWriteoffPreview;
};

export type AdministrationUnpalletedWriteoffResult = {
  processed: number;
  archived: number;
  skipped: number;
  failed: number;
  unitsWrittenOff: number;
  results: Array<{
    boxId: string;
    boxCode: string | null;
    outcome: 'ARCHIVED' | 'SKIPPED' | 'ERROR';
    reason: string | null;
    unitsWrittenOff: number;
    marksBlocked: number;
    movementIds: string[];
  }>;
};

export type AdministrationTechnicalWorkBulkResult = {
  category: AdministrationTechnicalWorkCategory;
  action: AdministrationTechnicalWorkIssue['actions'][number]['id'];
  requestedIssues: number;
  operations: number;
  applied: number;
  failed: number;
  verified: number;
  verificationWarning: string | null;
  results: Array<{
    issueIds: string[];
    applied: boolean;
    verified: boolean;
    message: string;
  }>;
  diagnosis: AdministrationTechnicalWorkDiagnosis | null;
};

export type AdministrationTsdWorkloads = {
  checkedAt: string;
  summary: {
    registeredDevices: number;
    onlineDevices: number;
    busyDevices: number;
    tasks: number;
    protectedTasks: number;
  };
  devices: Array<{
    deviceCode: string;
    deviceId: string | null;
    deviceName: string | null;
    status: string | null;
    user: { id: string; name: string; email: string } | null;
    lastSeenAt: string | null;
    online: boolean;
    workloads: Array<{
      id: string;
      kind: 'FBS_ORDER' | 'REQUEST_SESSION';
      request: {
        id: string;
        number: number;
        title: string;
        status: string;
        client: { id: string; code: string; name: string };
      };
      orderId: string | null;
      stage: string;
      stageLabel: string;
      productName: string | null;
      article: string | null;
      sourceBoxCode: string | null;
      workerName: string | null;
      updatedAt: string;
      hasScans: boolean;
      protected: boolean;
      protectedReason: string | null;
    }>;
  }>;
};

export type TsdMonitoring = Omit<AdministrationTsdWorkloads, 'summary' | 'devices'> & {
  summary: AdministrationTsdWorkloads['summary'] & { errors24h: number };
  pickerStatistics: {
    period: { from: string; to: string; label: string };
    summary: { workers: number; orders: number; units: number };
    workers: Array<{
      workerId: string | null;
      workerName: string;
      deviceCodes: string[];
      orders: number;
      units: number;
      measuredOrders: number;
      totalDurationSeconds: number;
      averageDurationSeconds: number | null;
      orderDetails: Array<{
        taskId: string;
        orderId: string;
        requestId: string;
        requestNumber: number;
        clientName: string;
        productName: string;
        article: string | null;
        units: number;
        deviceCode: string;
        startedAt: string | null;
        completedAt: string;
        durationSeconds: number | null;
      }>;
    }>;
  };
  devices: Array<AdministrationTsdWorkloads['devices'][number] & {
    liveState: {
      screen?: string | null;
      screenLabel?: string | null;
      stage?: string | null;
      state?: string | null;
      requestId?: string | null;
      requestNumber?: number | null;
      clientName?: string | null;
      orderId?: string | null;
      productName?: string | null;
      boxCode?: string | null;
      total?: number | null;
      completed?: number | null;
      remaining?: number | null;
      accepted?: number | null;
      lastAction?: string | null;
      appVersion?: string | null;
      reportedAt?: string | null;
      inventorySessionId?: string | null;
      inventoryType?: string | null;
      inventoryMandatory?: boolean | null;
      inventoryBoxId?: string | null;
      inventoryBoxCode?: string | null;
    } | null;
    progress: { total: number; completed: number; remaining: number } | null;
    errors: Array<{
      id: string;
      message: string;
      screen: string | null;
      requestId: string | null;
      requestNumber: number | null;
      orderId: string | null;
      workerName: string | null;
      clientName: string | null;
      createdAt: string;
      status: string;
    }>;
    activity: Array<{
      id: string;
      type: string;
      status: string;
      message: string | null;
      stage: string | null;
      screen: string | null;
      requestId: string | null;
      requestNumber: number | null;
      orderId: string | null;
      workerName: string | null;
      clientName: string | null;
      boxCode: string | null;
      barcode: string | null;
      createdAt: string;
    }>;
  }>;
};

export type FbsStockMonitorStatus = 'SUCCESS' | 'ERROR' | 'PENDING' | 'UNAVAILABLE';

export type FbsStockMonitorEvent = {
  id: string;
  eventKey: string;
  clientId: string;
  connectionId: string;
  marketplace: 'WILDBERRIES';
  marketplaceWarehouseId: string | null;
  marketplaceWarehouseName: string | null;
  executionWarehouseId: string | null;
  orderId: string;
  orderUid: string | null;
  eventType: 'SALE' | 'CANCEL' | 'RETURN';
  sourceIds: Record<string, unknown> | null;
  skuId: string;
  productName: string;
  article: string | null;
  nmId: string | null;
  chrtId: number | null;
  barcode: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  saleAt: string;
  detectedAt: string;
  deadlineAt: string;
  wbBeforeAmount: number | null;
  wbExpectedAfterAmount: number | null;
  wbAfterAmount: number | null;
  wbCurrentAmount: number | null;
  wbStatus: FbsStockMonitorStatus;
  wbAttempts: number;
  wbMessage: string | null;
  wmsBeforeAmount: number | null;
  wmsExpectedAfterAmount: number | null;
  wmsAfterAmount: number | null;
  wmsCurrentAmount: number | null;
  wmsReservedAmount: number | null;
  wmsStatus: FbsStockMonitorStatus;
  wmsAttempts: number;
  wmsMessage: string | null;
  overallStatus: FbsStockMonitorStatus;
  nextCheckAt: string | null;
  lastCheckedAt: string | null;
  repairAvailable: boolean;
  repairInProgress: boolean;
};

export type FbsStockMonitorResponse = {
  checkedAt: string;
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  counts: Record<FbsStockMonitorStatus, number>;
  technical: {
    enabled: boolean;
    workerRunning: boolean;
    lastRunAt: string | null;
    lastRunCompletedAt: string | null;
    lastRunDurationMs: number | null;
    lastRunError: string | null;
    checks24h: number;
  };
  filters: {
    clients: Array<{ id: string; code: string; name: string }>;
    connections: Array<{
      id: string;
      clientId: string;
      accountName: string | null;
      fbsWarehouseId: string | null;
      fbsWarehouseName: string | null;
    }>;
    warehouses: Array<{ id: string | null; name: string | null }>;
  };
  items: FbsStockMonitorEvent[];
};

export type FbsStockMonitorEventDetail = FbsStockMonitorEvent & {
  history: Array<{
    id: string;
    eventId: string;
    system: 'WB' | 'WMS';
    kind: 'EVENT_DETECTED' | 'CHECK' | 'MANUAL_REPAIR';
    idempotencyKey: string | null;
    status: FbsStockMonitorStatus;
    attempt: number;
    beforeAmount: number | null;
    expectedAmount: number | null;
    currentAmount: number | null;
    reservedAmount: number | null;
    message: string | null;
    sourceIds: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

export type FbsStockMonitorRepairPreview = {
  eventId: string;
  article: string | null;
  barcode: string | null;
  currentWbAmount: number;
  currentWmsAvailableAmount: number;
  currentWmsReservedAmount: number;
  targetAmount: number;
  checkedAt: string;
};

export type FbsStockMonitorRepairResult = {
  success: boolean;
  corrected: boolean;
  idempotent: boolean;
  message: string;
  preview?: FbsStockMonitorRepairPreview;
  verification?: FbsStockMonitorRepairPreview;
  externalResponse?: Record<string, unknown> | null;
  event: FbsStockMonitorEventDetail;
};

export type FbsStockMonitorConfig = {
  clientId: string;
  connectionId: string;
  enabled: boolean;
  allowedDelaySeconds: number;
  retryIntervalSeconds: number;
  maxAttempts: number;
  wbRule: 'ORDER_AND_STOCK_DELTA';
  wmsRule: 'ORDER_RESERVATION_OR_SELLABLE_DELTA';
};

export type AdministrationFbsErrorRequest = {
  id: string;
  number: number;
  title: string;
  status: string;
  updatedAt: string;
  client: { id: string; code: string; name: string };
  orders: number;
  tasks: { total: number; completed: number; outstanding: number };
};

export type AdministrationFbsBoxAuditState =
  | 'OK'
  | 'NO_REMAINING_DEMAND'
  | 'BLOCKED_BY_RESERVATIONS'
  | 'SKU_OR_QUANTITY_MISMATCH'
  | 'NOT_ON_PALLET_SORT'
  | 'EMPTY'
  | 'ARCHIVED'
  | 'MISSING';

export type AdministrationFbsBoxAudit = {
  checkedAt: string;
  request: {
    id: string;
    number: number;
    title: string;
    status: string;
    client: { id: string; code: string; name: string };
  };
  taskSummary: { total: number; completed: number; outstanding: number; inProgress: number };
  summary: {
    planBoxes: number;
    healthy: number;
    issues: number;
    noRemainingDemand: number;
    blockedByReservations: number;
    skuOrQuantityMismatch: number;
    notOnPalletSort: number;
    empty: number;
    archived: number;
    missing: number;
  };
  rows: Array<{
    code: string;
    state: AdministrationFbsBoxAuditState;
    stateLabel: string;
    palletCode: string | null;
    availableUnits: number;
    reservedUnits: number;
    freeUnits: number;
    requiredUnits: number;
    externalOrders: string[];
    externalOrdersCount: number;
    products: Array<{
      skuId: string;
      name: string;
      available: number;
      reserved: number;
      free: number;
      required: number;
    }>;
    recommendation: string;
  }>;
};

export type AdministrationFbsErrorRepair = {
  repairedAt: string;
  selection: {
    repairedTasks: number;
    reservedTasks: number;
    waitingStockTasks: number;
    preservedStartedTasks: number;
    message: string;
  };
  before: AdministrationFbsBoxAudit;
  after: AdministrationFbsBoxAudit;
  message: string;
};

export type AdministrationPerformanceOptimization = {
  status: 'COMPLETED';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  cleanup: {
    expiredMobileCommands: number;
    expiredMobileSessions: number;
  };
  runtime: {
    expiredCacheEntries: number;
    retainedCacheEntries: number;
    memoryBeforeMb: number;
    memoryAfterMb: number;
  };
  files: {
    roots: string[];
    scanned: number;
    deleted: number;
    freedBytes: number;
    freedMb: number;
  };
  database: {
    statisticsUpdated: boolean;
    before: { sizeMb: number; liveRows: number; deadRows: number };
    after: { sizeMb: number; liveRows: number; deadRows: number };
  };
};

export type BoxCodePolicy = {
  primaryPrefix: string;
  allowedPrefixes: string[];
  receiptPrefix: string;
  balancePrefix: string;
  whiteReceiptPrefixes: string[];
  grayReceiptPrefixes: string[];
  palletPrefix: string;
  storageCellPrefix: string;
  rackSlotPrefix: string;
  rackPrefix: string;
  storageBoxPrefix: string;
  autoCorrections: Record<string, string>;
};

export type AdministrationSetting = {
  key: string;
  group: string;
  title: string;
  description: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  defaultValue: unknown;
  editable: boolean;
  secret?: boolean;
  value: unknown;
  updatedAt: string | null;
  updatedByUserId: string | null;
};

export type AdministrationWorkspaceVisibility = {
  workspaces: string[];
  users: Array<{
    id: string;
    email: string;
    name: string;
    status: string;
    roleCodes: string[];
    overrides: Record<string, boolean>;
  }>;
  note: string;
};

export type MarketplaceDiagnostics = {
  checkedAt: string;
  summary: { checked: number; healthy: number; failed: number };
  results: Array<Record<string, unknown> & {
    connectionId: string;
    marketplace: string;
    accountName: string;
    healthy: boolean;
    client: { id: string; code: string; name: string };
  }>;
};

export type AdministrationAuditEntry = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  payload: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

export type AdministrationAssistantPreview = {
  previewId: string;
  prompt: string;
  provider: string;
  liveModelConfigured: boolean;
  title: string;
  summary: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  recommendations: string[];
  rollback: string;
  actions: Array<{ type: string; executable: boolean; [key: string]: unknown }>;
};

export type AdministrationDocumentation = {
  generatedAt: string;
  sections: Array<{ id: string; title: string; summary: string }>;
  references: Array<{ title: string; path: string }>;
};

export type AdministrationStockComparison = {
  checkedAt: string;
  source: 'FILE' | 'API';
  file: { name: string; sheetName: string; sourceRows: number; duplicateRows: number };
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  warehouse: Pick<BranchSummary, 'id' | 'code' | 'name' | 'city'>;
  fixContext: {
    connectionId: string | null;
    warehouseId: string | null;
    warehouseName: string | null;
    accountName: string | null;
  };
  wildberriesWarehouses?: Array<{
    connectionId: string;
    warehouseId: string | null;
    warehouseName: string | null;
    accountName: string | null;
  }>;
  health: 'OK' | 'DANGER';
  summary: {
    products: number;
    matched: number;
    exact: number;
    differences: number;
    excessProducts: number;
    excessUnits: number;
    wmsGreaterProducts: number;
    notFound: number;
  };
  rows: Array<{
    barcode: string;
    quantity: number;
    product: string | null;
    brand: string | null;
    name: string | null;
    size: string | null;
    sellerArticle: string | null;
    sourceRows: number[];
    sku: { id: string; internalSku: string; article: string | null; name: string; size: string | null } | null;
    wmsAvailable: number;
    wmsReserved: number;
    wmsQuantity: number;
    difference: number;
    status: 'MATCH' | 'WB_EXCESS' | 'WMS_GREATER' | 'NOT_FOUND';
  }>;
};

export type AdministrationPhantomStock = {
  checkedAt: string;
  health: 'OK' | 'DANGER';
  summary: {
    balancesChecked: number;
    findings: number;
    suspectUnits: number;
    boxes: number;
    clients: number;
  };
  rows: Array<{
    balanceId: string;
    balanceUpdatedAt: string;
    clientId: string;
    clientCode: string;
    clientName: string;
    boxId: string;
    boxCode: string;
    skuId: string;
    internalSku: string;
    skuName: string;
    barcode: string | null;
    status: 'PACKING' | 'SHIPPING';
    currentQuantity: number;
    suspectQuantity: number;
    reasonCode: 'SHIPPED_KIZ_IN_BALANCE' | 'CLOSED_REQUEST_RESERVE';
    reason: string;
    shippedMarks: Array<{
      markId: string;
      maskedKiz: string;
      requestId: string;
      requestNumber: number;
      orderId: string | null;
      shippedAt: string;
    }>;
    closedRequests: Array<{
      requestId: string;
      requestNumber: number;
      movementId: string;
      quantity: number;
      createdAt: string;
    }>;
  }>;
};

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export async function login(payload: LoginPayload) {
  return request<AuthSession>('/auth/login', {
    method: 'POST',
    body: payload,
  });
}

export async function bootstrapAdmin(payload: BootstrapPayload) {
  return request<AuthSession>('/auth/bootstrap', {
    method: 'POST',
    body: payload,
  });
}

export async function fetchMe(accessToken: string) {
  return request<AuthUser>('/auth/me', {
    accessToken,
  });
}

export async function fetchAdministrationOverview(accessToken: string) {
  return request<AdministrationOverview>('/administration/overview', { accessToken });
}

// FIX: client-wide control affects only outbound marketplace stock quantities.
export type MarketplaceStockControlRow = {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export function fetchMarketplaceStockControl(accessToken: string) {
  return request<MarketplaceStockControlRow[]>('/administration/marketplace-stock-control', { accessToken });
}

export function updateMarketplaceStockControl(accessToken: string, row: MarketplaceStockControlRow, enabled: boolean) {
  return request<MarketplaceStockControlRow>(`/administration/marketplace-stock-control/${encodeURIComponent(row.id)}`, {
    accessToken, method: 'PUT', body: { enabled, expectedEnabled: row.enabled },
  });
}

// ADDED: Technical-work diagnostics expose only server-whitelisted repairs.
export async function fetchAdministrationTechnicalWork(accessToken: string) {
  return request<AdministrationTechnicalWorkOverview>('/administration/technical-work', { accessToken });
}

// ADDED: Read-only API registry check does not instrument or slow normal warehouse requests.
export async function fetchAdministrationInternalApis(accessToken: string) {
  return request<AdministrationInternalApiOverview>('/administration/technical-work/internal-apis', {
    accessToken,
  });
}

export async function restartAdministrationInternalApi(accessToken: string, confirmation: string) {
  return request<AdministrationInternalApiRestartResult>('/administration/technical-work/internal-apis/restart', {
    method: 'POST',
    body: { confirmation },
    accessToken,
  });
}

export async function diagnoseAdministrationTechnicalWork(
  accessToken: string,
  category: AdministrationTechnicalWorkCategory,
) {
  return request<AdministrationTechnicalWorkDiagnosis>('/administration/technical-work/diagnose', {
    method: 'POST',
    body: { category },
    accessToken,
  });
}

export async function applyAdministrationTechnicalWork(
  accessToken: string,
  payload: {
    issueId: string;
    category: AdministrationTechnicalWorkCategory;
    action: AdministrationTechnicalWorkIssue['actions'][number]['id'];
    confirmation: string;
    comment?: string;
  },
) {
  return request<{ applied: boolean; verified: boolean; message: string }>(
    '/administration/technical-work/apply',
    { method: 'POST', body: payload, accessToken },
  );
}

// ADDED: One bulk run is constrained to one category and one server-whitelisted action.
export async function applyAdministrationTechnicalWorkBulk(
  accessToken: string,
  payload: {
    category: AdministrationTechnicalWorkCategory;
    issueIds: string[];
    action: AdministrationTechnicalWorkIssue['actions'][number]['id'];
    confirmation: string;
    comment?: string;
  },
) {
  return request<AdministrationTechnicalWorkBulkResult>('/administration/technical-work/apply-bulk', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

// ADDED: The preview is read-only and shows every move before confirmation.
export async function previewAdministrationPalletSortScan(
  accessToken: string,
  payload: { palletCode: string; boxCodes: string[] },
) {
  return request<AdministrationPalletSortScanPreview>('/administration/technical-work/pallet-sorts/scan-preview', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function applyAdministrationPalletSortScan(
  accessToken: string,
  payload: { palletCode: string; boxCodes: string[]; confirmation: string },
) {
  return request<AdministrationPalletSortScanResult>('/administration/technical-work/pallet-sorts/scan-apply', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

// FIX: preview is the only way the admin UI obtains eligible box ids; it never mutates stock.
export async function previewAdministrationUnpalletedWriteoff(accessToken: string) {
  return request<AdministrationUnpalletedWriteoffPreview>('/administration/technical-work/unpalleted-boxes/preview', {
    method: 'POST',
    accessToken,
  });
}

// FIX: this endpoint reuses WB synchronization and closes only fully resolved inventory sessions.
export async function recheckAdministrationUnpalletedBlockers(accessToken: string) {
  return request<AdministrationUnpalletedBlockerRecheckResult>('/administration/technical-work/unpalleted-boxes/recheck', {
    method: 'POST',
    body: { confirmation: 'ПЕРЕПРОВЕРИТЬ БЛОКИРОВКИ' },
    accessToken,
  });
}

// FIX: the server revalidates every id; the browser is limited to the same 25-box batch.
export async function applyAdministrationUnpalletedWriteoff(
  accessToken: string,
  payload: { boxIds: string[]; confirmation: string },
) {
  return request<AdministrationUnpalletedWriteoffResult>('/administration/technical-work/unpalleted-boxes/apply', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchAdministrationTsdWorkloads(accessToken: string) {
  return request<AdministrationTsdWorkloads>('/administration/tsd-workloads', { accessToken });
}

export async function fetchTsdMonitoring(accessToken: string) {
  return request<TsdMonitoring>('/administration/tsd-monitor', { accessToken });
}

// ADDED: refresh starts read-only checks and never changes stock.
export async function fetchFbsStockMonitor(
  accessToken: string,
  filter: {
    clientId?: string;
    connectionId?: string;
    warehouseId?: string;
    status?: FbsStockMonitorStatus | 'ALL';
    system?: 'ALL' | 'WB' | 'WMS';
    product?: string;
    q?: string;
    dateFrom?: string;
    dateTo?: string;
    sort?: 'time' | 'status';
    direction?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  },
) {
  return request<FbsStockMonitorResponse>(withQuery('/marketplace-connections/fbs/stock-monitor', filter), {
    accessToken,
  });
}

// FIX: no page or visual filters are accepted; the server exports the full snapshot.
export async function downloadFbsStockMonitorWmsStocks(
  accessToken: string,
  clientId: string,
  warehouseId?: string,
) {
  return requestBlob(
    // FIX: keep the Excel scope identical to the selected report scope.
    withQuery('/marketplace-connections/fbs/stock-monitor/wms-stocks.xlsx', { clientId, warehouseId }),
    accessToken,
  );
}

export async function fetchFbsStockMonitorEvent(accessToken: string, eventId: string) {
  return request<FbsStockMonitorEventDetail>(
    `/marketplace-connections/fbs/stock-monitor/events/${encodeURIComponent(eventId)}`,
    { accessToken },
  );
}

export async function refreshFbsStockMonitor(
  accessToken: string,
  payload: { clientId?: string; connectionId?: string; eventIds?: string[] },
) {
  return request<{
    checked: number;
    succeeded: number;
    pending: number;
    failed: number;
    unavailable: number;
    message?: string;
  }>('/marketplace-connections/fbs/stock-monitor/refresh', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

// ADDED: preview always obtains live WB/WMS values before confirmation.
export async function previewFbsStockMonitorRepair(accessToken: string, eventId: string) {
  return request<FbsStockMonitorRepairPreview>(
    `/marketplace-connections/fbs/stock-monitor/events/${encodeURIComponent(eventId)}/repair-preview`,
    { method: 'POST', accessToken },
  );
}

// ADDED: the idempotency key prevents duplicate WB updates on retries.
export async function repairFbsStockMonitor(
  accessToken: string,
  eventId: string,
  idempotencyKey: string,
) {
  return request<FbsStockMonitorRepairResult>(
    `/marketplace-connections/fbs/stock-monitor/events/${encodeURIComponent(eventId)}/repair`,
    { method: 'POST', accessToken, body: { idempotencyKey } },
  );
}

export async function fetchFbsStockMonitorConfig(accessToken: string, connectionId: string) {
  return request<FbsStockMonitorConfig>(
    `/marketplace-connections/fbs/stock-monitor/config/${encodeURIComponent(connectionId)}`,
    { accessToken },
  );
}

export async function updateFbsStockMonitorConfig(
  accessToken: string,
  connectionId: string,
  payload: Omit<FbsStockMonitorConfig, 'clientId' | 'connectionId'>,
) {
  return request<FbsStockMonitorConfig>(
    `/marketplace-connections/fbs/stock-monitor/config/${encodeURIComponent(connectionId)}`,
    { method: 'PUT', accessToken, body: payload },
  );
}

export async function sendTsdMonitorAction(
  accessToken: string,
  deviceCode: string,
  action: 'RELOAD_REQUEST' | 'UPDATE_APP' | 'UNLOCK_INVENTORY' | 'LOGOUT',
) {
  return request<{ accepted: boolean; message: string }>(
    `/administration/tsd-monitor/devices/${encodeURIComponent(deviceCode)}/action`,
    { method: 'POST', body: { action }, accessToken },
  );
}

export async function fetchAdministrationFbsErrorRequests(accessToken: string) {
  return request<AdministrationFbsErrorRequest[]>('/administration/fbs-request-errors/requests', { accessToken });
}

export async function checkAdministrationFbsRequestErrors(accessToken: string, requestId: string) {
  return request<AdministrationFbsBoxAudit>('/administration/fbs-request-errors/check', {
    method: 'POST',
    body: { requestId },
    accessToken,
  });
}

export async function repairAdministrationFbsRequestErrors(accessToken: string, requestId: string) {
  return request<AdministrationFbsErrorRepair>('/administration/fbs-request-errors/repair', {
    method: 'POST',
    body: { requestId, confirmation: 'ИСПРАВИТЬ' },
    accessToken,
  });
}

export async function releaseAdministrationTsdWorkload(
  accessToken: string,
  payload: { kind: 'FBS_ORDER' | 'REQUEST_SESSION'; workloadId: string; requestId: string; deviceCode: string },
) {
  return request<{ released: number; message: string }>('/administration/tsd-workloads/release', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function disconnectAdministrationTsdRequest(
  accessToken: string,
  payload: { requestId: string; deviceCode: string },
) {
  return request<{ released: number; releasedOrders: number; message: string }>(
    '/administration/tsd-workloads/disconnect-request',
    { method: 'POST', body: payload, accessToken },
  );
}

export async function fetchAdministrationSettings(accessToken: string) {
  return request<AdministrationSetting[]>('/administration/settings', { accessToken });
}

export async function updateAdministrationSetting(
  accessToken: string,
  key: string,
  value: unknown,
  reason: string,
) {
  return request<{ key: string; value: unknown; updatedAt: string }>(
    `/administration/settings/${encodeURIComponent(key)}`,
    { method: 'PATCH', body: { value, reason }, accessToken },
  );
}

export async function fetchAdministrationWorkspaceVisibility(accessToken: string) {
  return request<AdministrationWorkspaceVisibility>('/administration/users/workspaces', {
    accessToken,
  });
}

export async function updateAdministrationWorkspaceVisibility(
  accessToken: string,
  userId: string,
  overrides: Record<string, boolean>,
  reason: string,
) {
  return request<{ user: { id: string; name: string; email: string }; overrides: Record<string, boolean> }>(
    `/administration/users/${encodeURIComponent(userId)}/workspaces`,
    { method: 'PUT', body: { overrides, reason }, accessToken },
  );
}

export async function runAdministrationMarketplaceDiagnostics(
  accessToken: string,
  filter: { clientId?: string; connectionId?: string } = {},
) {
  return request<MarketplaceDiagnostics>('/administration/marketplaces/diagnostics', {
    method: 'POST',
    body: filter,
    accessToken,
  });
}

export async function optimizeAdministrationPerformance(accessToken: string) {
  return request<AdministrationPerformanceOptimization>('/administration/performance/optimize', {
    method: 'POST',
    accessToken,
  });
}

export async function fetchAdministrationPhantomStocks(accessToken: string) {
  return request<AdministrationPhantomStock>('/administration/phantom-stocks', { accessToken });
}

export async function fixAdministrationPhantomStock(accessToken: string, balanceId: string) {
  return request<{ overview: AdministrationPhantomStock }>(
    `/administration/phantom-stocks/${encodeURIComponent(balanceId)}/fix`,
    { method: 'POST', accessToken },
  );
}

export async function fixAllAdministrationPhantomStocks(accessToken: string) {
  return request<{
    fixed: number;
    removedUnits: number;
    overview: AdministrationPhantomStock;
  }>('/administration/phantom-stocks/fix-all', { method: 'POST', accessToken });
}

export async function fetchAdministrationAudit(
  accessToken: string,
  search = '',
  take = 80,
) {
  return request<AdministrationAuditEntry[]>(
    withQuery('/administration/audit', { search, take }),
    { accessToken },
  );
}

export async function previewAdministrationAssistant(accessToken: string, prompt: string) {
  return request<AdministrationAssistantPreview>('/administration/assistant/preview', {
    method: 'POST',
    body: { prompt },
    accessToken,
  });
}

export async function applyAdministrationAssistant(
  accessToken: string,
  previewId: string,
  confirmation: string,
) {
  return request<{ previewId: string; applied: boolean; results: unknown[] }>(
    '/administration/assistant/apply',
    { method: 'POST', body: { previewId, confirmation }, accessToken },
  );
}

export async function fetchAdministrationDocumentation(accessToken: string) {
  return request<AdministrationDocumentation>('/administration/documentation', { accessToken });
}

export async function compareAdministrationWbStockFile(
  accessToken: string,
  payload: { clientId: string; warehouseId: string; connectionId: string; marketplaceWarehouseId?: string; file: File },
) {
  const form = new FormData();
  form.append('file', payload.file);
  return requestMultipart<AdministrationStockComparison>(
    withQuery('/administration/stocks/compare-file', {
      clientId: payload.clientId,
      warehouseId: payload.warehouseId,
      connectionId: payload.connectionId,
      marketplaceWarehouseId: payload.marketplaceWarehouseId,
    }),
    form,
    accessToken,
  );
}

export async function compareAdministrationWbStockApi(
  accessToken: string,
  payload: { clientId: string; warehouseId: string; connectionId: string; marketplaceWarehouseId?: string },
) {
  return request<AdministrationStockComparison>('/administration/stocks/compare-wb', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function fetchClients(accessToken: string, options: { includeArchived?: boolean } = {}) {
  return request<ClientSummary[]>(
    withQuery('/clients', {
      includeArchived: options.includeArchived ? 'true' : undefined,
    }),
    {
      accessToken,
    },
  );
}

export async function fetchClientRequests(
  accessToken: string,
  filter: { clientId?: string; status?: ClientRequestStatus; type?: ClientRequestType; archive?: boolean; boxCode?: string } = {},
) {
  return request<ClientRequestSummary[]>(withQuery('/client-requests', filter), {
    accessToken,
  });
}

export async function mergeFbsRequestTails(
  accessToken: string,
  requestIds: string[],
  confirmedOrders?: Array<{ connectionId: string; id: string }>,
) {
  return request<MergeFbsRequestTailsResult>(
    '/client-requests/fbs/merge-tails',
    {
      method: 'POST',
      body: { requestIds, confirmedOrders },
      accessToken,
    },
  );
}

export async function previewFbsRequestTails(
  accessToken: string,
  requestIds: string[],
) {
  return request<MergeFbsRequestTailsPreview>(
    '/client-requests/fbs/merge-tails/preview',
    {
      method: 'POST',
      body: { requestIds },
      accessToken,
    },
  );
}

export async function fetchContracts(accessToken: string) {
  return request<ClientContractSummary[]>('/contracts', { accessToken });
}

export async function setClientContractArchived(accessToken: string, contractId: string, archived: boolean) {
  return request<ClientContractSummary>(`/contracts/${contractId}/archive`, {
    method: 'PATCH',
    body: { archived },
    accessToken,
  });
}

export async function deleteClientContract(accessToken: string, contractId: string) {
  return request<{ id: string; deleted: true }>(`/contracts/${contractId}`, {
    method: 'DELETE',
    accessToken,
  });
}

export async function fetchContractClients(accessToken: string) {
  return request<ContractClientOption[]>('/contracts/clients', { accessToken });
}

export async function createClientContract(accessToken: string, payload: CreateClientContractPayload) {
  return request<ClientContractSummary>('/contracts', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function checkClientContractRequisites(accessToken: string, contractId: string) {
  return request<ClientContractRequisitesCheck>(`/contracts/${contractId}/requisites-check`, {
    accessToken,
  });
}

export async function refreshClientContractRequisites(
  accessToken: string,
  contractId: string,
  payload: { expectedFingerprint: string; wmsPassword: string },
) {
  return request<RefreshClientContractRequisitesResult>(`/contracts/${contractId}/requisites-refresh`, {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function downloadClientContract(accessToken: string, contractId: string, signed = false) {
  return requestBlob(`/contracts/${contractId}/${signed ? 'signed-pdf' : 'pdf'}`, accessToken);
}

export async function uploadSignedClientContract(accessToken: string, contractId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return requestMultipart<ClientContractSummary>(`/contracts/${contractId}/signed-pdf`, form, accessToken);
}

export async function uploadContractAdditionalAgreement(accessToken: string, contractId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return requestMultipart<ClientContractSummary>(`/contracts/${contractId}/additional-agreements`, form, accessToken);
}

export async function downloadContractAdditionalAgreement(
  accessToken: string,
  contractId: string,
  attachmentId: string,
) {
  return requestBlob(`/contracts/${contractId}/additional-agreements/${attachmentId}/pdf`, accessToken);
}

export async function fetchClientRequestManualBoxSelection(accessToken: string, requestId: string) {
  return request<ClientRequestManualBoxSelection>(`/client-requests/${requestId}/manual-box-selection`, {
    accessToken,
  });
}

export async function fetchClientRequestFbsBoxSearch(accessToken: string, requestId: string) {
  return request<ClientRequestFbsBoxSearch>(`/client-requests/${requestId}/fbs-box-search`, {
    accessToken,
  });
}

export async function downloadClientRequestFbsBoxSearchXlsx(accessToken: string, requestId: string) {
  return requestBlob(`/client-requests/${requestId}/fbs-box-search.xlsx`, accessToken);
}

export async function saveClientRequestManualBoxSelection(
  accessToken: string,
  requestId: string,
  selections: Array<{ requestItemId: string; boxId: string; quantity: number }>,
) {
  return request<ClientRequestManualBoxSelection>(`/client-requests/${requestId}/manual-box-selection`, {
    method: 'PUT',
    body: { selections },
    accessToken,
  });
}

export async function fetchClientRequestDocument(accessToken: string, requestId: string) {
  return request<ClientRequestDocument>(`/client-requests/${requestId}/document`, {
    accessToken,
  });
}

export async function downloadClientRequestPdf(accessToken: string, requestId: string) {
  return requestBlob(`/client-requests/${requestId}/document.pdf`, accessToken);
}

export async function fetchClientRequestFiles(accessToken: string, requestId: string) {
  return request<ClientRequestFileSummary[]>(`/client-requests/${requestId}/files`, {
    accessToken,
  });
}

export async function fetchClientRequestTimeline(accessToken: string, requestId: string) {
  return request<ClientRequestTimeline>(`/client-requests/${requestId}/timeline`, {
    accessToken,
  });
}

export async function createClientRequestComment(
  accessToken: string,
  requestId: string,
  payload: { body: string; isInternal?: boolean },
) {
  return request<ClientRequestCommentSummary>(`/client-requests/${requestId}/comments`, {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function uploadClientRequestFile(accessToken: string, requestId: string, file: File) {
  const form = new FormData();
  form.append('file', file);

  return requestMultipart<ClientRequestFileSummary>(`/client-requests/${requestId}/files`, form, accessToken);
}

export async function downloadClientRequestFile(accessToken: string, requestId: string, fileId: string) {
  return requestBlob(`/client-requests/${requestId}/files/${fileId}`, accessToken);
}

export async function fetchClientNotifications(
  accessToken: string,
  filter: { clientId?: string; unreadOnly?: boolean } = {},
) {
  return request<ClientNotificationSummary[]>(
    withQuery('/client-notifications', {
      clientId: filter.clientId,
      unreadOnly: filter.unreadOnly ? 'true' : undefined,
    }),
    {
      accessToken,
    },
  );
}

export async function markClientNotificationRead(accessToken: string, notificationId: string) {
  return request<ClientNotificationSummary>(`/client-notifications/${notificationId}/read`, {
    method: 'PATCH',
    accessToken,
  });
}

export async function fetchClientNotificationPreferences(
  accessToken: string,
  filter: { clientId?: string } = {},
) {
  return request<ClientNotificationPreferenceSummary[]>(
    withQuery('/client-notifications/preferences', {
      clientId: filter.clientId,
    }),
    {
      accessToken,
    },
  );
}

export async function fetchClientTelegramSettings(accessToken: string, clientId?: string) {
  return request<ClientTelegramSettings>(withQuery('/client-notifications/telegram-settings', { clientId }), {
    accessToken,
  });
}

export async function updateClientTelegramSettings(
  accessToken: string,
  payload: { clientId?: string; enabled: boolean; chatId: string },
) {
  return request<ClientTelegramSettings>('/client-notifications/telegram-settings', {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function updateClientNotificationPreference(
  accessToken: string,
  payload: { clientId: string; eventType: ClientNotificationEvent; isEnabled: boolean },
) {
  return request<ClientNotificationPreferenceSummary>('/client-notifications/preferences', {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function fetchBillingServices(accessToken: string) {
  return request<BillingServiceSummary[]>('/billing/services', {
    accessToken,
  });
}

export async function fetchClientBillingServices(accessToken: string, clientId: string) {
  return request<ClientBillingServiceSummary[]>(`/billing/clients/${clientId}/services`, {
    accessToken,
  });
}

export async function fetchClientFbsTurnkeyPricing(accessToken: string, clientId: string) {
  return request<ClientFbsTurnkeyPricing>(`/billing/clients/${clientId}/fbs-turnkey`, {
    accessToken,
  });
}

export async function updateClientFbsTurnkeyPricing(
  accessToken: string,
  clientId: string,
  payload: {
    enabled: boolean;
    unitPriceRub: number;
    fixedPlusLogisticsEnabled: boolean;
    fixedPlusLogisticsUnitPriceRub: number;
    fixedPlusLogisticsDestination: string;
    tieredLogisticsEnabled?: boolean;
    logisticsFreeItemsLimit?: number;
    logisticsCubicMeterLiters?: number;
    logisticsCubicMeterPriceRub?: number;
    logisticsPalletPriceRub?: number;
    primaryProcessingEnabled?: boolean;
    primaryWhiteUnitPriceRub?: number;
    primaryGrayUnitPriceRub?: number;
    primaryReturnUnitPriceRub?: number;
    primaryServices?: Array<{
      serviceId: string;
      quantityMultiplier: number;
      matchKeywords?: string;
    }>;
  },
) {
  return request<ClientFbsTurnkeyPricing>(`/billing/clients/${clientId}/fbs-turnkey`, {
    method: 'PUT',
    body: payload,
    accessToken,
  });
}

export async function createBillingService(accessToken: string, payload: CreateBillingServicePayload) {
  return request<BillingServiceSummary>('/billing/services', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function upsertClientBillingService(
  accessToken: string,
  clientId: string,
  payload: UpsertClientBillingServicePayload,
) {
  return request<ClientBillingServiceSummary>(`/billing/clients/${clientId}/services`, {
    method: 'PUT',
    body: payload,
    accessToken,
  });
}

export async function fetchOwnCompanies(accessToken: string) {
  return request<OwnCompanySummary[]>('/own-companies', {
    accessToken,
  });
}

export async function parseRequisitesDocument(
  accessToken: string,
  target: 'own-company' | 'client',
  file: File,
) {
  const form = new FormData();
  form.append('file', file);
  const path = target === 'own-company' ? '/own-companies/parse-requisites' : '/clients/parse-requisites';
  return requestMultipart<RequisitesDocumentResult>(path, form, accessToken);
}

export async function createOwnCompany(accessToken: string, payload: UpsertOwnCompanyPayload) {
  return request<OwnCompanySummary>('/own-companies', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateOwnCompany(accessToken: string, companyId: string, payload: UpsertOwnCompanyPayload) {
  return request<OwnCompanySummary>(`/own-companies/${companyId}`, {
    method: 'PUT',
    body: payload,
    accessToken,
  });
}

export async function uploadOwnCompanyAsset(
  accessToken: string,
  companyId: string,
  kind: 'stamp' | 'signature',
  file: File,
) {
  const form = new FormData();
  form.append('file', file);
  return requestMultipart<OwnCompanySummary>(
    `/own-companies/${companyId}/assets/${kind}`,
    form,
    accessToken,
  );
}

export async function deleteOwnCompanyAsset(
  accessToken: string,
  companyId: string,
  kind: 'stamp' | 'signature',
) {
  return request<OwnCompanySummary>(`/own-companies/${companyId}/assets/${kind}`, {
    method: 'DELETE',
    accessToken,
  });
}

export async function fetchBillingCharges(
  accessToken: string,
  filter: { clientId?: string; status?: BillingChargeStatus } = {},
) {
  return request<BillingChargeSummary[]>(withQuery('/billing/charges', filter), {
    accessToken,
  });
}

export async function fetchBillingServiceHistory(
  accessToken: string,
  filter: { clientId?: string; periodFrom?: string; periodTo?: string } = {},
) {
  return request<BillingServiceHistory>(withQuery('/billing/service-history', filter), {
    accessToken,
  });
}

export async function fetchBillingReconciliation(
  accessToken: string,
  filter: { clientId?: string; periodFrom?: string; periodTo?: string } = {},
) {
  return request<BillingReconciliation>(withQuery('/billing/reconciliation', filter), {
    accessToken,
  });
}

export async function fetchExpenseEntries(
  accessToken: string,
  filter: {
    clientId?: string;
    category?: ExpenseCategory;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  } = {},
) {
  return request<ExpenseEntry[]>(withQuery('/expenses/entries', filter), {
    accessToken,
  });
}

export async function createExpenseEntry(
  accessToken: string,
  payload: {
    category: ExpenseCategory;
    expenseDate: string;
    description: string;
    amountRub: number;
    clientId?: string;
    requestId?: string;
    quantity?: number;
    unit?: string;
    unitPriceRub?: number;
    workerName?: string;
    comment?: string;
  },
) {
  return request<ExpenseEntry>('/expenses/entries', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function cancelExpenseEntry(accessToken: string, entryId: string) {
  return request<ExpenseEntry>(`/expenses/entries/${entryId}/cancel`, {
    method: 'PATCH',
    accessToken,
  });
}

export async function fetchExpenseMaterials(accessToken: string) {
  return request<ExpenseMaterial[]>('/expenses/materials', { accessToken });
}

export async function createExpenseMaterial(
  accessToken: string,
  payload: {
    code: string;
    name: string;
    unit?: string;
    initialQuantity?: number;
    averageUnitCostRub?: number;
    minStockQuantity?: number;
    comment?: string;
  },
) {
  return request<ExpenseMaterial>('/expenses/materials', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateExpenseMaterial(
  accessToken: string,
  materialId: string,
  payload: {
    code?: string;
    name?: string;
    unit?: string;
    minStockQuantity?: number;
    isActive?: boolean;
    comment?: string;
  },
) {
  return request<ExpenseMaterial>(`/expenses/materials/${materialId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function addExpenseMaterialStock(
  accessToken: string,
  materialId: string,
  payload: {
    type: 'PURCHASE' | 'ADJUSTMENT' | 'WRITE_OFF';
    quantity: number;
    unitCostRub?: number;
    expenseDate?: string;
    comment?: string;
  },
) {
  return request<{
    material: ExpenseMaterial;
    movement: ExpenseMaterialMovement;
    expenseEntryId: string | null;
  }>(`/expenses/materials/${materialId}/stock`, {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchExpenseMaterialMovements(
  accessToken: string,
  materialId: string,
) {
  return request<ExpenseMaterialMovement[]>(
    `/expenses/materials/${materialId}/movements`,
    { accessToken },
  );
}

export async function fetchClientExpenseMaterialRules(
  accessToken: string,
  clientId: string,
) {
  return request<ClientExpenseMaterialRules>(
    `/expenses/clients/${clientId}/material-rules`,
    { accessToken },
  );
}

export async function updateClientExpenseMaterialRule(
  accessToken: string,
  clientId: string,
  materialId: string,
  payload: {
    isEnabled: boolean;
    quantityPerShippedUnit: number;
    chargeSeparately: boolean;
    billingUnitPriceRub?: number;
    comment?: string;
  },
) {
  return request<ClientExpenseMaterialRules>(
    `/expenses/clients/${clientId}/material-rules/${materialId}`,
    {
      method: 'PUT',
      body: payload,
      accessToken,
    },
  );
}

export async function fetchExpensePayroll(accessToken: string, filter: { dateFrom?: string; dateTo?: string } = {}) {
  return request<ExpensePayrollReport>(withQuery('/expenses/payroll', filter), { accessToken });
}

export async function updateExpensePayrollRate(accessToken: string, userId: string, rateRub: number) {
  return request<{ userId: string; userName: string; email: string; rateRub: number; rateIsDefault: boolean }>(
    `/expenses/payroll/users/${encodeURIComponent(userId)}/rate`,
    { method: 'PUT', body: { rateRub }, accessToken },
  );
}

export async function resetExpensePayrollCounter(accessToken: string, userId: string) {
  return request<{ userId: string; userName: string; email: string; resetAt: string; message: string }>(
    `/expenses/payroll/users/${encodeURIComponent(userId)}/reset`,
    { method: 'POST', accessToken },
  );
}

export async function fetchExpenseReport(
  accessToken: string,
  filter: {
    clientId?: string;
    category?: ExpenseCategory;
    dateFrom?: string;
    dateTo?: string;
  } = {},
) {
  return request<ExpenseReport>(withQuery('/expenses/report', filter), {
    accessToken,
  });
}

export async function fetchExpenseDebts(
  accessToken: string,
  clientId?: string,
) {
  return request<ExpenseDebtReport>(
    withQuery('/expenses/debts', { clientId }),
    { accessToken },
  );
}

export async function downloadExpenseReportXlsx(
  accessToken: string,
  filter: {
    clientId?: string;
    category?: ExpenseCategory;
    dateFrom?: string;
    dateTo?: string;
  } = {},
) {
  return requestBlob(withQuery('/expenses/report.xlsx', filter), accessToken);
}

export async function createBillingCharge(accessToken: string, payload: CreateBillingChargePayload) {
  return request<BillingChargeSummary>('/billing/charges', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateBillingChargeStatus(
  accessToken: string,
  chargeId: string,
  payload: { status: BillingChargeStatus },
) {
  return request<BillingChargeSummary>(`/billing/charges/${chargeId}/status`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function updateFbsBillingLogisticsTrip(
  accessToken: string,
  chargeId: string,
  payload: { extraTrip: boolean },
) {
  return request<BillingChargeSummary>(`/billing/charges/${chargeId}/fbs-logistics-trip`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function generateStorageCharge(accessToken: string, payload: GenerateStorageChargePayload) {
  return request<BillingChargeSummary>('/billing/charges/storage', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchBillingInvoices(
  accessToken: string,
  filter: { clientId?: string; status?: BillingInvoiceStatus; periodFrom?: string; periodTo?: string } = {},
) {
  return request<BillingInvoiceSummary[]>(withQuery('/billing/invoices', filter), {
    accessToken,
  });
}

export async function recheckBillingInvoice(accessToken: string, invoiceId: string) {
  return request<BillingInvoiceRecheckResult>(`/billing/invoices/${invoiceId}/recheck`, {
    accessToken,
  });
}

export async function addBillingInvoicePrimaryProcessing(
  accessToken: string,
  invoiceId: string,
) {
  return request<BillingInvoiceSummary>(
    `/billing/invoices/${invoiceId}/primary-processing`,
    {
      method: 'POST',
      accessToken,
    },
  );
}

export async function fetchBillingInvoiceDocument(accessToken: string, invoiceId: string) {
  return request<BillingInvoiceDocument>(`/billing/invoices/${invoiceId}/document`, {
    accessToken,
  });
}

export async function downloadBillingInvoicePdf(accessToken: string, invoiceId: string) {
  return requestBlob(`/billing/invoices/${invoiceId}/document.pdf`, accessToken);
}

export async function downloadCombinedBillingInvoicesPdf(
  accessToken: string,
  filter: { clientId?: string; status?: BillingInvoiceStatus; periodFrom?: string; periodTo?: string; unpaidOnly?: boolean } = {},
) {
  return requestBlob(withQuery('/billing/invoices/combined.pdf', filter), accessToken);
}

export async function fetchBillingInvoiceActDocument(accessToken: string, invoiceId: string) {
  return request<BillingInvoiceDocument>(`/billing/invoices/${invoiceId}/act`, {
    accessToken,
  });
}

export async function downloadBillingInvoiceActPdf(accessToken: string, invoiceId: string) {
  return requestBlob(`/billing/invoices/${invoiceId}/act.pdf`, accessToken);
}

export async function createBillingInvoice(accessToken: string, payload: CreateBillingInvoicePayload) {
  return request<BillingInvoiceSummary>('/billing/invoices', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function createManualBillingInvoice(accessToken: string, payload: CreateManualBillingInvoicePayload) {
  return request<BillingInvoiceSummary>('/billing/invoices/manual', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchClientPaymentAccounts(accessToken: string, clientId: string) {
  return request<ClientPaymentAccounts>(`/billing/clients/${clientId}/payment-accounts`, {
    accessToken,
  });
}

export async function updateBillingInvoicePaymentAccount(
  accessToken: string,
  invoiceId: string,
  paymentBankAccountId: string,
) {
  return request<BillingInvoiceSummary>(`/billing/invoices/${invoiceId}/payment-account`, {
    method: 'PATCH',
    body: { paymentBankAccountId },
    accessToken,
  });
}

export async function fetchFbsInvoiceMergePreview(
  accessToken: string,
  clientId: string,
  invoiceIds?: string[],
) {
  return request<FbsInvoiceMergePreview>(
    withQuery('/billing/invoices/fbs-merge-preview', {
      clientId,
      invoiceIds: invoiceIds?.length ? invoiceIds.join(',') : undefined,
    }),
    { accessToken },
  );
}

export async function mergeFbsInvoices(
  accessToken: string,
  payload: MergeFbsInvoicesPayload,
) {
  return request<BillingInvoiceSummary>('/billing/invoices/fbs-merge', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function mergeBillingInvoices(
  accessToken: string,
  payload: MergeBillingInvoicesPayload,
) {
  return request<BillingInvoiceSummary>('/billing/invoices/merge', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchBillingAdvances(accessToken: string, clientId?: string) {
  return request<BillingAdvancesOverview>(withQuery('/billing/advances', { clientId }), {
    accessToken,
  });
}

export async function createBillingAdvance(accessToken: string, payload: CreateBillingAdvancePayload) {
  return request<BillingAdvanceEntry>('/billing/advances', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function cancelBillingAdvance(accessToken: string, advanceId: string) {
  return request<BillingAdvanceEntry>(`/billing/advances/${advanceId}/cancel`, {
    method: 'PATCH',
    accessToken,
  });
}

export async function applyBillingAdvance(accessToken: string, advanceId: string) {
  return request<{ advance: BillingAdvanceEntry; invoicesTouched: false }>(`/billing/advances/${advanceId}/apply`, {
    method: 'POST',
    accessToken,
  });
}

export async function restoreBillingAdvance(accessToken: string, advanceId: string) {
  return request<{ advance: BillingAdvanceEntry; invoicesTouched: false }>(`/billing/advances/${advanceId}/restore`, {
    method: 'POST',
    accessToken,
  });
}

export function fetchInventoryDashboard(accessToken: string) {
  return request<InventoryDashboard>('/inventory/dashboard', { accessToken });
}

// FIX: keep current FBS API exports intact while adding SKU collection calls.
export function searchSkuCollectionCandidates(accessToken: string, clientId: string, search: string) {
  return request<SkuCollectionCandidate[]>(withQuery('/inventory/sku-collections/search', { clientId, search }), { accessToken });
}

export function createSkuCollection(accessToken: string, clientId: string, skuId: string) {
  return request<SkuCollectionRequest>('/inventory/sku-collections', {
    method: 'POST',
    body: { clientId, skuId },
    accessToken,
  });
}

export function fetchInventorySession(accessToken: string, id: string) {
  return request<InventorySession>(`/inventory/sessions/${id}`, { accessToken });
}

export function startInventorySession(
  accessToken: string,
  payload: { type: InventorySessionType; clientId?: string; title?: string; comment?: string },
) {
  return request<InventorySession>('/inventory/sessions', { method: 'POST', body: payload, accessToken });
}

export function openInventoryBox(accessToken: string, sessionId: string, boxCode: string) {
  return request<InventoryAuditBox>(`/inventory/sessions/${sessionId}/boxes/open`, {
    method: 'POST',
    body: { boxCode },
    accessToken,
  });
}

export function scanInventoryItem(accessToken: string, auditBoxId: string, barcode: string, quantity = 1) {
  return request<InventoryAuditLine>(`/inventory/boxes/${auditBoxId}/scan`, {
    method: 'POST',
    body: { barcode, quantity },
    accessToken,
  });
}

export function setInventoryCount(accessToken: string, auditBoxId: string, lineId: string, countedQuantity: number) {
  return request<InventoryAuditLine>(`/inventory/boxes/${auditBoxId}/count`, {
    method: 'PATCH',
    body: { lineId, countedQuantity },
    accessToken,
  });
}

export function finishInventoryBox(accessToken: string, auditBoxId: string) {
  return request<InventoryAuditBox>(`/inventory/boxes/${auditBoxId}/finish`, {
    method: 'POST',
    accessToken,
  });
}

export function approveInventoryBoxRescan(accessToken: string, requestId: string) {
  return request<InventoryBoxRescanRequest>(`/inventory/rescan-requests/${requestId}/approve`, {
    method: 'POST',
    accessToken,
  });
}

export function sendInventoryToReview(accessToken: string, sessionId: string) {
  return request<InventorySession>(`/inventory/sessions/${sessionId}/review`, {
    method: 'POST',
    accessToken,
  });
}

export function decideInventoryLine(
  accessToken: string,
  lineId: string,
  action: InventoryResolutionAction,
  comment?: string,
) {
  return request<InventoryAuditBox>(`/inventory/lines/${lineId}/decision`, {
    method: 'PATCH',
    body: { action, comment },
    accessToken,
  });
}

export function completeInventorySession(accessToken: string, sessionId: string, comment?: string) {
  return request<InventorySession>(`/inventory/sessions/${sessionId}/complete`, {
    method: 'POST',
    body: { comment },
    accessToken,
  });
}

export function cancelInventorySession(accessToken: string, sessionId: string, comment?: string) {
  return request<InventorySession>(`/inventory/sessions/${sessionId}/cancel`, {
    method: 'POST',
    body: { comment },
    accessToken,
  });
}

export async function fetchClientRequestBoxOverlaps(accessToken: string) {
  return request<ClientRequestBoxOverlapStatistics>('/client-requests/box-overlaps', { accessToken });
}

export async function updateManualBillingInvoice(
  accessToken: string,
  invoiceId: string,
  payload: CreateManualBillingInvoicePayload,
) {
  return request<BillingInvoiceSummary>(`/billing/invoices/${invoiceId}/manual`, {
    method: 'PUT',
    body: payload,
    accessToken,
  });
}

export async function updateBillingInvoiceStatus(
  accessToken: string,
  invoiceId: string,
  payload: { status: BillingInvoiceStatus },
) {
  return request<BillingInvoiceSummary>(`/billing/invoices/${invoiceId}/status`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function issueClientRequestInvoice(accessToken: string, requestId: string) {
  return request<IssueRequestBillingInvoicesResult>(`/billing/requests/${requestId}/issue`, {
    method: 'POST',
    accessToken,
  });
}

export async function createBillingPayment(accessToken: string, payload: CreateBillingPaymentPayload) {
  return request<BillingInvoiceSummary>('/billing/payments', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function createClientRequest(accessToken: string, payload: CreateClientRequestPayload) {
  return request<ClientRequestSummary>('/client-requests', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function createIncomingPayment(accessToken: string, payload: CreateIncomingPaymentPayload) {
  return request<IncomingPaymentResult>('/billing/payments/incoming', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateClientRequest(
  accessToken: string,
  requestId: string,
  payload: UpdateClientRequestPayload,
) {
  return request<ClientRequestSummary>(`/client-requests/${requestId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function previewClientRequestAvailability(
  accessToken: string,
  payload: PreviewClientRequestAvailabilityPayload,
) {
  return request<ClientRequestAvailabilityPreview>('/client-requests/availability-preview', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function previewOutboundRequestXlsx(accessToken: string, payload: OutboundRequestXlsxPayload) {
  return requestMultipart<OutboundRequestXlsxPreview>(
    '/client-requests/outbound-xlsx/preview',
    outboundRequestXlsxForm(payload),
    accessToken,
  );
}

export async function commitOutboundRequestXlsx(accessToken: string, payload: OutboundRequestXlsxPayload) {
  return requestMultipart<CommitOutboundRequestXlsxResult>(
    '/client-requests/outbound-xlsx/commit',
    outboundRequestXlsxForm(payload),
    accessToken,
  );
}

export async function updateClientRequestStatus(
  accessToken: string,
  requestId: string,
  payload: {
    status: ClientRequestStatus;
    managerComment?: string;
    boxes?: number;
    pallets?: number;
    packedUnits?: number;
    allowOverweightPackages?: boolean;
    packages?: unknown[];
    stockSources?: Array<{
      requestItemId: string;
      boxCode?: string;
      noBox?: boolean;
      quantity: number;
    }>;
  },
) {
  return request<ClientRequestSummary>(`/client-requests/${requestId}/status`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function cancelClientRequest(accessToken: string, requestId: string) {
  return request<ClientRequestSummary>(`/client-requests/${requestId}/cancel`, {
    method: 'POST',
    accessToken,
  });
}

export async function resolveFbsSynchronization(
  accessToken: string,
  requestId: string,
  action: 'RETURN_TO_WORK' | 'CONFIRM_DELIVERED',
  requestNumber: number,
) {
  return request<{
    request: ClientRequestSummary;
    action: 'RETURN_TO_WORK' | 'CONFIRM_DELIVERED';
    stockChanged: boolean;
    message: string;
  }>(`/client-requests/${requestId}/fbs-synchronization/resolve`, {
    method: 'POST',
    body: { action, requestNumber },
    accessToken,
  });
}

export async function emergencyCloseClientRequestFromXlsx(accessToken: string, requestId: string, file: File) {
  const form = new FormData();
  form.append('file', file);

  return requestMultipart<EmergencyPackedXlsxResult>(`/client-requests/${requestId}/emergency-packed-xlsx`, form, accessToken);
}

export async function rollbackEmergencyCloseClientRequest(accessToken: string, requestId: string) {
  return request<EmergencyPackedXlsxRollbackResult>(`/client-requests/${requestId}/emergency-packed-xlsx/rollback`, {
    method: 'POST',
    accessToken,
  });
}

export async function createClient(accessToken: string, payload: CreateClientPayload) {
  return request<ClientSummary>('/clients', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateClient(accessToken: string, clientId: string, payload: UpdateClientPayload) {
  return request<ClientSummary>(`/clients/${clientId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function updateClientStatus(accessToken: string, clientId: string, status: ClientStatus) {
  return request<ClientSummary>(`/clients/${clientId}/status`, {
    method: 'PATCH',
    body: { status },
    accessToken,
  });
}

export async function deleteClient(accessToken: string, clientId: string) {
  return request<DeleteClientResult>(`/clients/${clientId}`, {
    method: 'DELETE',
    accessToken,
  });
}

export async function importClientsXlsx(accessToken: string, payload: { file: File }) {
  const form = new FormData();
  form.append('file', payload.file);

  return requestMultipart<ClientImportResult>('/clients/import-xlsx', form, accessToken);
}

export async function fetchSkus(accessToken: string, filter: { clientId?: string; search?: string; draftsOnly?: boolean } = {}) {
  return request<SkuSummary[]>(withQuery('/skus', filter), {
    accessToken,
  });
}

export async function fetchFactoryShipments(accessToken: string, clientId?: string) {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  return request<FactoryShipment[]>(`/factory-shipments${query}`, { accessToken });
}

export async function createFactoryShipment(accessToken: string, payload: { clientId: string; title: string; comment?: string; items: Array<{ skuId: string; plannedQty: number }> }) {
  return request<FactoryShipment>('/factory-shipments', { method: 'POST', body: payload, accessToken });
}

export async function shipFactoryShipment(accessToken: string, id: string) {
  return request<FactoryShipment>(`/factory-shipments/${id}/ship`, { method: 'POST', accessToken });
}

export async function reconcileFactoryShipment(accessToken: string, id: string, requestId: string) {
  return request<FactoryShipment>(`/factory-shipments/${id}/reconcile`, { method: 'POST', body: { requestId }, accessToken });
}

export async function fetchBulkSkuVolume(
  accessToken: string,
  filter: { clientId: string; sourceVolumeFrom?: number; sourceVolumeTo?: number },
) {
  return request<BulkSkuVolumeData>(withQuery('/skus/bulk-volume', filter), {
    accessToken,
  });
}

export async function updateBulkSkuVolume(
  accessToken: string,
  payload: {
    clientId: string;
    sourceVolumeFrom: number;
    sourceVolumeTo: number;
    skuIds: string[];
    newVolumeLiters: number;
  },
) {
  return request<BulkSkuVolumeResult>('/skus/bulk-volume', {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function downloadSkuDraftTemplate(accessToken: string) {
  return requestBlob('/skus/drafts/template.xlsx', accessToken);
}

export async function importSkuDraftsXlsx(accessToken: string, payload: { clientId: string; file: File }) {
  const form = new FormData();
  form.append('file', payload.file);

  return requestMultipart<SkuDraftImportResult>(withQuery('/skus/drafts/import-xlsx', { clientId: payload.clientId }), form, accessToken);
}

export async function fetchSku(accessToken: string, skuId: string) {
  return request<SkuDetail>(`/skus/${skuId}`, {
    accessToken,
  });
}

export async function createSku(accessToken: string, payload: CreateSkuPayload) {
  return request<SkuSummary>('/skus', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateSku(accessToken: string, skuId: string, payload: UpdateSkuPayload) {
  return request<SkuDetail>(`/skus/${skuId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function deleteSku(accessToken: string, skuId: string) {
  return request<{ id: string; internalSku: string; name: string; deleted: true }>(`/skus/${skuId}`, {
    method: 'DELETE',
    accessToken,
  });
}

export async function fetchNomenclature(accessToken: string, filter: { search?: string } = {}) {
  return request<NomenclatureSummary[]>(withQuery('/skus/nomenclature', filter), {
    accessToken,
  });
}

export async function createNomenclatureItem(accessToken: string, payload: CreateNomenclaturePayload) {
  return request<NomenclatureSummary>('/skus/nomenclature', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function importNomenclatureXlsx(accessToken: string, payload: { file: File }) {
  const form = new FormData();
  form.append('file', payload.file);

  return requestMultipart<NomenclatureImportResult>('/skus/nomenclature/import-xlsx', form, accessToken);
}

export async function fetchArticleMappings(accessToken: string, clientId: string) {
  return request<ArticleMappingSummary[]>(withQuery('/skus/article-mappings', { clientId }), {
    accessToken,
  });
}

export async function createArticleMapping(accessToken: string, payload: CreateArticleMappingPayload) {
  return request<ArticleMappingSummary>('/skus/article-mappings', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function importArticleMappingsXlsx(accessToken: string, payload: { clientId: string; file: File }) {
  const form = new FormData();
  form.append('file', payload.file);

  return requestMultipart<ArticleMappingImportResult>(withQuery('/skus/article-mappings/import-xlsx', { clientId: payload.clientId }), form, accessToken);
}

export async function fetchStockBalances(accessToken: string, filter: { clientId?: string; search?: string } = {}) {
  return request<StockBalance[]>(withQuery('/stock/balances', filter), {
    accessToken,
  });
}

export async function fetchBranches(accessToken: string) {
  return request<BranchSummary[]>('/branches', { accessToken });
}

export async function fetchClientBranches(accessToken: string, clientId: string) {
  return request<ClientBranchAccessResponse>(`/clients/${clientId}/branches`, { accessToken });
}

export async function updateClientBranches(accessToken: string, clientId: string, warehouseIds: string[]) {
  return request<ClientBranchAccessResponse>(`/clients/${clientId}/branches`, {
    method: 'PATCH',
    body: { warehouseIds },
    accessToken,
  });
}

export async function activateBranch(accessToken: string, branchId: string) {
  return request<BranchSummary>(`/branches/${branchId}/activate`, {
    method: 'POST',
    accessToken,
  });
}

export async function createBranch(
  accessToken: string,
  payload: { code: string; name: string; city: string; address?: string; ownCompanyId?: string },
) {
  return request<BranchSummary>('/branches', { method: 'POST', body: payload, accessToken });
}

export async function updateBranch(
  accessToken: string,
  branchId: string,
  payload: Partial<{ name: string; city: string; address: string; ownCompanyId: string | null; isActive: boolean; sortOrder: number }>,
) {
  return request<BranchSummary>(`/branches/${branchId}`, { method: 'PATCH', body: payload, accessToken });
}

export async function assignBranchManager(accessToken: string, branchId: string, userId: string | null) {
  return request<{ warehouse: BranchSummary; manager: { id: string; name: string; email: string } | null }>(
    `/branches/${branchId}/manager`,
    { method: 'PUT', body: { userId }, accessToken },
  );
}

export async function fetchBranchStockSummary(accessToken: string, clientId?: string) {
  return request<BranchStockSummary[]>(withQuery('/branches/stock-summary', { clientId }), { accessToken });
}

export async function fetchInterBranchTransfers(accessToken: string, clientId?: string) {
  return request<InterBranchTransfer[]>(withQuery('/branches/transfers', { clientId }), { accessToken });
}

export async function previewInterBranchTransferBoxesFile(
  accessToken: string,
  payload: { clientId: string; fromWarehouseId: string; file: File },
) {
  const form = new FormData();
  form.append('file', payload.file);
  return requestMultipart<BranchTransferBoxesFilePreview>(
    withQuery('/branches/transfers/boxes-xlsx/preview', {
      clientId: payload.clientId,
      fromWarehouseId: payload.fromWarehouseId,
    }),
    form,
    accessToken,
  );
}

export async function createInterBranchTransfer(
  accessToken: string,
  payload: {
    clientId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    items?: Array<{ skuId: string; quantity: number }>;
    sourceBoxCodes?: string[];
    comment?: string;
  },
) {
  return request<InterBranchTransfer>('/branches/transfers', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function receiveInterBranchTransferBox(
  accessToken: string,
  transferId: string,
  boxCode: string,
) {
  return request<InterBranchTransfer>(`/branches/transfers/${transferId}/receive-box`, {
    method: 'POST',
    body: { boxCode },
    accessToken,
  });
}

export async function fetchTurnoverReport(
  accessToken: string,
  filter: { clientId?: string; skuId?: string; barcode?: string; kiz?: string; search?: string; dateFrom?: string; dateTo?: string; limit?: number } = {},
) {
  return request<TurnoverReport>(withQuery('/turnover', turnoverReportQuery(filter)), {
    accessToken,
  });
}

export async function fetchTurnoverKizReport(
  accessToken: string,
  filter: {
    clientId: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page?: number;
    limit?: number;
  },
) {
  return request<TurnoverKizReport>(withQuery('/turnover/kiz-report', filter), {
    accessToken,
  });
}

// ADDED: the page and the XLSX send the same period and warehouse filters.
export async function fetchFbsShipmentReport(
  accessToken: string,
  filter: { clientId: string; dateFrom: string; dateTo: string; warehouseId?: string; page?: number; pageSize?: number },
) {
  return request<FbsShipmentReport>(withQuery('/turnover/fbs-stock-reports/shipments', filter), { accessToken });
}

export async function fetchWmsAvailabilityReport(
  accessToken: string,
  filter: { clientId: string; warehouseId?: string },
) {
  return request<WmsAvailabilityReport>(withQuery('/turnover/fbs-stock-reports/availability', filter), { accessToken });
}

export async function downloadFbsShipmentReportXlsx(
  accessToken: string,
  filter: { clientId: string; dateFrom: string; dateTo: string; warehouseId?: string },
) {
  return requestBlob(withQuery('/turnover/fbs-stock-reports/shipments.xlsx', filter), accessToken);
}

export async function fetchFbsBoxStockReport(
  accessToken: string,
  filter: {
    clientId: string;
    warehouseId?: string;
    page?: number;
    pageSize?: number;
    palletPage?: number;
    palletPageSize?: number;
  },
) {
  return request<FbsBoxStockReport>(withQuery('/turnover/fbs-stock-reports/boxes', filter), { accessToken });
}

export async function downloadTurnoverKizReportXlsx(
  accessToken: string,
  filter: { clientId: string; dateFrom?: string; dateTo?: string; search?: string },
) {
  return requestBlob(withQuery('/turnover/kiz-report.xlsx', filter), accessToken);
}

export async function fetchTurnoverSuggestions(
  accessToken: string,
  filter: { clientId?: string; search?: string; scope?: 'client' | 'barcode' } = {},
) {
  return request<TurnoverSuggestions>(withQuery('/turnover/suggestions', {
    clientId: filter.clientId,
    search: filter.search,
    scope: filter.scope,
  }), {
    accessToken,
  });
}

export async function fetchFbsRelabelReconciliation(
  accessToken: string,
  filter: {
    clientId: string;
    dateFrom: string;
    dateTo: string;
    barcode?: string;
    refreshWb?: boolean;
  },
) {
  return request<FbsRelabelReconciliationReport>(
    withQuery('/marketplace-connections/fbs/relabel-reconciliation', {
      clientId: filter.clientId,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      barcode: filter.barcode,
      refreshWb: filter.refreshWb === false ? 'false' : 'true',
    }),
    { accessToken },
  );
}

export async function applyFbsRelabelReconciliation(
  accessToken: string,
  payload: {
    clientId: string;
    issueId: string;
    dateFrom: string;
    dateTo: string;
    barcode?: string;
  },
) {
  return request<{
    applied: boolean;
    message: string;
    report: FbsRelabelReconciliationReport;
  }>('/marketplace-connections/fbs/relabel-reconciliation/apply', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchKizIssues(
  accessToken: string,
  filter: {
    status?: 'open' | 'resolved' | 'all';
    search?: string;
    clientId?: string;
    limit?: number;
  } = {},
) {
  return request<KizIssuesReport>(
    withQuery('/kiz/issues', {
      status: filter.status,
      search: filter.search,
      clientId: filter.clientId,
      limit: filter.limit,
    }),
    { accessToken },
  );
}

export async function resolveKizIssue(
  accessToken: string,
  issueKey: string,
  payload: {
    action:
      | 'REPLACE_KIZ'
      | 'REGISTER_EXTRA_UNIT'
      | 'PREPARE_EXTRA_UNIT'
      | 'RELEASE_BOX'
      | 'MARK_RESOLVED';
    kiz?: string;
    confirmBoxMove?: boolean;
    comment?: string;
  },
) {
  return request<{
    issueKey: string;
    resolved: boolean;
    action:
      | 'REPLACE_KIZ'
      | 'REGISTER_EXTRA_UNIT'
      | 'PREPARE_EXTRA_UNIT'
      | 'RELEASE_BOX'
      | 'MARK_RESOLVED';
    message: string;
  }>(`/kiz/issues/${encodeURIComponent(issueKey)}/resolve`, {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function markKizIssueRead(
  accessToken: string,
  issueKey: string,
) {
  return request<{ issueKey: string; read: boolean }>(
    `/kiz/issues/${encodeURIComponent(issueKey)}/read`,
    {
      method: 'POST',
      accessToken,
    },
  );
}

export async function fetchBoxKizDiscrepancies(
  accessToken: string,
  filter: { search?: string; clientId?: string; limit?: number } = {},
) {
  return request<BoxKizDiscrepancyReport>(
    withQuery('/kiz/discrepancies', filter),
    { accessToken },
  );
}

export async function writeOffBoxKizDiscrepancy(
  accessToken: string,
  boxId: string,
  skuId: string,
  payload: { confirm: true; comment?: string },
) {
  return request<{
    boxId: string;
    boxCode: string;
    skuId: string;
    internalSku: string;
    boxQuantity: number;
    registeredKizBefore: number;
    writtenOffKiz: number;
    registeredKizAfter: number;
    message: string;
  }>(
    `/kiz/discrepancies/${encodeURIComponent(boxId)}/${encodeURIComponent(skuId)}/write-off`,
    { method: 'POST', body: payload, accessToken },
  );
}

export async function writeOffAllBoxKizDiscrepancies(
  accessToken: string,
  filter: { search?: string; clientId?: string },
  payload: { confirm: true; comment?: string },
) {
  return request<{
    bulkWriteOffId: string;
    processedRows: number;
    writtenOffKiz: number;
    failedRows: number;
    failures: Array<{
      boxId: string;
      boxCode: string;
      skuId: string;
      internalSku: string;
      message: string;
    }>;
    remainingRows: number;
    remainingExcessKiz: number;
    message: string;
  }>(withQuery('/kiz/discrepancies/write-off-all', filter), {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function deleteArticleMapping(accessToken: string, id: string) {
  return request<{ id: string; deleted: boolean }>(`/skus/article-mappings/${id}`, {
    method: 'DELETE',
    accessToken,
  });
}

export async function updateNomenclatureItem(
  accessToken: string,
  nomenclatureId: string,
  payload: CreateNomenclaturePayload,
) {
  return request<NomenclatureSummary>(`/skus/nomenclature/${nomenclatureId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function fetchTurnoverBoxDetails(
  accessToken: string,
  boxCode: string,
  filter: { clientId?: string } = {},
) {
  return request<TurnoverBoxDetails>(withQuery(`/turnover/boxes/${encodeURIComponent(boxCode)}`, {
    clientId: filter.clientId,
  }), {
    accessToken,
  });
}

export async function fetchTurnoverStatistics(
  accessToken: string,
  filter: {
    clientId?: string;
    skuId?: string;
    barcode?: string;
    kiz?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    groupBy?: 'day' | 'month' | 'quarter' | 'year';
  } = {},
) {
  return request<TurnoverStatistics>(withQuery('/turnover/statistics', turnoverQuery(filter)), {
    accessToken,
  });
}

export async function fetchTurnoverMovementDocument(accessToken: string, movementId: string) {
  return request<TurnoverMovementDocument>(`/turnover/movements/${movementId}/document`, {
    accessToken,
  });
}

export async function downloadTurnoverMovementDocumentXlsx(accessToken: string, movementId: string) {
  return requestBlob(`/turnover/movements/${movementId}/document.xlsx`, accessToken);
}

export async function downloadTurnoverReceiptPeriodXlsx(
  accessToken: string,
  filter: { clientId?: string; dateFrom?: string; dateTo?: string; receiptBatchDate?: string } = {},
) {
  return requestBlob(withQuery('/turnover/receipts.xlsx', {
    clientId: filter.clientId,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    receiptBatchDate: filter.receiptBatchDate,
  }), accessToken);
}

export async function downloadTurnoverStockXlsx(
  accessToken: string,
  filter: { clientId?: string; ignoreActiveRequests?: boolean } = {},
) {
  return requestBlob(withQuery('/turnover/stock.xlsx', {
    clientId: filter.clientId,
    ignoreActiveRequests: filter.ignoreActiveRequests ? 'true' : 'false',
  }), accessToken);
}

export async function runTurnoverAction(accessToken: string, payload: TurnoverActionPayload) {
  return request<TurnoverActionResult>('/turnover/actions', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchServiceClientStockCleanupPreview(accessToken: string, clientId: string) {
  return request<ServiceClientStockCleanupPreview>(`/service/clients/${clientId}/stock-cleanup`, {
    accessToken,
  });
}

export async function purgeServiceClientStock(accessToken: string, clientId: string, confirmation: string) {
  return request<ServiceClientStockCleanupResult>(`/service/clients/${clientId}/stock-cleanup`, {
    method: 'POST',
    body: { confirmation },
    accessToken,
  });
}

export async function fetchServiceClientRequestsCleanupPreview(accessToken: string, clientId: string) {
  return request<ServiceClientRequestsCleanupPreview>(`/service/clients/${clientId}/requests-cleanup`, {
    accessToken,
  });
}

export async function purgeServiceClientRequests(accessToken: string, clientId: string, confirmation: string) {
  return request<ServiceClientRequestsCleanupResult>(`/service/clients/${clientId}/requests-cleanup`, {
    method: 'POST',
    body: { confirmation },
    accessToken,
  });
}

export async function fetchServiceMaintenance(accessToken: string) {
  return request<ServiceMaintenanceMode>('/service/maintenance', {
    accessToken,
  });
}

export async function updateServiceMaintenance(
  accessToken: string,
  payload: { enabled: boolean; message?: string },
) {
  return request<ServiceMaintenanceMode>('/service/maintenance', {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function fetchServiceSessions(accessToken: string) {
  return request<ServiceSessionSummary[]>('/service/sessions', {
    accessToken,
  });
}

export async function fetchServiceTelegramSettings(accessToken: string, clientId?: string) {
  return request<ServiceTelegramSettings>(withQuery('/service/telegram', { clientId }), {
    accessToken,
  });
}

export async function fetchServiceTelegramGroups(accessToken: string) {
  return request<{ groups: ServiceTelegramGroup[]; warning?: string }>('/service/telegram/groups', {
    accessToken,
  });
}

export async function updateServiceTelegramGlobal(
  accessToken: string,
  payload: { enabled: boolean; botToken: string; fulfillmentChatIds: string[]; sections: TelegramNotificationSection[] },
) {
  return request<ServiceTelegramSettings['global']>('/service/telegram/global', {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function updateServiceTelegramClient(
  accessToken: string,
  clientId: string,
  payload: { enabled: boolean; chatId: string; sections: TelegramNotificationSection[] },
) {
  return request<NonNullable<ServiceTelegramSettings['client']>>(`/service/telegram/clients/${clientId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function testServiceTelegramFulfillment(accessToken: string) {
  return request<{ sent: boolean; reason?: string }>('/service/telegram/test/fulfillment', {
    method: 'POST',
    accessToken,
  });
}

export async function testServiceTelegramClient(accessToken: string, clientId: string) {
  return request<{ sent: boolean; reason?: string }>(`/service/telegram/test/clients/${clientId}`, {
    method: 'POST',
    accessToken,
  });
}

export async function searchServiceKiz(
  accessToken: string,
  filter: { clientId?: string; search?: string },
) {
  return request<ServiceKizSearchRow[]>(withQuery('/service/kiz', filter), {
    accessToken,
  });
}

export async function fetchBillingStorageBreakdown(accessToken: string, chargeId: string) {
  return request<BillingStorageBreakdown>(`/billing/charges/${chargeId}/storage-breakdown`, {
    accessToken,
  });
}

export async function deleteBillingStorageBreakdownDay(accessToken: string, chargeId: string, date: string) {
  return request<BillingStorageBreakdown>(`/billing/charges/${chargeId}/storage-breakdown/${date}`, {
    method: 'DELETE',
    accessToken,
  });
}

export async function fetchStorageOverview(
  accessToken: string,
  filter: { clientId: string; periodFrom?: string; periodTo?: string },
) {
  return request<StorageOverview>(withQuery('/stock/storage', filter), {
    accessToken,
  });
}

export async function downloadStorageOverviewXlsx(
  accessToken: string,
  filter: { clientId: string; periodFrom?: string; periodTo?: string },
) {
  return requestBlob(withQuery('/stock/storage.xlsx', filter), accessToken);
}

export async function updateStorageTariff(
  accessToken: string,
  clientId: string,
  payload: { storagePriceRubPerLiterDay: number },
) {
  return request<Pick<ClientSummary, 'id' | 'code' | 'name' | 'storageAccountingEnabled' | 'storagePriceRubPerLiterDay'>>(
    `/stock/storage/${clientId}/tariff`,
    {
      method: 'PATCH',
      body: payload,
      accessToken,
    },
  );
}

export async function fetchMarketplaceConnections(accessToken: string, filter: { clientId?: string } = {}) {
  return request<MarketplaceConnectionSummary[]>(withQuery('/marketplace-connections', filter), {
    accessToken,
  });
}

export async function closeServiceSession(accessToken: string, sessionId: string) {
  return request<{ id: string; closed: boolean; closedAt: string }>(`/service/sessions/${sessionId}/close`, {
    method: 'POST',
    accessToken,
  });
}

export async function logout(accessToken: string) {
  return request<{ closed: boolean }>('/auth/logout', {
    method: 'POST',
    accessToken,
  });
}

export async function fetchServiceStorageOptimization(accessToken: string, clientId: string) {
  // FIX: report generation does not submit a warehouse operation.
  return request<ServiceStorageOptimizationReport>(`/service/clients/${clientId}/storage-optimization`, {
    accessToken,
  });
}

export async function downloadServiceStorageOptimization(accessToken: string, clientId: string) {
  return requestBlob(`/service/clients/${clientId}/storage-optimization.xlsx`, accessToken);
}

export async function fetchAnalyticsClients(accessToken: string) {
  return request<AnalyticsClientSummary[]>('/analytics/clients', { accessToken });
}

export async function fetchAnalyticsDashboard(accessToken: string, clientId: string) {
  return request<AnalyticsDashboard>(withQuery('/analytics/dashboard', { clientId, limit: 500 }), { accessToken });
}

export async function syncAnalyticsDashboard(accessToken: string, clientId: string, periodDays: 7 | 30 | 90) {
  return request<AnalyticsDashboard>('/analytics/sync', {
    method: 'POST',
    accessToken,
    body: { clientId, periodDays },
  });
}

export async function connectAnalyticsApi(accessToken: string, clientId: string, apiKey: string) {
  return request<{
    client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
    connected: boolean;
    marketplace: string;
    accountName: string | null;
    lastVerifiedAt: string | null;
  }>(`/analytics/connections/${clientId}`, {
    method: 'PUT',
    accessToken,
    body: { apiKey },
  });
}

export async function fetchFbsOrders(accessToken: string, clientId: string, refresh = false) {
  return request<ClientFbsOrders>(
    withQuery('/marketplace-connections/fbs/orders', {
      clientId,
      refresh: refresh ? '1' : undefined,
    }),
    { accessToken },
  );
}

// FIX: live branch audit is deliberately separate from the cached FBS table.
export async function checkFbsBranchDeliveryRecovery(
  accessToken: string,
  clientId: string,
) {
  return request<FbsBranchDeliveryRecoveryReport>(
    withQuery('/marketplace-connections/fbs/delivery-recovery', { clientId }),
    { accessToken },
  );
}

export async function createFbsDeliveryRecoveryRequest(
  accessToken: string,
  payload: FbsOrderSelectionPayload,
) {
  return request<CreateFbsDeliveryRecoveryRequestResult>(
    '/marketplace-connections/fbs/delivery-recovery/request',
    {
      method: 'POST',
      accessToken,
      body: sanitizeFbsOrderSelectionPayload(payload),
    },
  );
}

export async function fetchFbsPackedItems(
  accessToken: string,
  filter: {
    clientId?: string;
    marketplace?: 'ALL' | 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    requiresKiz?: boolean;
    page?: number;
    pageSize?: number;
  },
) {
  return request<FbsPackedItemsReport>(
    withQuery('/marketplace-connections/fbs/packed-items', filter),
    { accessToken },
  );
}

export async function reconcileFbsPackedItems(
  accessToken: string,
  payload: { clientId: string; assemblyIds: string[] },
) {
  return request<{
    checkedAt: string;
    items: Array<{ id: string; comparison: FbsPackedItemComparison }>;
  }>('/marketplace-connections/fbs/packed-items/reconcile', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function fetchFbsProductShipmentReport(
  accessToken: string,
  filter: {
    clientId: string;
    dateFrom: string;
    dateTo: string;
    search?: string;
  },
) {
  return request<FbsProductShipmentReport>(
    withQuery('/marketplace-connections/fbs/product-shipments-report', filter),
    { accessToken },
  );
}

export async function downloadFbsProductShipmentReport(
  accessToken: string,
  filter: {
    clientId: string;
    dateFrom: string;
    dateTo: string;
    search?: string;
  },
) {
  return requestBlob(
    withQuery('/marketplace-connections/fbs/product-shipments-report.xlsx', filter),
    accessToken,
  );
}

export async function fetchFbsPenaltiesReport(
  accessToken: string,
  filter: {
    clientId: string;
    connectionId?: string;
    dateFrom: string;
    dateTo: string;
    search?: string;
  },
) {
  // ADDED: the browser never receives the WB token; WMS performs the finance request.
  return request<FbsPenaltiesReport>(
    withQuery('/marketplace-connections/fbs/penalties-report', filter),
    { accessToken },
  );
}

export async function downloadFbsPenaltiesReport(
  accessToken: string,
  filter: {
    clientId: string;
    connectionId?: string;
    dateFrom: string;
    dateTo: string;
    search?: string;
  },
) {
  return requestBlob(
    withQuery('/marketplace-connections/fbs/penalties-report.xlsx', filter),
    accessToken,
  );
}

export async function fetchFbsActiveClients(
  accessToken: string,
  marketplace?: 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET',
) {
  return request<FbsActiveClientSummary[]>(
    withQuery('/marketplace-connections/fbs/active-clients', { marketplace }),
    { accessToken },
  );
}

export async function fetchFbsCargoPackings(accessToken: string, clientId: string) {
  return request<FbsCargoPackingsResponse>(
    withQuery('/marketplace-connections/fbs/cargo-packings', { clientId }),
    { accessToken },
  );
}

export async function updateFbsCargoPackingIgnore(
  accessToken: string,
  planId: string,
  ignored: boolean,
  reason?: string,
) {
  return request<{
    id: string;
    supplyId: string;
    ignored: boolean;
    ignoredAt: string | null;
    ignoredByName: string | null;
    ignoreReason: string | null;
    message: string;
  }>(`/marketplace-connections/fbs/cargo-packings/${encodeURIComponent(planId)}/ignore`, {
    method: 'PATCH',
    accessToken,
    body: JSON.stringify({ ignored, reason }),
  });
}

export async function fetchFbsStocks(
  accessToken: string,
  clientId: string,
  connectionId?: string,
  warehouseId?: string,
  refreshReserves = false,
) {
  return request<FbsStocksResponse>(
    withQuery('/marketplace-connections/fbs/stocks', {
      clientId,
      connectionId,
      warehouseId,
      refresh: refreshReserves || undefined,
    }),
    { accessToken },
  );
}

export async function updateFbsStockPublication(
  accessToken: string,
  payload: {
    clientId: string;
    connectionId: string;
    warehouseId: string;
    skuId: string;
    enabled: boolean;
    saleLimit?: number | null;
    relabelManualAmount?: number | null;
  },
) {
  return request<{ updated: boolean; skuId: string; enabled: boolean; amount: number; syncedAt: string }>(
    '/marketplace-connections/fbs/stocks/publication',
    { method: 'PUT', accessToken, body: payload },
  );
}

export async function reconcileFbsStockItem(
  accessToken: string,
  payload: { clientId: string; connectionId: string; warehouseId: string; skuId: string },
) {
  return request<{
    corrected: boolean;
    skuId: string;
    previousAmount: number;
    amount: number;
    targetAmount: number;
    checkedAt: string;
  }>('/marketplace-connections/fbs/stocks/reconcile-item', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function updateFbsStockPublicationBulk(
  accessToken: string,
  payload: {
    clientId: string;
    connectionId: string;
    warehouseId: string;
    skuIds: string[];
    enabled: boolean;
    saleLimit?: number | null;
  },
) {
  return request<{
    updated: boolean;
    enabled: boolean;
    requested: number;
    updatedProducts: number;
    synced: number;
    amount: number;
    syncedAt: string;
  }>('/marketplace-connections/fbs/stocks/publication/bulk', {
    method: 'PUT',
    accessToken,
    body: payload,
  });
}

export async function syncFbsStocks(
  accessToken: string,
  payload: { clientId: string; connectionId: string; warehouseId: string },
) {
  return request<{ synced: number; warehouseId: string; syncedAt: string }>(
    '/marketplace-connections/fbs/stocks/sync',
    { method: 'POST', accessToken, body: payload },
  );
}

export async function connectFbsStockWarehouse(
  accessToken: string,
  payload: { clientId: string; connectionId: string; warehouseId: string },
) {
  return request<{
    connected: boolean;
    connectionId: string;
    warehouseId: string;
    warehouseName: string;
    connectedAt: string;
  }>('/marketplace-connections/fbs/stocks/warehouse', {
    method: 'PUT',
    accessToken,
    body: payload,
  });
}

// ADDED: Multi-warehouse stock allocation remains separate from the legacy per-item publication API.
export async function fetchFbsStockAllocation(
  accessToken: string,
  clientId: string,
  connectionId: string,
) {
  return request<FbsStockAllocationResponse>(
    withQuery('/marketplace-connections/fbs/stocks/allocation', { clientId, connectionId }),
    { accessToken },
  );
}

export async function updateFbsStockAllocation(
  accessToken: string,
  payload: {
    clientId: string;
    connectionId: string;
    enabled: boolean;
    lowStockThreshold: number;
    recommendationDays: number;
    shares: Array<{ warehouseId: string; warehouseName?: string; percent: number; isPrimary: boolean }>;
  },
) {
  return request<{ updated: boolean; duplicate: boolean; policyId?: string }>(
    '/marketplace-connections/fbs/stocks/allocation',
    { method: 'PUT', accessToken, body: payload },
  );
}

export async function syncFbsStockAllocation(
  accessToken: string,
  payload: { clientId: string; connectionId: string },
) {
  return request<{ synced: number; products: number; warehouses: number; publishedAmount: number; syncedAt: string }>(
    '/marketplace-connections/fbs/stocks/allocation/sync',
    { method: 'POST', accessToken, body: payload },
  );
}

export async function createFbsStockIntegrationKey(
  accessToken: string,
  payload: { clientId: string; name: string },
) {
  return request<{ id: string; name: string; keyPrefix: string; createdAt: string; apiKey: string }>(
    '/marketplace-connections/fbs/stocks/allocation/api-keys',
    { method: 'POST', accessToken, body: payload },
  );
}

export async function revokeFbsStockIntegrationKey(
  accessToken: string,
  clientId: string,
  keyId: string,
) {
  return request<{ revoked: boolean; keyId: string }>(
    withQuery(`/marketplace-connections/fbs/stocks/allocation/api-keys/${encodeURIComponent(keyId)}`, { clientId }),
    { method: 'DELETE', accessToken },
  );
}

export async function acknowledgeFbsStockAllocationChange(
  accessToken: string,
  clientId: string,
  changeId: string,
) {
  return request<{ acknowledged: boolean; changeId: string; acknowledgedAt: string }>(
    `/marketplace-connections/fbs/stocks/allocation/changes/${encodeURIComponent(changeId)}/acknowledge`,
    { method: 'POST', accessToken, body: { clientId } },
  );
}

export async function fetchFbsWarehouseRoutes(
  accessToken: string,
  connectionId: string,
) {
  return request<FbsWarehouseRoutesResponse>(
    `/marketplace-connections/${encodeURIComponent(connectionId)}/fbs-warehouse-routes`,
    { accessToken },
  );
}

export async function updateFbsWarehouseRoutes(
  accessToken: string,
  connectionId: string,
  payload: UpdateFbsWarehouseRoutesPayload,
) {
  return request<FbsWarehouseRoutesResponse>(
    `/marketplace-connections/${encodeURIComponent(connectionId)}/fbs-warehouse-routes`,
    { method: 'PUT', accessToken, body: payload },
  );
}

export async function assembleFbsOrders(accessToken: string, payload: FbsOrderSelectionPayload) {
  return request<AssembleFbsOrdersResult>('/marketplace-connections/fbs/orders/assemble', {
    method: 'POST',
    accessToken,
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function reshipFbsOrders(accessToken: string, payload: FbsOrderSelectionPayload) {
  return request<AssembleFbsOrdersResult>('/marketplace-connections/fbs/orders/reship', {
    method: 'POST',
    accessToken,
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function moveFbsOrdersToNewSupply(
  accessToken: string,
  payload: FbsOrderSelectionPayload,
) {
  return request<MoveFbsOrdersToNewSupplyResult>(
    '/marketplace-connections/fbs/orders/move-to-new-supply',
    {
      method: 'POST',
      accessToken,
      body: sanitizeFbsOrderSelectionPayload(payload),
    },
  );
}

// ADDED: analyze a failed mixed selection and move every order that remains safe.
export async function repairFbsOrdersMove(
  accessToken: string,
  payload: FbsOrderSelectionPayload,
) {
  return request<RepairFbsOrdersMoveResult>(
    '/marketplace-connections/fbs/orders/repair-move-to-new-supply',
    {
      method: 'POST',
      accessToken,
      body: sanitizeFbsOrderSelectionPayload(payload),
    },
  );
}

export async function cancelFbsOrders(accessToken: string, payload: FbsOrderSelectionPayload) {
  return request<FbsOrderActionResult>('/marketplace-connections/fbs/orders/cancel', {
    method: 'POST',
    accessToken,
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function removeCancelledFbsOrder(accessToken: string, payload: FbsOrderSelectionPayload) {
  return request<{
    removed: boolean;
    requestNumber?: number;
    message: string;
    orders: ClientFbsOrders;
  }>('/marketplace-connections/fbs/orders/remove-cancelled', {
    method: 'POST',
    accessToken,
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function deliverFbsSupplies(accessToken: string, payload: FbsOrderSelectionPayload) {
  return request<FbsOrderActionResult>('/marketplace-connections/fbs/supplies/deliver', {
    method: 'POST',
    accessToken,
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

// ADDED: load the current WB office and the date hint before the irreversible
// supply delivery request.
export async function fetchFbsSupplyDeliveryOptions(
  accessToken: string,
  payload: FbsOrderSelectionPayload,
) {
  return request<FbsSupplyDeliveryOptions>(
    '/marketplace-connections/fbs/supplies/delivery-options',
    {
      method: 'POST',
      accessToken,
      body: sanitizeFbsOrderSelectionPayload(payload),
    },
  );
}

export async function changeFbsSuppliesDestination(
  accessToken: string,
  payload: FbsOrderSelectionPayload,
) {
  return request<ChangeFbsSupplyDestinationResult>('/marketplace-connections/fbs/supplies/change-destination', {
    method: 'POST',
    accessToken,
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function fetchFbsMoveTargets(accessToken: string, payload: FbsOrderSelectionPayload) {
  return request<{
    sourceCity: string;
    candidates: Array<{
      supplyId: string;
      city: string;
      warehouseId: string | null;
      requestId: string;
      requestNumber: number;
      orderCount: number;
      itemCount: number;
    }>;
  }>('/marketplace-connections/fbs/orders/move-targets', {
    method: 'POST',
    accessToken,
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function createFbsRequest(accessToken: string, payload: FbsOrderSelectionPayload) {
  return request<CreateFbsRequestResult>('/marketplace-connections/fbs/orders/request', {
    method: 'POST',
    accessToken,
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function createFbsRequestFromSupply(
  accessToken: string,
  payload: { clientId: string; supplyId: string },
) {
  return request<CreateFbsRequestFromSupplyResult>(
    '/marketplace-connections/fbs/supplies/request',
    {
      method: 'POST',
      accessToken,
      body: payload,
    },
  );
}

export async function auditFbsSupplyRequests(accessToken: string, clientId: string) {
  return request<FbsSupplyRequestAudit>(
    '/marketplace-connections/fbs/supplies/request-audit',
    {
      method: 'POST',
      accessToken,
      body: { clientId },
    },
  );
}

export async function previewFbsSupplyReconciliation(
  accessToken: string,
  payload: { clientId: string; connectionId: string; supplyId: string },
) {
  return request<FbsSupplyReconciliation>(
    '/marketplace-connections/fbs/supplies/reconciliation/preview',
    { method: 'POST', accessToken, body: payload },
  );
}

export async function applyFbsSupplyReconciliation(
  accessToken: string,
  payload: {
    clientId: string;
    connectionId: string;
    supplyId: string;
    fingerprint: string;
  },
) {
  return request<FbsSupplyReconciliation>(
    '/marketplace-connections/fbs/supplies/reconciliation/apply',
    { method: 'POST', accessToken, body: payload },
  );
}

export type FbsEmergencyAssemblyResult = {
  status: 'APPLIED' | 'ALREADY_APPLIED';
  request: {
    id: string;
    number: number;
    status: ClientRequestStatus;
    fbsEmergencyAssemblyAt: string;
    fbsEmergencyAssemblyByUserId: string | null;
    fbsEmergencyAssemblyByName: string | null;
  };
  orders: number;
  shippedOrders: number;
};

export async function enableFbsEmergencyAssembly(accessToken: string, requestId: string) {
  return request<FbsEmergencyAssemblyResult>(
    `/marketplace-connections/fbs/requests/${requestId}/emergency-assembly`,
    {
      method: 'POST',
      accessToken,
    },
  );
}

export async function downloadFbsOrderStickersPdf(accessToken: string, payload: FbsOrderSelectionPayload) {
  return requestBlob('/marketplace-connections/fbs/orders/stickers.pdf', accessToken, {
    method: 'POST',
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function downloadFbsDeadlineSelectedOrdersXlsx(
  accessToken: string,
  payload: FbsOrderSelectionPayload,
) {
  // FIX: send identifiers only; the API re-reads current order, WMS stock and request data.
  return requestBlob('/marketplace-connections/fbs/orders/deadline-report.xlsx', accessToken, {
    method: 'POST',
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function downloadFbsCancelledOrdersXlsx(
  accessToken: string,
  payload: FbsOrderSelectionPayload,
) {
  // FIX: the browser sends identifiers only; the API validates current statuses and access.
  return requestBlob('/marketplace-connections/fbs/orders/cancelled-report.xlsx', accessToken, {
    method: 'POST',
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function fetchKizCirculationOverview(accessToken: string, clientId: string) {
  return request<KizCirculationOverview>(
    withQuery('/kiz-circulation/overview', { clientId }),
    { accessToken },
  );
}

export async function saveKizTrueApiConnection(
  accessToken: string,
  clientId: string,
  payload: {
    inn: string;
    kpp?: string;
    fiasId?: string;
    productGroup: string;
    apiBaseUrl: string;
    apiToken?: string;
    tokenExpiresAt?: string;
    certificateSubject?: string;
    certificateThumbprint?: string;
    isActive?: boolean;
  },
) {
  return request<{ id: string; configured: boolean }>(
    `/kiz-circulation/connections/${encodeURIComponent(clientId)}`,
    { method: 'PUT', body: payload, accessToken },
  );
}

export async function syncKizCirculation(
  accessToken: string,
  clientId: string,
  payload: {
    periodFrom?: string;
    periodTo?: string;
    marketplace?: MarketplaceType;
  } = {},
) {
  return request<{
    scannedShipments: number;
    retireCreated: number;
    returnCreated: number;
    invalidCodes: number;
    periodFrom: string | null;
    periodTo: string | null;
    marketplace: MarketplaceType | null;
  }>(`/kiz-circulation/sync/${encodeURIComponent(clientId)}`, {
    method: 'POST',
    // FIX: период выгрузки передаётся серверу, а не остаётся декоративным фильтром.
    body: payload,
    accessToken,
  });
}

export async function importKizCirculationItems(
  accessToken: string,
  payload: {
    clientId: string;
    operation: KizCirculationOperation;
    marketplace?: MarketplaceType;
    codes: string[];
  },
) {
  return request<{ imported: number }>('/kiz-circulation/items/import', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateKizCirculationItem(
  accessToken: string,
  itemId: string,
  payload: { productCostKopecks?: number; productGroup?: string; excluded?: boolean },
) {
  return request<KizCirculationItem>(`/kiz-circulation/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function checkKizCirculationItems(accessToken: string, clientId: string, itemIds: string[]) {
  return request<{ checked: number }>('/kiz-circulation/items/check', {
    method: 'POST',
    body: { clientId, itemIds },
    accessToken,
  });
}

export async function createKizCirculationBatch(
  accessToken: string,
  payload: {
    clientId: string;
    operation: KizCirculationOperation;
    itemIds: string[];
    actionDate: string;
    documentType: string;
    documentNumber: string;
    documentDate: string;
    primaryDocumentCustomName?: string;
    paid?: boolean;
  },
) {
  return request<KizCirculationBatch>('/kiz-circulation/batches', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function signKizCirculationBatch(accessToken: string, batchId: string, signature: string) {
  return request<{ signed: boolean; payloadHash: string }>(
    `/kiz-circulation/batches/${encodeURIComponent(batchId)}/signature`,
    { method: 'POST', body: { signature }, accessToken },
  );
}

export async function submitKizCirculationBatch(accessToken: string, batchId: string, confirmation: string) {
  return request<{ submitted: boolean; crptDocumentId: string }>(
    `/kiz-circulation/batches/${encodeURIComponent(batchId)}/submit`,
    { method: 'POST', body: { confirmation }, accessToken },
  );
}

export async function refreshKizCirculationBatch(accessToken: string, batchId: string) {
  return request<{ status: string; error: string | null; applied: boolean; rejected: boolean }>(
    `/kiz-circulation/batches/${encodeURIComponent(batchId)}/refresh`,
    { method: 'POST', accessToken },
  );
}

export function resolveInventoryBox(
  accessToken: string,
  auditBoxId: string,
  action: 'APPLY_ACTUAL' | 'ACCEPT_AS_IS',
  comment?: string,
) {
  return request<InventoryAuditBox>(`/inventory/boxes/${auditBoxId}/resolve`, {
    method: 'POST',
    body: { action, comment },
    accessToken,
  });
}

export type WebOrderAssemblyResult = {
  orderId: string; requestId: string; requestNumber:number|null; productName: string; article: string | null;
  boxCode: string | null; stickerBarcode: string; warehouseName:string; contentType: string; imageBase64: string;
};
export type WebOrderAssemblyHistoryItem = { id:string;kiz:string;orderId:string;assemblyId:string;clientId:string;requestId:string;supplyId:string|null;requestNumber:number|null;stickerCode:string|null;printedBy:string;printedAt:string;productName:string|null;article:string|null;size:string|null;color:string|null };

export async function scanWebOrderAssembly(accessToken: string, code: string) {
  return request<WebOrderAssemblyResult>('/marketplace-connections/fbs/web-order-assembly/scan', {
    method: 'POST', accessToken, body: { code },
  });
}
// FIX: optional server-side lookup also finds orders outside the latest 300 history rows.
export async function fetchWebOrderAssemblyHistory(accessToken:string, orderId = '') {
  const query = orderId.trim() ? `?${new URLSearchParams({ orderId: orderId.trim() })}` : '';
  return request<WebOrderAssemblyHistoryItem[]>(`/marketplace-connections/fbs/web-order-assembly/history${query}`, { accessToken });
}
export async function reprintWebOrderAssemblyHistory(accessToken:string,id:string){return request<WebOrderAssemblyResult>(`/marketplace-connections/fbs/web-order-assembly/history/${id}/reprint`,{method:'POST',accessToken});}
export async function deleteWebOrderAssemblyHistory(accessToken:string,id:string){return request<{deleted:boolean;orderId:string}>(`/marketplace-connections/fbs/web-order-assembly/history/${id}`,{method:'DELETE',accessToken});}

export async function downloadFbsCargoPlaceStickersPdf(
  accessToken: string,
  payload: FbsOrderSelectionPayload,
) {
  return requestBlob('/marketplace-connections/fbs/orders/cargo-place-stickers.pdf', accessToken, {
    method: 'POST',
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function downloadFbsSupplyStickersPdf(
  accessToken: string,
  payload: FbsOrderSelectionPayload,
) {
  return requestBlob('/marketplace-connections/fbs/orders/supply-stickers.pdf', accessToken, {
    method: 'POST',
    body: sanitizeFbsOrderSelectionPayload(payload),
  });
}

export async function downloadFbsRequestPickListPdf(accessToken: string, requestId: string) {
  return requestBlob(`/marketplace-connections/fbs/requests/${requestId}/pick-list.pdf`, accessToken);
}

export async function createFbsMarketplaceConnection(
  accessToken: string,
  payload: UpsertMarketplaceConnectionPayload & { marketplace: 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET' },
) {
  return request<MarketplaceConnectionSummary>('/marketplace-connections/fbs/connections', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchFbsPasses(accessToken: string, clientId: string, connectionId?: string) {
  return request<FbsPassesResponse>(
    withQuery('/marketplace-connections/fbs/passes', { clientId, connectionId }),
    { accessToken },
  );
}

export async function createFbsPass(accessToken: string, payload: FbsPassPayload) {
  return request<{ id: number; created: boolean }>('/marketplace-connections/fbs/passes', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function updateFbsPass(accessToken: string, passId: number, payload: FbsPassPayload) {
  return request<{ id: number; updated: boolean }>(`/marketplace-connections/fbs/passes/${passId}`, {
    method: 'PUT',
    accessToken,
    body: payload,
  });
}

export async function deleteFbsPass(
  accessToken: string,
  passId: number,
  clientId: string,
  connectionId: string,
) {
  return request<{ id: number; deleted: boolean }>(
    withQuery(`/marketplace-connections/fbs/passes/${passId}`, { clientId, connectionId }),
    { method: 'DELETE', accessToken },
  );
}

export async function fetchFbsBillingSettings(accessToken: string, clientId: string) {
  return request<FbsBillingSettings>(`/marketplace-connections/fbs/billing-settings/${clientId}`, {
    accessToken,
  });
}

export async function updateFbsBillingSettings(
  accessToken: string,
  clientId: string,
  payload: UpdateFbsBillingSettingsPayload,
) {
  return request<FbsBillingSettings>(`/marketplace-connections/fbs/billing-settings/${clientId}`, {
    method: 'PUT',
    body: payload,
    accessToken,
  });
}

export async function fetchFbsCalculatorDestinations(accessToken: string) {
  return request<{ destinations: string[] }>('/marketplace-connections/fbs/calculator/destinations', {
    accessToken,
  });
}

export async function quoteFbsCalculator(
  accessToken: string,
  payload: { quantity: number; destination: string },
) {
  return request<FbsCalculatorQuote>('/marketplace-connections/fbs/calculator/quote', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function createMarketplaceConnection(accessToken: string, payload: UpsertMarketplaceConnectionPayload) {
  return request<MarketplaceConnectionSummary>('/marketplace-connections', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateMarketplaceConnection(
  accessToken: string,
  connectionId: string,
  payload: Partial<UpsertMarketplaceConnectionPayload>,
) {
  return request<MarketplaceConnectionSummary>(`/marketplace-connections/${connectionId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function deleteMarketplaceConnection(accessToken: string, connectionId: string) {
  return request<{ id: string; marketplace: MarketplaceType; accountName: string | null; deleted: true }>(
    `/marketplace-connections/${connectionId}`,
    {
      method: 'DELETE',
      accessToken,
    },
  );
}

export async function syncMarketplaceProducts(accessToken: string, connectionId: string) {
  return request<MarketplaceProductSyncResult>(`/marketplace-connections/${connectionId}/sync-products`, {
    method: 'POST',
    accessToken,
  });
}

export async function fetchDbsIntegrations(
  accessToken: string,
  filter: { clientId?: string; marketplace?: 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET' } = {},
) {
  return request<DbsIntegrationSummary[]>(withQuery('/marketplace-connections/dbs/integrations', filter), {
    accessToken,
  });
}

export async function createDbsIntegration(accessToken: string, payload: UpsertDbsIntegrationPayload) {
  return request<DbsIntegrationSummary>('/marketplace-connections/dbs/integrations', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateDbsIntegration(
  accessToken: string,
  integrationId: string,
  payload: Partial<UpsertDbsIntegrationPayload>,
) {
  return request<DbsIntegrationSummary>(
    `/marketplace-connections/dbs/integrations/${encodeURIComponent(integrationId)}`,
    { method: 'PATCH', body: payload, accessToken },
  );
}

export async function checkDbsIntegration(accessToken: string, integrationId: string) {
  return request<DbsIntegrationSummary & { check: { ok: boolean; message: string } }>(
    `/marketplace-connections/dbs/integrations/${encodeURIComponent(integrationId)}/check`,
    { method: 'POST', accessToken },
  );
}

export async function checkMarketplaceConnection(accessToken: string, connectionId: string) {
  return request<MarketplaceConnectionCheckResult>(`/marketplace-connections/${connectionId}/check`, {
    method: 'POST',
    accessToken,
  });
}

export async function fetchBoxes(
  accessToken: string,
  filter: { clientId?: string; code?: string; archive?: boolean } = {},
) {
  return request<WarehouseBoxSummary[]>(withQuery('/warehouse/boxes', filter), {
    accessToken,
  });
}

export async function fetchWarehouseBoxChecks(accessToken: string, clientId?: string) {
  return request<WarehouseBoxCheck[]>(
    withQuery('/warehouse/box-checks', { clientId }),
    { accessToken },
  );
}

export async function runWarehouseBoxCheck(
  accessToken: string,
  payload: { periodFrom: string; periodTo: string; clientId?: string },
) {
  return request<WarehouseBoxCheck>('/warehouse/box-checks', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function decideWarehouseBoxCheckRow(
  accessToken: string,
  rowId: string,
  payload: {
    action: 'WRITE_OFF' | 'KEEP_AS_IS' | 'SET_QUANTITY';
    quantity?: number;
    comment?: string;
  },
) {
  return request<WarehouseBoxCheck>(`/warehouse/box-check-rows/${rowId}/decision`, {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function fetchShippedKizHistory(
  accessToken: string,
  filter: {
    clientId?: string;
    periodFrom?: string;
    periodTo?: string;
    search?: string;
  } = {},
) {
  return request<ShippedKizHistoryRow[]>(
    withQuery('/warehouse/shipment-history', filter),
    { accessToken },
  );
}

export async function syncShippedKizHistory(accessToken: string, clientId?: string) {
  return request<{ checkedRequests: number; added: number }>(
    '/warehouse/shipment-history/sync',
    {
      method: 'POST',
      accessToken,
      body: { clientId },
    },
  );
}

export async function fetchStorageLayout(
  accessToken: string,
  filter: { warehouseId?: string; query?: string; sync?: boolean } = {},
) {
  return request<StorageLayout>(
    withQuery('/warehouse/storage-locations', {
      warehouseId: filter.warehouseId,
      query: filter.query,
      sync: filter.sync === undefined ? undefined : String(filter.sync),
    }),
    { accessToken },
  );
}

export async function syncStorageLayout(accessToken: string, warehouseId?: string, clientId?: string) {
  return request<StorageLayout>('/warehouse/storage-locations/sync-google', {
    method: 'POST',
    accessToken,
    body: { warehouseId, clientId },
  });
}

export async function createStorageZone(
  accessToken: string,
  payload: { warehouseId: string; name: string; code?: string },
) {
  return request<StorageLayout['zones'][number]>('/warehouse/storage-locations/zones', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function deleteStorageZone(accessToken: string, id: string) {
  return request<{ id: string; code: string; name: string; deleted: true }>(
    `/warehouse/storage-locations/zones/${id}`,
    { method: 'DELETE', accessToken },
  );
}

export async function createStoragePallet(
  accessToken: string,
  payload: { warehouseId: string; clientId: string; code: string; zoneId?: string },
) {
  return request<StorageLayout['pallets'][number]>('/warehouse/storage-locations/pallets', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function updateStoragePallet(
  accessToken: string,
  id: string,
  payload: { zoneId?: string | null; status?: string },
) {
  return request<StorageLayout['pallets'][number]>(`/warehouse/storage-locations/pallets/${id}`, {
    method: 'PATCH',
    accessToken,
    body: payload,
  });
}

export async function deleteStoragePallet(accessToken: string, id: string) {
  return request<{ id: string; code: string; deleted: true; detachedBoxCount: number }>(
    `/warehouse/storage-locations/pallets/${id}`,
    { method: 'DELETE', accessToken },
  );
}

export async function clearStoragePallet(accessToken: string, id: string) {
  return request<{ id: string; code: string; cleared: true; clearedCount: number }>(
    `/warehouse/storage-locations/pallets/${id}/clear`,
    { method: 'POST', accessToken },
  );
}

export async function deleteStoragePallets(accessToken: string, ids: string[]) {
  return request<{
    deleted: Array<{ id: string; code: string }>;
    deletedCount: number;
    detachedBoxCount: number;
  }>('/warehouse/storage-locations/pallets/bulk-delete', {
    method: 'POST',
    accessToken,
    body: { ids },
  });
}

export async function addStoragePalletBox(accessToken: string, palletId: string, boxCode: string) {
  return request<{ warning?: string | null }>(`/warehouse/storage-locations/pallets/${palletId}/boxes`, {
    method: 'POST',
    accessToken,
    body: { boxCode },
  });
}

export async function relocateStoragePalletBox(
  accessToken: string,
  payload: { boxCode: string; targetPalletId: string; swapBoxCode?: string },
) {
  return request<{
    mode: 'MOVED' | 'SWAPPED';
    boxCode: string;
    fromPallet: { id: string; code: string };
    toPallet: { id: string; code: string };
    swappedBoxCode: string | null;
    changedAt: string;
    message: string;
  }>('/warehouse/storage-locations/pallets/boxes/relocate', {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function removeStoragePalletBox(accessToken: string, palletId: string, boxCode: string) {
  return request<{ removed: true; boxCode: string; palletCode: string }>(
    `/warehouse/storage-locations/pallets/${palletId}/boxes/${encodeURIComponent(boxCode)}`,
    { method: 'DELETE', accessToken },
  );
}

export async function fetchOnlineReceipts(accessToken: string, filter: { clientId?: string } = {}) {
  return request<OnlineReceiptOverview>(withQuery('/warehouse/online-receipts', filter), {
    accessToken,
  });
}

export async function fetchReceiptBatches(accessToken: string, clientId: string) {
  return request<ReceiptBatchSummary[]>(withQuery('/warehouse/receipt-batches', { clientId }), { accessToken });
}

export async function fetchGoodsArrivals(
  accessToken: string,
  filter: { clientId: string; periodFrom?: string; periodTo?: string },
) {
  return request<GoodsArrivalSummary[]>(withQuery('/warehouse/goods-arrivals', filter), { accessToken });
}

export async function fetchGoodsArrivalEstimate(accessToken: string, clientId: string) {
  return request<GoodsArrivalEstimate>(withQuery('/warehouse/goods-arrivals/summary', { clientId }), { accessToken });
}

export async function createGoodsArrival(
  accessToken: string,
  payload: { clientId: string; arrivalDate: string; bagCount: number; boxCount: number; comment?: string },
) {
  return request<GoodsArrivalSummary>('/warehouse/goods-arrivals', { method: 'POST', accessToken, body: payload });
}

export async function deleteGoodsArrival(accessToken: string, id: string) {
  return request<GoodsArrivalSummary>(`/warehouse/goods-arrivals/${id}`, { method: 'DELETE', accessToken });
}

export async function billGoodsArrivals(
  accessToken: string,
  payload: { clientId: string; periodFrom: string; periodTo: string },
) {
  return request<BillingInvoiceSummary>('/warehouse/goods-arrivals/bill', { method: 'POST', accessToken, body: payload });
}

export async function openOnlineReceiptBox(accessToken: string, payload: Pick<OnlineReceiptItemPayload, 'clientId' | 'boxCode' | 'sourceDocument' | 'comment'>) {
  return request<{ boxId: string; boxCode: string; status: string; sourceDocument: string }>('/warehouse/online-receipts/boxes/open', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function closeOnlineReceiptBox(accessToken: string, payload: Pick<OnlineReceiptItemPayload, 'clientId' | 'boxCode' | 'sourceDocument' | 'comment'>) {
  return request<{ boxId: string; boxCode: string; status: string }>('/warehouse/online-receipts/boxes/close', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function closeAllOnlineReceiptBoxes(
  accessToken: string,
  payload: Pick<OnlineReceiptItemPayload, 'clientId' | 'comment'> & { batchDate?: string },
) {
  return request<{ closed: number; boxes: string[]; status: string }>('/warehouse/online-receipts/boxes/close-open', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function finishOnlineReceipt(
  accessToken: string,
  payload: Pick<OnlineReceiptItemPayload, 'clientId' | 'comment'> & { batchDate?: string },
) {
  return request<{
    finished: boolean;
    finishedAt: string;
    boxes: number;
    closedBoxes: number;
    quantity: number;
    kizCount: number;
    telegram: { sent: boolean; reason?: string };
  }>('/warehouse/online-receipts/finish', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function deleteOnlineReceiptBox(accessToken: string, payload: Pick<OnlineReceiptItemPayload, 'clientId' | 'boxCode' | 'sourceDocument' | 'comment'>) {
  return request<{ boxCode: string; status: string }>('/warehouse/online-receipts/boxes', {
    method: 'DELETE',
    body: payload,
    accessToken,
  });
}

export async function restoreOnlineReceiptBox(accessToken: string, payload: Pick<OnlineReceiptItemPayload, 'clientId' | 'boxCode' | 'sourceDocument' | 'comment'>) {
  return request<{ boxCode: string; status: string; restoredItems: number }>('/warehouse/online-receipts/boxes/restore', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function addOnlineReceiptItem(accessToken: string, payload: OnlineReceiptItemPayload) {
  return request<{ status: string }>('/warehouse/online-receipts/items', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateOnlineReceiptItem(
  accessToken: string,
  movementId: string,
  payload: { quantity?: number; kiz?: string; comment?: string },
) {
  return request<{ id: string; updated: true }>(`/warehouse/online-receipts/items/${movementId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function deleteOnlineReceiptItem(accessToken: string, movementId: string, payload: { comment?: string } = {}) {
  return request<{ id: string; deleted: true }>(`/warehouse/online-receipts/items/${movementId}`, {
    method: 'DELETE',
    body: payload,
    accessToken,
  });
}

export async function fetchPallets(accessToken: string, filter: { clientId?: string } = {}) {
  return request<WarehousePalletSummary[]>(withQuery('/warehouse/pallets', filter), {
    accessToken,
  });
}

export async function fetchRoles(accessToken: string) {
  return request<RoleSummary[]>('/users/roles', {
    accessToken,
  });
}

export async function fetchUsers(accessToken: string) {
  return request<UserSummary[]>('/users', {
    accessToken,
  });
}

export async function createUser(accessToken: string, payload: CreateUserPayload) {
  return request<UserSummary>('/users', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateUserClientScopes(
  accessToken: string,
  userId: string,
  payload: UpdateUserClientScopesPayload,
) {
  return request<Pick<UserSummary, 'id' | 'email' | 'name' | 'status' | 'clientScopes'>>(
    `/users/${userId}/client-scopes`,
    {
      method: 'PATCH',
      body: payload,
      accessToken,
    },
  );
}

export async function fetchUserReferralClients(accessToken: string, userId: string) {
  return request<UserReferralClientSummary[]>(`/users/${userId}/referrals`, {
    accessToken,
  });
}

export async function updateUserReferralClients(
  accessToken: string,
  userId: string,
  payload: UpdateUserReferralClientsPayload,
) {
  return request<UserReferralClientSummary[]>(`/users/${userId}/referrals`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function updateUserRoles(accessToken: string, userId: string, payload: UpdateUserRolesPayload) {
  return request<UserSummary>(`/users/${userId}/roles`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function updateUserProfile(accessToken: string, userId: string, payload: UpdateUserProfilePayload) {
  return request<UserSummary>(`/users/${userId}/profile`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function setUserTsdActivationCode(accessToken: string, userId: string, code: string) {
  return request<UserSummary>(`/users/${userId}/tsd-activation-code`, {
    method: 'PATCH',
    body: { code },
    accessToken,
  });
}

export async function clearUserTsdActivationCode(accessToken: string, userId: string) {
  return request<UserSummary>(`/users/${userId}/tsd-activation-code`, {
    method: 'DELETE',
    accessToken,
  });
}

export async function updateUserPrinterScopes(
  accessToken: string,
  userId: string,
  payload: UpdateUserPrinterScopesPayload,
) {
  return request<UserSummary>(`/users/${userId}/printer-scopes`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function fetchReferralReport(
  accessToken: string,
  filter: { periodFrom?: string; periodTo?: string } = {},
) {
  return request<ReferralReport>(withQuery('/referrals/report', filter), {
    accessToken,
  });
}

export async function fetchTsdDevices(accessToken: string) {
  return request<TsdDeviceSummary[]>('/tsd/devices', {
    accessToken,
  });
}

export async function fetchTsdAssemblyPlan(accessToken: string, requestId: string) {
  return request<TsdAssemblyPlan>(`/tsd/requests/${requestId}`, {
    accessToken,
  });
}

export async function resolveTsdFbsKizConflict(
  accessToken: string,
  requestId: string,
  assemblyId: string,
) {
  return request<{
    resolved: boolean;
    assemblyId: string;
    orderId: string;
    requestId: string;
    conflictingOrderId?: string | null;
    conflictingRequestNumber?: number | null;
    message: string;
  }>(`/tsd/requests/${requestId}/fbs-kiz-conflicts/${assemblyId}/resolve`, {
    method: 'POST',
    accessToken,
  });
}

export async function restoreTsdFbsRescanFromWildberries(
  accessToken: string,
  requestId: string,
  assemblyId: string,
) {
  return request<{
    resolved: boolean;
    assemblyId: string;
    orderId: string;
    requestId: string;
    message: string;
  }>(`/tsd/requests/${requestId}/fbs-rescan/${assemblyId}/restore-from-wb`, {
    method: 'POST',
    accessToken,
  });
}

export type FbsSyncConflictResolutionAction =
  | 'RETURN_TO_STOCK'
  | 'MANAGER_CONFIRMED';

export async function resolveTsdFbsSyncConflict(
  accessToken: string,
  requestId: string,
  assemblyId: string,
  payload: {
    action: FbsSyncConflictResolutionAction;
    comment?: string;
  },
) {
  return request<{
    resolved: boolean;
    assemblyId: string;
    orderId: string;
    requestId: string;
    action: FbsSyncConflictResolutionAction;
    message: string;
  }>(`/tsd/requests/${requestId}/fbs-sync-conflicts/${assemblyId}/resolve`, {
    method: 'POST',
    accessToken,
    body: payload,
  });
}

export async function resetTsdFbsAssemblyOrder(
  accessToken: string,
  requestId: string,
  assemblyId: string,
) {
  return request<{
    reset: boolean;
    assemblyId: string;
    orderId: string;
    requestId: string;
    message: string;
  }>(`/tsd/requests/${requestId}/fbs-assembly/${assemblyId}/reset`, {
    method: 'POST',
    accessToken,
  });
}

export async function markTsdFbsAssemblyPackedWithoutSource(
  accessToken: string,
  requestId: string,
  assemblyId: string,
) {
  return request<{
    completed: boolean;
    assemblyId: string;
    orderId: string;
    requestId: string;
    sourceBoxPending: boolean;
    message: string;
  }>(`/tsd/requests/${requestId}/fbs-assembly/${assemblyId}/packed-without-source`, {
    method: 'POST',
    accessToken,
  });
}

/**
 * Publishes the current request composition to the handheld queue.  The TSD
 * receives the refreshed plan on its next queue request; repeating this call
 * is safe and is used when a newly-created request has not appeared yet.
 */
export async function syncClientRequestToTsd(accessToken: string, requestId: string) {
  return request<{ message?: string; mode?: 'FBS' | string; requiresEmergencyAssembly?: boolean; totalOrders?: number; activeOrders?: number }>(`/client-requests/${requestId}/sync-tsd`, {
    method: 'POST',
    accessToken,
  });
}

export async function downloadTsdOutgoingBoxesXlsx(accessToken: string, requestId: string) {
  return requestBlob(`/tsd/requests/${requestId}/outgoing-boxes.xlsx`, accessToken);
}

export async function downloadTsdOutgoingContentsXlsx(accessToken: string, requestId: string) {
  return requestBlob(`/tsd/requests/${requestId}/outgoing-contents.xlsx`, accessToken);
}

export async function downloadTsdMovementsXlsx(accessToken: string, requestId: string) {
  return requestBlob(`/tsd/requests/${requestId}/movements.xlsx`, accessToken);
}

export async function createTsdDevice(accessToken: string, payload: CreateTsdDevicePayload) {
  return request<CreatedTsdDevice>('/tsd/devices', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchTsdReviewQueue(accessToken: string) {
  return request<TsdReviewOperation[]>('/tsd/review', {
    accessToken,
  });
}

export async function fetchTsdReviewHistory(accessToken: string) {
  return request<TsdReviewOperation[]>('/tsd/review/history', {
    accessToken,
  });
}

export async function fetchTsdOperationHistory(
  accessToken: string,
  filters: TsdOperationHistoryFilters = {},
) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  return request<TsdOperationHistoryPage>(`/tsd/history${query.size ? `?${query}` : ''}`, {
    accessToken,
  });
}

export async function fetchTsdOperationHistoryItem(accessToken: string, operationId: string) {
  return request<TsdOperationHistoryItem>(`/tsd/history/${operationId}`, { accessToken });
}

export async function fetchTsdOperationScreenshot(accessToken: string, operationId: string) {
  return requestBlob(`/tsd/history/${operationId}/screenshot`, accessToken);
}

export async function resolveTsdReviewOperation(
  accessToken: string,
  operationId: string,
  payload: ResolveTsdReviewPayload,
) {
  return request<ResolveTsdReviewResult>(`/tsd/review/${operationId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function fetchLogisticsTariffSets(accessToken: string) {
  return request<LogisticsTariffSetSummary[]>('/logistics/tariff-sets', {
    accessToken,
  });
}

export async function fetchLogisticsTariffSet(accessToken: string, tariffSetId: string) {
  return request<LogisticsTariffSetDetail>(`/logistics/tariff-sets/${tariffSetId}`, {
    accessToken,
  });
}

export async function downloadTsdReceiptReviewBoxesXlsx(accessToken: string, clientId?: string) {
  return requestBlob(withQuery('/tsd/review/receipts.xlsx', { clientId }), accessToken);
}

export async function fetchTsdReceiptReviewDashboard(accessToken: string) {
  return request<TsdReceiptReviewDashboard>('/tsd/review/receipts', {
    accessToken,
  });
}

export async function fetchLogisticsDestinationSuggestions(
  accessToken: string,
  filter: { search?: string; tariffSetId?: string } = {},
) {
  return request<LogisticsDestinationSuggestion[]>(withQuery('/logistics/destinations', filter), {
    accessToken,
  });
}

export async function fetchLogisticsCarriers(accessToken: string) {
  return request<LogisticsCarrierSummary[]>('/logistics/carriers', {
    accessToken,
  });
}

export async function createLogisticsCarrier(accessToken: string, payload: CreateLogisticsCarrierPayload) {
  return request<LogisticsCarrierSummary>('/logistics/carriers', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchLogisticsTrips(
  accessToken: string,
  filter: { carrierId?: string; status?: LogisticsTripStatus } = {},
) {
  return request<LogisticsTripSummary[]>(withQuery('/logistics/trips', filter), {
    accessToken,
  });
}

export async function createLogisticsTrip(accessToken: string, payload: CreateLogisticsTripPayload) {
  return request<LogisticsTripSummary>('/logistics/trips', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateLogisticsTripStatus(
  accessToken: string,
  tripId: string,
  payload: { status: LogisticsTripStatus; comment?: string },
) {
  return request<LogisticsTripSummary>(`/logistics/trips/${tripId}/status`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function fetchLogisticsDeliveryRequests(
  accessToken: string,
  filter: { clientId?: string; status?: LogisticsDeliveryStatus } = {},
) {
  return request<LogisticsDeliveryRequestSummary[]>(withQuery('/logistics/delivery-requests', filter), {
    accessToken,
  });
}

export async function quoteLogistics(accessToken: string, payload: LogisticsQuotePayload) {
  return request<LogisticsQuoteResult>('/logistics/quote', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function createLogisticsDeliveryRequest(
  accessToken: string,
  payload: CreateLogisticsDeliveryRequestPayload,
) {
  return request<LogisticsDeliveryRequestSummary>('/logistics/delivery-requests', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateLogisticsDeliveryStatus(
  accessToken: string,
  deliveryId: string,
  payload: { status: LogisticsDeliveryStatus; plannedShipDate?: string; managerComment?: string },
) {
  return request<LogisticsDeliveryRequestSummary>(`/logistics/delivery-requests/${deliveryId}/status`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function finalizeLogisticsDeliveryQuote(
  accessToken: string,
  deliveryId: string,
  payload: FinalizeLogisticsDeliveryQuotePayload,
) {
  return request<LogisticsDeliveryRequestSummary>(`/logistics/delivery-requests/${deliveryId}/quote`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function generateLogisticsDeliveryBillingCharge(accessToken: string, deliveryId: string) {
  return request<LogisticsDeliveryRequestSummary>(`/logistics/delivery-requests/${deliveryId}/billing-charge`, {
    method: 'POST',
    accessToken,
  });
}

export async function assignLogisticsDeliveryTrip(accessToken: string, deliveryId: string, payload: { tripId?: string | null }) {
  return request<LogisticsDeliveryRequestSummary>(`/logistics/delivery-requests/${deliveryId}/trip`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function previewBoxLabel(accessToken: string, payload: BoxLabelPreviewPayload) {
  return request<BoxLabelPreview>('/print/box-label/preview', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function previewSkuLabel(accessToken: string, payload: SkuLabelPreviewPayload) {
  return request<LabelPreview>('/print/sku-label/preview', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function previewPalletLabel(accessToken: string, payload: PalletLabelPreviewPayload) {
  return request<LabelPreview>('/print/pallet-label/preview', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchLabelTemplates(accessToken: string, filter: { type?: LabelTemplateType } = {}) {
  return request<LabelTemplateSummary[]>(withQuery('/print/templates', filter), {
    accessToken,
  });
}

export async function createLabelTemplate(accessToken: string, payload: CreateLabelTemplatePayload) {
  return request<LabelTemplateSummary>('/print/templates', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updateLabelTemplate(accessToken: string, templateId: string, payload: UpdateLabelTemplatePayload) {
  return request<LabelTemplateSummary>(`/print/templates/${templateId}`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function fetchLabelTemplateVersions(accessToken: string, templateId: string) {
  return request<LabelTemplateVersionSummary[]>(`/print/templates/${templateId}/versions`, {
    accessToken,
  });
}

export async function previewLabelTemplate(accessToken: string, templateId: string, payload: PreviewLabelTemplatePayload) {
  return request<LabelPreview>(`/print/templates/${templateId}/preview`, {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchPrintJobs(
  accessToken: string,
  filter: { status?: PrintJobStatus; limit?: string; groupCode?: string } = {},
) {
  return request<PrintJobSummary[]>(withQuery('/print/jobs', filter), {
    accessToken,
  });
}

export async function fetchPrintPrinters(accessToken: string) {
  return request<PrintPrinterSummary[]>('/print/printers', {
    accessToken,
  });
}

export async function fetchPrintPrinterGroups(accessToken: string) {
  return request<PrintPrinterGroupSummary[]>('/print/printer-groups', {
    accessToken,
  });
}

export async function upsertPrintPrinter(accessToken: string, payload: UpsertPrintPrinterPayload) {
  return request<PrintPrinterSummary>('/print/printers', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function processPrintQueue(accessToken: string, payload: { limit?: number; groupCode?: string } = {}) {
  return request<ProcessPrintQueueResult>('/print/jobs/process', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function createPrintJobFromTemplate(
  accessToken: string,
  templateId: string,
  payload: CreatePrintJobFromTemplatePayload,
) {
  return request<PrintJobSummary>(`/print/templates/${templateId}/jobs`, {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function updatePrintJobStatus(
  accessToken: string,
  jobId: string,
  payload: { status: PrintJobStatus; message?: string },
) {
  return request<PrintJobSummary>(`/print/jobs/${jobId}/status`, {
    method: 'PATCH',
    body: payload,
    accessToken,
  });
}

export async function reprintPrintJob(accessToken: string, jobId: string, payload: { reason?: string } = {}) {
  return request<PrintJobSummary>(`/print/jobs/${jobId}/reprint`, {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function previewStockImport(accessToken: string, payload: { file: File; clientId: string }) {
  const form = new FormData();
  form.append('file', payload.file);
  form.append('clientId', payload.clientId);

  return requestMultipart<StockImportPreview>('/imports/stocks/preview', form, accessToken);
}

export async function commitStockImport(
  accessToken: string,
  payload: { file: File; clientId: string; sourceDocument?: string; stockDate?: string },
) {
  const form = new FormData();
  form.append('file', payload.file);
  form.append('clientId', payload.clientId);
  if (payload.sourceDocument) {
    form.append('sourceDocument', payload.sourceDocument);
  }
  if (payload.stockDate) {
    form.append('stockDate', payload.stockDate);
  }

  return requestMultipart<StockImportCommitResult>('/imports/stocks/commit', form, accessToken);
}

export async function previewReceiptImport(accessToken: string, payload: { file: File; clientId: string }) {
  const form = new FormData();
  form.append('file', payload.file);
  form.append('clientId', payload.clientId);

  return requestMultipart<ReceiptImportPreview>('/imports/receipts/preview', form, accessToken);
}

export async function commitReceiptImport(
  accessToken: string,
  payload: { file: File; clientId: string; sourceDocument?: string },
) {
  const form = new FormData();
  form.append('file', payload.file);
  form.append('clientId', payload.clientId);
  if (payload.sourceDocument) {
    form.append('sourceDocument', payload.sourceDocument);
  }

  return requestMultipart<ReceiptImportCommitResult>('/imports/receipts/commit', form, accessToken);
}

export async function previewLogisticsImport(accessToken: string, payload: { file: File }) {
  const form = new FormData();
  form.append('file', payload.file);

  return requestMultipart<LogisticsImportPreview>('/imports/logistics/preview', form, accessToken);
}

export async function commitLogisticsImport(
  accessToken: string,
  payload: { file: File; name?: string; activeFrom?: string; activeTo?: string },
) {
  const form = new FormData();
  form.append('file', payload.file);
  if (payload.name) {
    form.append('name', payload.name);
  }
  if (payload.activeFrom) {
    form.append('activeFrom', payload.activeFrom);
  }
  if (payload.activeTo) {
    form.append('activeTo', payload.activeTo);
  }

  return requestMultipart<LogisticsImportCommitResult>('/imports/logistics/commit', form, accessToken);
}

export async function transferBetweenBoxes(accessToken: string, payload: TransferBetweenBoxesPayload) {
  return request<TransferBetweenBoxesResult>('/stock/transfers/box-to-box', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function importBoxTransfersXlsx(accessToken: string, clientId: string, file: File) {
  const form = new FormData();
  form.append('file', file);

  return requestMultipart<BoxTransferCommitResult>(
    withQuery('/stock/transfers/box-to-box/import-xlsx', { clientId }),
    form,
    accessToken,
  );
}

export async function previewBoxTransfersXlsx(accessToken: string, clientId: string, file: File) {
  const form = new FormData();
  form.append('file', file);

  return requestMultipart<BoxTransferPreview>(
    withQuery('/stock/transfers/box-to-box/preview-xlsx', { clientId }),
    form,
    accessToken,
  );
}

export async function commitBoxTransfersXlsx(accessToken: string, clientId: string, file: File) {
  const form = new FormData();
  form.append('file', file);

  return requestMultipart<BoxTransferCommitResult>(
    withQuery('/stock/transfers/box-to-box/commit-xlsx', { clientId }),
    form,
    accessToken,
  );
}

export async function fetchBoxTransferBatches(accessToken: string, clientId: string) {
  return request<StockTransferBatch[]>(withQuery('/stock/transfers/box-to-box/batches', { clientId }), {
    accessToken,
  });
}

export async function downloadBoxTransferBatchFile(accessToken: string, batchId: string) {
  return requestBlob(`/stock/transfers/box-to-box/batches/${batchId}/file`, accessToken);
}

export async function reverseBoxTransferBatch(accessToken: string, batchId: string) {
  return request<{
    status: 'REVERSED' | 'ALREADY_REVERSED';
    reversedRows?: number;
    quantity?: number;
    batch: StockTransferBatch;
  }>(`/stock/transfers/box-to-box/batches/${batchId}`, {
    method: 'DELETE',
    accessToken,
  });
}

export async function pickClientRequest(
  accessToken: string,
  payload: { requestId: string; idempotencyKey?: string; comment?: string },
) {
  return request<PickClientRequestResult>('/stock/fulfillment/pick-request', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchPendingPickWaveBalanceReviews(accessToken: string) {
  return request<PickWaveBalanceReview[]>('/client-requests/balance-reviews/pending', {
    accessToken,
  });
}

export async function fetchPickWaveBalanceReview(accessToken: string, waveId: string) {
  return request<PickWaveBalanceReview>(`/client-requests/balance-reviews/${waveId}`, {
    accessToken,
  });
}

export async function savePickWaveBalanceReview(
  accessToken: string,
  waveId: string,
  decisions: PickWaveBalanceDecisionInput[],
) {
  return request<PickWaveBalanceReview>(`/client-requests/balance-reviews/${waveId}`, {
    method: 'PATCH',
    body: { decisions },
    accessToken,
  });
}

export async function submitPickWaveBalanceReview(accessToken: string, waveId: string) {
  return request<PickWaveBalanceReview>(`/client-requests/balance-reviews/${waveId}/submit`, {
    method: 'POST',
    accessToken,
  });
}

export async function fetchPickWaves(accessToken: string, filter: { status?: PickWaveStatus } = {}) {
  return request<PickWaveSummary[]>(withQuery('/stock/fulfillment/waves', filter), {
    accessToken,
  });
}

export async function createPickWave(
  accessToken: string,
  payload: { requestIds: string[]; comment?: string; assignedPickerUserId?: string },
) {
  return request<PickWaveSummary>('/stock/fulfillment/waves', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function runPickWave(
  accessToken: string,
  waveId: string,
  payload: { idempotencyKey?: string; comment?: string } = {},
) {
  return request<PickWaveRunResult>(`/stock/fulfillment/waves/${waveId}/pick`, {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function fetchPickWaveDocument(accessToken: string, waveId: string) {
  return request<PickWaveDocument>(`/stock/fulfillment/waves/${waveId}/document`, {
    accessToken,
  });
}

export async function downloadPickWaveDocumentXlsx(accessToken: string, waveId: string) {
  return requestBlob(`/stock/fulfillment/waves/${waveId}/document.xlsx`, accessToken);
}

export async function fetchPickInstruction(accessToken: string, requestId: string) {
  return request<PickInstructionDocument>(`/client-requests/${requestId}/pick-instruction`, {
    accessToken,
  });
}

export async function cancelPickWave(accessToken: string, waveId: string) {
  return request<PickWaveSummary>(`/stock/fulfillment/waves/${waveId}/cancel`, {
    method: 'POST',
    accessToken,
  });
}

export async function refreshPickInstruction(accessToken: string, requestId: string) {
  return request<PickInstructionDocument>(`/client-requests/${requestId}/pick-instruction/refresh`, {
    method: 'POST',
    accessToken,
  });
}

export type FbsRequestRoute = {
  requestId: string;
  requestNumber: number;
  requestTitle: string;
  version: string;
  generatedAt: string;
  summary: { total: number; gathered: number; routed: number; unavailable: number };
  boxes: string[];
  pallets: Array<{ palletCode: string; boxes: string[] }>;
  items: Array<{
    taskId: string; orderId: string; productName: string; article: string | null;
    quantity: number; status: string; state: 'GATHERED' | 'ROUTED' | 'UNAVAILABLE';
    boxId: string | null; boxCode: string | null; palletId: string | null;
    palletCode: string | null; availableQuantity: number; scannedBarcode: boolean;
    scannedKiz: boolean; workerName: string | null; reason: string | null; updatedAt: string;
  }>;
};

export type FbsRequestRouteRepair = {
    requestId: string;
    requestNumber: number;
    repairedTasks: number;
    reservedTasks: number;
    waitingStockTasks: number;
    preservedStartedTasks: number;
    message: string;
    route: FbsRequestRoute;
    diff: { addedBoxes: string[]; removedBoxes: string[] };
};

export async function fetchFbsRequestRoute(accessToken: string, requestId: string) {
  return request<FbsRequestRoute>(`/marketplace-connections/fbs/requests/${requestId}/route`, { accessToken });
}

export async function repairFbsRequestSelection(accessToken: string, requestId: string) {
  return request<FbsRequestRouteRepair>(`/marketplace-connections/fbs/requests/${requestId}/repair-selection`, {
    method: 'POST',
    accessToken,
  });
}

export async function rebuildFbsRequestRoute(accessToken: string, requestId: string) {
  return request<FbsRequestRouteRepair>(`/marketplace-connections/fbs/requests/${requestId}/route/rebuild`, {
    method: 'POST', accessToken,
  });
}

export type FbsRequestSupplyConsistency = {
  requestId: string;
  requestNumber: number;
  requestTitle: string;
  requestStatus: ClientRequestStatus;
  checkedAt: string;
  consistent: boolean;
  wbOrders: number;
  wmsOrders: number;
  missingInWms: number;
  extraInWms: number;
  repairedOrders?: number;
  message: string;
  supplies: Array<{
    connectionId: string;
    accountName: string;
    supplyId: string;
    warehouseName: string | null;
    wbOrders: number;
    wmsOrders: number;
    missingInWms: number;
    extraInWms: number;
    missingOrderIds: string[];
    extraOrderIds: string[];
  }>;
  unassignedWmsOrderIds: string[];
};

export async function checkFbsRequestSupplyConsistency(accessToken: string, requestId: string) {
  return request<FbsRequestSupplyConsistency>(
    `/marketplace-connections/fbs/requests/${requestId}/supply-consistency`,
    { accessToken },
  );
}

export async function repairFbsRequestSupplyConsistency(accessToken: string, requestId: string) {
  return request<FbsRequestSupplyConsistency>(
    `/marketplace-connections/fbs/requests/${requestId}/supply-consistency/repair`,
    { method: 'POST', accessToken },
  );
}

export async function uploadManualPickInstruction(accessToken: string, requestId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return requestMultipart<PickInstructionDocument>(`/client-requests/${requestId}/pick-instruction/manual`, form, accessToken);
}

export async function downloadPickInstructionXlsx(accessToken: string, requestId: string) {
  return requestBlob(`/client-requests/${requestId}/pick-instruction.xlsx`, accessToken);
}

export async function downloadClientRequestItemsXlsx(accessToken: string, requestId: string) {
  return requestBlob(`/client-requests/${requestId}/items.xlsx`, accessToken);
}

export async function downloadClientRequestWbProductsXlsx(accessToken: string, requestId: string) {
  return requestBlob(`/client-requests/${requestId}/marketplace/wb-products.xlsx`, accessToken);
}

export async function downloadClientRequestWbPackagesXlsx(accessToken: string, requestId: string) {
  return requestBlob(`/client-requests/${requestId}/marketplace/wb-packages.xlsx`, accessToken);
}

export async function packageClientRequest(
  accessToken: string,
  payload: { requestId: string; idempotencyKey?: string; comment?: string; packages?: unknown[] },
) {
  return request<FulfillClientRequestResult>('/stock/fulfillment/package-request', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

export async function shipClientRequest(
  accessToken: string,
  payload: { requestId: string; idempotencyKey?: string; comment?: string; boxes?: number; pallets?: number; packedUnits?: number; packages?: unknown[] },
) {
  return request<FulfillClientRequestResult>('/stock/fulfillment/ship-request', {
    method: 'POST',
    body: payload,
    accessToken,
  });
}

function outboundRequestXlsxForm(payload: OutboundRequestXlsxPayload) {
  const form = new FormData();
  form.append('file', payload.file);
  form.append('clientId', payload.clientId);
  appendOptional(form, 'title', payload.title);
  appendOptional(form, 'priority', payload.priority);
  appendOptional(form, 'comment', payload.comment);
  appendOptional(form, 'contactName', payload.contactName);
  appendOptional(form, 'contactPhone', payload.contactPhone);
  appendOptional(form, 'destinationCity', payload.destinationCity);
  appendOptional(form, 'deliveryAddress', payload.deliveryAddress);
  appendOptional(form, 'desiredDate', payload.desiredDate);
  return form;
}

function appendOptional(form: FormData, key: string, value?: string) {
  if (value?.trim()) {
    form.append(key, value.trim());
  }
}

export type OzonFboConnection = {
  id: string;
  accountName: string | null;
  sellerId: string | null;
  isActive: boolean;
  configured: boolean;
};

export type OzonFboPlanSummary = {
  id: string;
  title: string;
  status: string;
  sourceFileName: string;
  draftId: string | null;
  ozonOrderId: string | null;
  ozonOrderNumber: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  dropOffWarehouseName: string | null;
  createdAt: string;
  updatedAt: string;
  totalUnits: number;
  assembledUnits: number;
  clusters: number;
  boxes: number;
  closedBoxes: number;
  errors: number;
};

export type OzonFboPlan = Omit<OzonFboPlanSummary, 'clusters' | 'boxes' | 'closedBoxes' | 'errors' | 'totalUnits' | 'assembledUnits'> & {
  clientId: string;
  connectionId: string;
  deliveryType: string;
  dropOffWarehouseId: string | null;
  dropOffWarehouseType: string | null;
  availableTimeslots: unknown;
  lastError: string | null;
  importSummary: Record<string, unknown> | null;
  creationSummary?: {
    supplyMode: 'ONE' | 'BY_CITY';
    requested: number;
    created: number;
    failed: Array<{ planId: string; message: string }>;
    processing?: boolean;
  };
  bookingSummary?: {
    requested: number;
    started?: number;
    created?: number;
    failed?: Array<{ planId: string; message: string }>;
    processing: boolean;
  };
  client: { id: string; code: string; name: string };
  connection: Omit<OzonFboConnection, 'configured'>;
  clusters: Array<{
    id: string;
    sourceName: string;
    clusterId: string | null;
    macrolocalClusterId: string | null;
    clusterName: string | null;
    storageWarehouseId: string | null;
    storageWarehouseName: string | null;
    supplyId: string | null;
    status: string;
    validationMessage: string | null;
    items: Array<{
      id: string;
      offerId: string;
      ozonSku: string | null;
      productName: string | null;
      quantity: number;
      assembledQuantity: number;
      isValid: boolean;
      validationMessage: string | null;
    }>;
  }>;
  boxes: Array<{
    id: string;
    boxCode: string;
    ozonCargoId: string | null;
    ozonBarcode: string | null;
    status: string;
    clusterId: string;
    cluster: { clusterName: string | null; sourceName: string };
    items: Array<{
      id: string;
      quantity: number;
      assembledQuantity: number;
      planItem: { offerId: string; productName: string | null; ozonSku: string | null };
    }>;
  }>;
  events: Array<{ id: string; type: string; message: string; payload: Record<string, unknown> | null; userName: string | null; createdAt: string }>;
};

export type OzonFboClusterOption = {
  id: string;
  name: string;
  macrolocalClusterId: string;
  warehouses: Array<{ id: string; name: string; type: string }>;
};

export async function fetchOzonFboOverview(accessToken: string, clientId: string) {
  return request<{ connections: OzonFboConnection[]; plans: OzonFboPlanSummary[] }>(
    withQuery('/ozon-fbo/overview', { clientId }), { accessToken },
  );
}

export async function fetchOzonFboPlan(accessToken: string, planId: string) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}`, { accessToken });
}

export async function syncOzonFboSkus(accessToken: string, connectionId: string) {
  return request<MarketplaceProductSyncResult & { plansRefreshed: number; planItemsRecognized: number }>(
    '/ozon-fbo/skus/sync',
    { method: 'POST', accessToken, body: { connectionId } },
  );
}

export async function deleteOzonFboPlan(accessToken: string, planId: string) {
  return request<{ id: string; title: string; sourceFileName: string; deleted: true }>(
    `/ozon-fbo/plans/${planId}`,
    { method: 'DELETE', accessToken },
  );
}

export async function fetchOzonFboClusters(accessToken: string, connectionId: string) {
  return request<OzonFboClusterOption[]>(withQuery('/ozon-fbo/clusters', { connectionId }), { accessToken });
}

export async function fetchOzonFboDropoffs(accessToken: string, connectionId: string, search: string) {
  return request<Array<{ warehouse_id: string | number; name: string; warehouse_type: string; address?: string }>>(
    withQuery('/ozon-fbo/dropoff-warehouses', { connectionId, search, supplyType: 'CROSSDOCK' }), { accessToken },
  );
}

export async function importOzonFboPlan(
  accessToken: string,
  payload: { clientId: string; connectionId: string; title: string; file: File },
) {
  const form = new FormData();
  form.append('clientId', payload.clientId);
  form.append('connectionId', payload.connectionId);
  form.append('title', payload.title);
  form.append('file', payload.file);
  return requestMultipart<OzonFboPlan>('/ozon-fbo/plans/import', form, accessToken);
}

export async function mapOzonFboCluster(
  accessToken: string,
  planId: string,
  rowId: string,
  cluster: OzonFboClusterOption,
) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}/clusters/${rowId}`, {
    method: 'PATCH', accessToken,
    body: { clusterId: cluster.id, macrolocalClusterId: cluster.macrolocalClusterId, clusterName: cluster.name },
  });
}

export async function setOzonFboDropoff(
  accessToken: string,
  planId: string,
  warehouse: { warehouse_id: string | number; name: string; warehouse_type: string },
) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}/dropoff`, {
    method: 'PATCH', accessToken,
    body: { warehouseId: String(warehouse.warehouse_id), name: warehouse.name, type: warehouse.warehouse_type, deliveryType: 'DROPOFF' },
  });
}

export async function createOzonFboDraft(
  accessToken: string,
  planId: string,
  preferences: { supplyMode: 'ONE' | 'BY_CITY'; packingMode: 'MONO' | 'MONO_WITH_SMALL_MIXED'; mixedThreshold: number },
) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}/draft`, { method: 'POST', accessToken, body: preferences });
}

export async function refreshOzonFboDraft(accessToken: string, planId: string) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}/draft/refresh`, { method: 'POST', accessToken });
}

export async function fetchOzonFboTimeslots(accessToken: string, planId: string, dateFrom: string, dateTo: string) {
  return request<unknown>(`/ozon-fbo/plans/${planId}/timeslots`, { method: 'POST', accessToken, body: { dateFrom, dateTo } });
}

export async function bookOzonFboSlot(accessToken: string, planId: string, from: string, to: string) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}/book-slot`, {
    method: 'POST', accessToken, body: { from, to, confirm: true },
  });
}

export async function refreshOzonFboSupply(accessToken: string, planId: string) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}/supply/refresh`, { method: 'POST', accessToken });
}

export async function generateOzonFboBoxes(
  accessToken: string,
  planId: string,
  maxUnitsPerBox: number,
  packingMode: 'MONO' | 'MONO_WITH_SMALL_MIXED',
  mixedThreshold = 20,
) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}/boxes/generate`, {
    method: 'POST', accessToken, body: { maxUnitsPerBox, packingMode, mixedThreshold },
  });
}

export async function scanOzonFboBox(accessToken: string, boxId: string, code: string) {
  return request<unknown>(`/ozon-fbo/boxes/${boxId}/scan`, { method: 'POST', accessToken, body: { code } });
}

export async function closeOzonFboBox(accessToken: string, boxId: string) {
  return request<OzonFboPlan>(`/ozon-fbo/boxes/${boxId}/close`, { method: 'POST', accessToken });
}

export async function reportOzonFboBoxShortage(accessToken: string, boxId: string, reason: string) {
  return request<OzonFboPlan>(`/ozon-fbo/boxes/${boxId}/shortage`, {
    method: 'POST', accessToken, body: { reason },
  });
}

export async function resolveOzonFboBoxShortage(
  accessToken: string,
  boxId: string,
  decision: 'APPROVE' | 'CORRECT',
  comment = '',
) {
  return request<OzonFboPlan>(`/ozon-fbo/boxes/${boxId}/shortage/resolve`, {
    method: 'POST', accessToken, body: { decision, comment },
  });
}

export async function uploadOzonFboCargoes(accessToken: string, planId: string) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}/cargoes/upload`, {
    method: 'POST', accessToken, body: { confirm: true },
  });
}

export async function refreshOzonFboCargoes(accessToken: string, planId: string) {
  return request<OzonFboPlan>(`/ozon-fbo/plans/${planId}/cargoes/refresh`, { method: 'POST', accessToken });
}

export async function downloadOzonFboAssembly(accessToken: string, planId: string) {
  return requestBlob(`/ozon-fbo/plans/${planId}/assembly.xlsx`, accessToken);
}

export async function downloadOzonFboBoxLabels(accessToken: string, planId: string) {
  return requestBlob(`/ozon-fbo/plans/${planId}/box-labels.pdf`, accessToken);
}

// ADDED: management types never contain the stored hash or a recoverable secret.
export type WmsApiScope = {
  code: 'catalog:read' | 'stock:read' | 'stock:write' | 'requests:read' | 'movements:read';
  name: string;
};

export type WmsApiCredentialSummary = {
  id: string;
  name: string;
  clientId: string;
  warehouseId: string;
  keyPrefix: string;
  scopes: string[];
  allowedIps: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdAt: string;
  client: { code: string; name: string };
  warehouse: { code: string; name: string; city: string };
  createdBy: { id: string; name: string; email: string } | null;
};

export type WmsApiAccessOptions = {
  clients: Array<{ id: string; code: string; name: string }>;
  warehouses: Array<{ clientId: string; id: string; code: string; name: string; city: string }>;
};

export type CreateWmsApiCredentialInput = {
  name: string;
  clientId: string;
  warehouseId: string;
  scopes: string[];
  allowedIps?: string[];
  expiresAt?: string;
};

export type IssuedWmsApiKey = {
  credential: { id: string; name: string; clientId: string; warehouseId: string; keyPrefix: string };
  apiKey: string;
  shownOnce: true;
};

export function fetchWmsApiScopes(accessToken: string) {
  return request<WmsApiScope[]>('/integration-access/scopes', { accessToken });
}

export function fetchWmsApiAccessOptions(accessToken: string) {
  return request<WmsApiAccessOptions>('/integration-access/options', { accessToken });
}

export function fetchWmsApiCredentials(accessToken: string) {
  return request<WmsApiCredentialSummary[]>('/integration-access/credentials', { accessToken });
}

export function createWmsApiCredential(accessToken: string, input: CreateWmsApiCredentialInput) {
  return request<IssuedWmsApiKey>('/integration-access/credentials', {
    method: 'POST',
    accessToken,
    body: input,
  });
}

export function rotateWmsApiCredential(accessToken: string, id: string) {
  return request<IssuedWmsApiKey>(`/integration-access/credentials/${id}/rotate`, {
    method: 'POST',
    accessToken,
  });
}

export function revokeWmsApiCredential(accessToken: string, id: string) {
  return request<{ id: string; name: string; keyPrefix: string; revokedAt: string }>(
    `/integration-access/credentials/${id}/revoke`,
    { method: 'POST', accessToken },
  );
}

export type FbsRepeatSelection = { clientId: string; orders: Array<{ id: string; connectionId: string; assemblyId?: string }> };
export type FbsRepeatPreview = {
  previewToken: string; orderCount: number; additionalUnits: number; warning: string;
  orders: Array<{ id: string; connectionId: string; assemblyId: string; productName: string;
    article: string | null; sourceRequestNumber: number; sourceSupplyId: string | null;
    boxCode: string; palletCode: string | null; sourceSkuId: string }>;
};
export function fetchFbsRepeatCapabilities(accessToken: string) {
  return request<{ enabled: boolean }>('/marketplace-connections/fbs/repeat-assembly/capabilities', { accessToken });
}
export function previewFbsRepeatAssembly(accessToken: string, selection: FbsRepeatSelection) {
  return request<FbsRepeatPreview>('/marketplace-connections/fbs/repeat-assembly/preview', { method: 'POST', accessToken, body: selection });
}
export function createFbsRepeatAssembly(accessToken: string, selection: FbsRepeatSelection & { previewToken: string; confirmAdditionalStockConsumption: true }) {
  return request<{ status: string; request: { id: string; number: number } }>('/marketplace-connections/fbs/repeat-assembly', { method: 'POST', accessToken, body: selection });
}

async function request<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; accessToken?: string } = {},
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return (await response.json()) as T;
}

function withQuery(path: string, params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== false) {
      search.set(key, String(value));
    }
  });

  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function turnoverQuery(filter: {
  clientId?: string;
  skuId?: string;
  barcode?: string;
  kiz?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  groupBy?: 'day' | 'month' | 'quarter' | 'year';
}) {
  return {
    clientId: filter.clientId,
    skuId: filter.skuId,
    barcode: filter.barcode,
    kiz: filter.kiz,
    search: filter.search,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    limit: filter.limit ? String(filter.limit) : undefined,
    groupBy: filter.groupBy,
  };
}

function turnoverReportQuery(filter: {
  clientId?: string;
  skuId?: string;
  barcode?: string;
  kiz?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}) {
  return {
    clientId: filter.clientId,
    skuId: filter.skuId,
    barcode: filter.barcode,
    kiz: filter.kiz,
    search: filter.search,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    limit: filter.limit ? String(filter.limit) : undefined,
  };
}

async function requestMultipart<T>(path: string, body: FormData, accessToken: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return (await response.json()) as T;
}

async function requestBlob(path: string, accessToken: string, init: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return response.blob();
}

async function responseError(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(payload.message)) {
      return payload.message.join('\n');
    }

    return payload.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
