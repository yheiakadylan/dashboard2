export interface Account {
  id: string;
  email: string;
  label: string;
  provider: "gmail" | "outlook";
  token: string; // For Google: stringified credentials. For MSAL: homeAccountId.
  last_synced_at?: string; // ISO string of the last successful NORMAL sync time
  order?: number; // Field to store the user-defined sort order

  // Trường để quản lý việc quét lịch sử chạy ngầm
  history_synced_until?: string; // Mốc thời gian LÙI mà quá trình quét đã hoàn thành
  historical_sync_complete?: boolean; // Đánh dấu là true khi quá trình quét lịch sử đã hoàn tất
  scan_start_date?: string; // Ngày bắt đầu của lịch sử email, được tìm thấy bởi giai đoạn dò tìm
  lastKnownHistoryId?: string; // ID cuối cùng mà webhook đã xử lý
  platforms?: string[]; // 'etsy', 'ebay'
  evaluation_worker_status?: EvaluationWorkerStatus;
}

export interface EvaluationWorkerStatus {
  workerId?: string;
  status: "idle" | "processing" | "auth-required" | "error" | "offline";
  lastHeartbeat?: string;
  currentRunId?: string | null;
  currentStage?: string | null;
  lastRunId?: string;
  lastError?: string;
  extensionVersion?: string;
}

export type EvaluationScope =
  "listings" | "reviews" | "seller" | "full" | "custom";
export type EvaluationTool =
  | "collect_shop_overview"
  | "collect_public_listings"
  | "collect_listing_details"
  | "collect_public_reviews"
  | "collect_seller_stats"
  | "collect_seller_ads"
  | "collect_seller_orders"
  | "collect_seller_messages";

export interface EvaluationCrawlLimits {
  listingPages?: number;
  listings?: number;
  listingDetails?: number;
  reviewPages?: number;
  reviews?: number;
}

export type EvaluationToolNotes = Partial<{ [Tool in EvaluationTool]: string }>;

export interface EvaluationAgentPlan {
  summary: string;
  tools: EvaluationTool[];
  scope: EvaluationScope;
  provider: "anthropic" | "9router";
  model: string;
  createdAt: string;
  executionMode?: "browser-agent" | "deterministic";
}

export interface EvaluationRun {
  id: string;
  jobId?: string;
  accountId: string;
  shopLabel: string;
  publicUrl: string;
  workerId?: string;
  currency?: string;
  shipTo?: string;
  periodDays?: number;
  scope?: EvaluationScope;
  customPrompt?: string;
  agentPlan?: EvaluationAgentPlan;
  requestedTools?: EvaluationTool[];
  crawlLimits?: EvaluationCrawlLimits;
  toolNotes?: EvaluationToolNotes;
  autoAnalyze?: boolean;
  type: "public-shop-collection" | "full-shop-evaluation" | "agent-evaluation";
  status:
    "queued" | "running" | "collected" | "partial" | "failed" | "cancelled";
  stage?: string;
  coverage?: {
    pages?: number;
    shopPages?: number;
    listings?: number;
    listingDetails?: number;
    reviews?: number;
    reviewPages?: number;
    sellerStats?: number;
    ads?: number;
    orders?: number;
    messagePages?: number;
  };
  agentProgress?: {
    tool?: EvaluationTool;
    step?: number;
    maxSteps?: number;
    action?: string;
    model?: string;
    updatedAt?: string;
  };
  lastAgentDecision?: {
    tool?: EvaluationTool;
    step?: number;
    action?: string;
    reason?: string;
    url?: string | null;
    model?: string;
    updatedAt?: string;
  };
  aiLive?: {
    status: "connecting" | "running" | "completed" | "failed";
    text: string;
    model?: string;
    progress?: {
      current: number;
      total: number;
      stage: string;
      listingStart?: number;
      listingEnd?: number;
      listingTotal?: number;
    };
    updatedAt?: string;
    error?: string;
  };
  warnings?: string[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt?: any;
  analysis?: {
    status: "running" | "completed" | "failed";
    provider?: "anthropic" | "9router";
    model?: string;
    startedAt?: string;
    updatedAt?: string;
    progress?: {
      current: number;
      total: number;
      stage: string;
      listingStart?: number;
      listingEnd?: number;
      listingTotal?: number;
    };
    listingAuditCount?: number;
    result?: {
      summary?: string;
      strengths?: string[];
      weaknesses?: string[];
      findings?: any[];
      actions?: any[];
      report?: any;
    };
    error?: string;
  };
}

export interface EvaluationListingRow {
  listingId: string;
  title: string;
  url: string;
  price: string;
  imageUrl?: string | null;
  sourcePage?: number;
  firstSeenPage?: number;
  risk?: string;
  action?: string;
  analysis?: string;
  improvement?: string;
  evidenceMaterials?: string;
  policyFlags?: string;
  seo?: string;
}

export interface EvaluationRawDocument {
  id: string;
  [key: string]: any;
}

export interface EvaluationRawData {
  publicPages: EvaluationRawDocument[];
  listings: EvaluationListingRow[];
  listingDetails: EvaluationRawDocument[];
  reviews: EvaluationRawDocument[];
  sellerPages: EvaluationRawDocument[];
  logs: EvaluationLogEntry[];
}

export interface EvaluationLogEntry {
  id: string;
  timestamp?: string;
  level: "info" | "warn" | "error";
  source: string;
  stage: string;
  message: string;
  request?: {
    method?: string;
    url?: string;
    status?: number;
    durationMs?: number;
  };
  error?: { name?: string; message?: string; stack?: string };
  context?: { [key: string]: unknown };
  workerId?: string;
  version?: string;
}

export interface EvaluationJob {
  id: string;
  accountId: string;
  shopLabel: string;
  publicUrl: string;
  type: "collect-public-shop" | "full-shop-evaluation" | "agent-evaluation";
  periodDays?: number;
  scope?: EvaluationScope;
  customPrompt?: string;
  agentPlan?: EvaluationAgentPlan;
  requestedTools?: EvaluationTool[];
  crawlLimits?: EvaluationCrawlLimits;
  toolNotes?: EvaluationToolNotes;
  autoAnalyze?: boolean;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  runId?: string;
  workerId?: string;
  error?: string;
  createdAt?: any;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: any;
  cancelledBy?: string | null;
}

export interface FulfillmentAccount {
  id: string;
  provider: "printway" | "merchize";
  name: string;
  base_url: string;
  api_token: string;
}

export interface OrderItem {
  name: string;
  variant?: string; // Material & Size, etc.
  variant2?: string;
  personalization?: string;
  quantity: number;
  price: number;
  image?: string;
  transactionId?: string;
  sku?: string;
}

export interface OrderDetails {
  customerName: string;
  customerEmail: string;
  shippingAddress: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  items: OrderItem[];
  financials?: {
    itemTotal: number;
    discount: number;
    shipping: number;
    tax: number;
    orderTotal: number;
  };
  detectedCurrency?: string;
}

export interface RefundDetails {
  refundAmount?: number;
  refundCurrency?: string;
  deductedFromShop?: number;
  deductedCurrency?: string;
  refundedFee?: number;
  feeCurrency?: string;
  reason?: string;
  total_refund_amount?: number;
}

export interface Record {
  id?: string; // Unique ID for the record, usually from Firestore document ID
  email_id?: string; // The unique ID of the source email message
  dt_local: string;
  amount: number;
  order_id: string | null;
  currency: string | null;
  source: string;
  account: string;
  kind: "order" | "Funds" | "case" | "help";
  case_msg?: string | null;
  help_kind?: string | null;
  cost_total?: number;
  ff_code?: string;
  product_name?: string;
  details?: OrderDetails; // Added detailed info
  is_manual_cost?: boolean; // Flag to indicate if cost was manually entered
  status?: string;
  refund_details?: RefundDetails;
  provider?: string;
}

export interface CostData {
  order_id: string;
  cost_total: number;
  ff_code: string;
  currency: string;
  product_name?: string;
}

export type Tab =
  | "Overview"
  | "Order List"
  | "Products"
  | "Shop Evaluation"
  | "Support"
  | "Fulfill"
  | "KPI"
  | "Design"
  | "Templete";

export interface Template {
  id: string;
  title: string;
  providerName: string;
  url?: string;
  sku?: string;
  createdBy: string;
  createdByName: string;
  createdAt: any;
  updatedAt: any;
}

export type DesignStatus =
  "new" | "todo" | "in_review" | "need_fix" | "done" | "overdue";

export type DesignPriority = "low" | "normal" | "high";

export type DesignType = "make_mockup" | "fulfillment";

export interface DesignTask {
  id: string;
  title: string;
  description?: string;
  status: DesignStatus;
  priority?: DesignPriority;
  typeDesign?: DesignType;
  attachments: string[];
  imageUrls: string[];
  designUrls: string[];
  createdBy: string;
  createdByName: string;
  createdByTeam?: string;
  createdByTeams?: string[];
  createdAt: any;
  updatedAt: any;
  assignedTo?: string;
  assignedToName?: string;
  overdueAt?: any;
  templateId?: string;
  designNumber?: number;
  design_code?: string;
}

export interface DesignComment {
  id: string;
  content: string;
  attachmentUrl?: string;
  createdBy: string;
  createdByName: string;
  createdAt: any;
}
export interface KpiValue {
  value: string;
  change?: number; // e.g., 5.2 for 5.2%
  direction?: "up" | "down" | "neutral";
  refundInfo?: string;
}

export interface KpiData {
  [key: string]: KpiValue | { [currency: string]: KpiValue };
}

// FIX: Allowed null in TableData rows to support records with missing cost data.
export interface TableData {
  headers: string[];
  rows: (
    | string
    | number
    | boolean
    | null
    | { type: "button"; label: string; id: string }
    | { type: "image"; src: string | null; fullSrc: string | null; alt: string }
    | { type: "value_with_unit"; value: number; display: string }
    | { type: "action_group"; actions: any[] }
    | {
        type: "editable_cost";
        value: number | null;
        recordId: string;
        isManual: boolean;
      }
    | { type: "editable_ffcode"; value: string | null; recordId: string }
    | { type: "editable_provider"; value: string | null; recordId: string }
    | {
        type: "text_with_subtitle";
        main: string;
        subtitle: string;
        subtitleClass?: string;
      }
  )[][];
}

export interface OverviewChartData {
  date: string; // Can be 'YYYY-MM-DD' or 'HH:00'
  orderCount: number;
  [revenueKey: string]: number | string; // e.g., revenueAUD: 100
}

export interface SummaryChartData {
  shop: string;
  [revenueKey: string]: number | string; // e.g., revenueAUD: 100
}

export interface FulfillChartData {
  name: string;
  count: number;
}

export interface TopProduct {
  name: string;
  quantity: number;
  revenue: number;
  image?: string; // Added image field
}

export interface ProcessedData {
  overview: {
    table: TableData;
    chartData: OverviewChartData[];
  };
  orders: TableData;
  ebay: TableData;
  etsy: TableData;
  cases: TableData;
  help: TableData;
  fulfill: {
    table: TableData;
    merchizeChartData: FulfillChartData[];
    printwayChartData: FulfillChartData[];
    allProductChartData?: FulfillChartData[];
    totalCost?: number;
  };
  summary: {
    kpis: KpiData;
    table: TableData;
    chartData: SummaryChartData[];
    topProductsByShop: { [shopName: string]: TopProduct[] };
  };
  products: TableData; // New field for detailed products table
}

export interface ManualCost {
  id: string;
  providerName: string;
  cost: number;
  date: string;
  timeZone?: string;
  currency?: string;
  createdAt?: any; // Firestore Timestamp
}

export interface KpiIdea {
  type: string;
  count: number;
}

export interface KpiReport {
  id?: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  sellerName: string;
  ideas: KpiIdea[];
  mockup: number;
  listing: number;
  fulfill: number;
  revenue: number;
  baseCost: number;
  grossProfit: number;
  profitMargin: number;
  refund?: number;
  note?: string;
}
