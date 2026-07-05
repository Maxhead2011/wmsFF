export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roleCodes: string[];
  permissionCodes: string[];
  clientScopeMode: 'ALL' | 'LIMITED';
  clientIds: string[];
  writableClientIds: string[];
  printerGroups?: UserPrinterScope[];
};

export type AuthSession = {
  accessToken: string;
  tokenType: 'Bearer';
  user: AuthUser;
};

export type ClientSummary = {
  id: string;
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

export type ClientLogisticsInvoiceMode = 'SEPARATE' | 'SAME_INVOICE' | 'DISABLED';

export type ClientStorageBillingMode = 'MONTHLY' | 'ON_SHIPMENT';

export type MarketplaceType = 'WILDBERRIES' | 'OZON' | 'YANDEX_MARKET' | 'SBER_MARKET' | 'OTHER';

export type ClientRequestType = 'INBOUND' | 'OUTBOUND' | 'RETURN' | 'DELIVERY' | 'SERVICE' | 'OTHER';

export type ClientRequestStatus =
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'IN_WORK'
  | 'PACKED'
  | 'DONE'
  | 'CANCELLED'
  | 'REJECTED';

export type PickWaveStatus = 'PLANNED' | 'PICKING' | 'DONE' | 'FAILED' | 'CANCELLED';

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
  debtRub: number;
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
    debtRub: number;
    overdueRub: number;
  };
  clients: BillingReconciliationClient[];
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
  charge: Pick<BillingChargeSummary, 'id' | 'serviceId' | 'description' | 'status'> | null;
};

export type BillingPaymentSummary = {
  id: string;
  invoiceId: string;
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
};

export type UpsertClientBillingServicePayload = {
  serviceId: string;
  priceRub: number;
  taxMode?: BillingPriceTaxMode;
  isActive?: boolean;
  comment?: string;
};

export type UpsertOwnCompanyPayload = {
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
    bankName: string;
    bankBik: string;
    bankAccount: string;
    correspondentAccount?: string;
    isDefault?: boolean;
    comment?: string;
  }>;
};

export type CreateManualBillingInvoiceLinePayload = {
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
  } | null;
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
};

export type OwnCompanyBankAccountSummary = {
  id: string;
  companyId: string;
  bankName: string;
  bankBik: string;
  bankAccount: string;
  correspondentAccount: string | null;
  isDefault: boolean;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OwnCompanySummary = {
  id: string;
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
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
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
  html: string;
};

export type CreateClientRequestPayload = {
  clientId: string;
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

export type PreviewClientRequestAvailabilityPayload = Pick<CreateClientRequestPayload, 'clientId' | 'type' | 'items'> & {
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
  fulfillmentManagerUserId?: string;
};

export type ClientTelegramSettings = {
  clientId: string;
  enabled: boolean;
  chatId: string;
};

export type UpdateClientPayload = Partial<CreateClientPayload>;

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
  barcodesTouched: number;
  skipped: number;
  errors: Array<{
    offerId: string;
    message: string;
  }>;
};

export type UpsertMarketplaceConnectionPayload = {
  clientId: string;
  marketplace: MarketplaceType;
  accountName?: string;
  sellerId?: string;
  apiKey: string;
  isActive?: boolean;
  comment?: string;
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
  } | null;
  pallet: {
    id: string;
    code: string;
    status: string;
  } | null;
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
  userId: string | null;
  name: string;
  email: string;
  client: string;
  ip: string;
  userAgent: string;
  openedAt: string;
  minutesAgo: number;
};

export type ServiceTelegramSettings = {
  global: {
    enabled: boolean;
    botToken: string;
    fulfillmentChatIds: string[];
  };
  client: {
    clientId: string;
    enabled: boolean;
    chatId: string;
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

export type TurnoverActionKind = 'ADD' | 'WRITE_OFF' | 'TRANSFER' | 'UTILIZE' | 'HOLD';

export type TurnoverSkuReport = {
  skuId: string;
  client: Pick<ClientSummary, 'id' | 'code' | 'name'>;
  internalSku: string;
  clientSku: string | null;
  article: string | null;
  name: string;
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
    label: string;
    name: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    barcode: string | null;
    quantity: number;
    boxCode: string | null;
    status: string | null;
  }>;
  barcodes: Array<{
    value: string;
    label: string;
    skuId: string;
    name: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
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
  _count: {
    balances: number;
    movements: number;
  };
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
};

export type UpdateUserClientScopesPayload = {
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

export type ResolveTsdReviewPayload = {
  action: 'APPLY_INVENTORY_ADJUSTMENT' | 'REJECT';
  comment?: string;
  reason?: TsdReviewReason;
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
  filter: { clientId?: string; status?: ClientRequestStatus; type?: ClientRequestType } = {},
) {
  return request<ClientRequestSummary[]>(withQuery('/client-requests', filter), {
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

export async function fetchBillingInvoiceDocument(accessToken: string, invoiceId: string) {
  return request<BillingInvoiceDocument>(`/billing/invoices/${invoiceId}/document`, {
    accessToken,
  });
}

export async function downloadBillingInvoicePdf(accessToken: string, invoiceId: string) {
  return requestBlob(`/billing/invoices/${invoiceId}/document.pdf`, accessToken);
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
    packages?: unknown[];
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

export async function fetchSkus(accessToken: string, filter: { clientId?: string; search?: string } = {}) {
  return request<SkuSummary[]>(withQuery('/skus', filter), {
    accessToken,
  });
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

export async function fetchTurnoverReport(
  accessToken: string,
  filter: { clientId?: string; skuId?: string; barcode?: string; kiz?: string; search?: string; dateFrom?: string; dateTo?: string; limit?: number } = {},
) {
  return request<TurnoverReport>(withQuery('/turnover', turnoverReportQuery(filter)), {
    accessToken,
  });
}

export async function fetchTurnoverSuggestions(
  accessToken: string,
  filter: { clientId?: string; search?: string } = {},
) {
  return request<TurnoverSuggestions>(withQuery('/turnover/suggestions', {
    clientId: filter.clientId,
    search: filter.search,
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

export async function updateServiceTelegramGlobal(
  accessToken: string,
  payload: { enabled: boolean; botToken: string; fulfillmentChatIds: string[] },
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
  payload: { enabled: boolean; chatId: string },
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

export async function fetchBoxes(accessToken: string, filter: { clientId?: string; code?: string } = {}) {
  return request<WarehouseBoxSummary[]>(withQuery('/warehouse/boxes', filter), {
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
  payload: { file: File; clientId: string; sourceDocument?: string },
) {
  const form = new FormData();
  form.append('file', payload.file);
  form.append('clientId', payload.clientId);
  if (payload.sourceDocument) {
    form.append('sourceDocument', payload.sourceDocument);
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

export async function downloadPickInstructionXlsx(accessToken: string, requestId: string) {
  return requestBlob(`/client-requests/${requestId}/pick-instruction.xlsx`, accessToken);
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

function withQuery(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      search.set(key, value);
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

async function requestBlob(path: string, accessToken: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
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
