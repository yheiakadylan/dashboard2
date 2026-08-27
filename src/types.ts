export interface Account {
  id: string;
  email: string;
  label: string;
  provider: 'gmail' | 'outlook';
  token: string; // For Google: stringified credentials. For MSAL: homeAccountId.
  last_synced_at?: string; // ISO string of the last successful NORMAL sync time
  order?: number; // Field to store the user-defined sort order

  // Trường để quản lý việc quét lịch sử chạy ngầm
  history_synced_until?: string; // Mốc thời gian LÙI mà quá trình quét đã hoàn thành
  historical_sync_complete?: boolean; // Đánh dấu là true khi quá trình quét lịch sử đã hoàn tất
  scan_start_date?: string; // Ngày bắt đầu của lịch sử email, được tìm thấy bởi giai đoạn dò tìm
  lastKnownHistoryId?: string; // ID cuối cùng mà webhook đã xử lý
  platforms?: string[]; // 'etsy', 'ebay'
  etsy_shop_id?: string | number | null;
  etsyShopId?: string | number | null;
  shopId?: string | number | null;
  shopName?: string | null;
  etsyShopName?: string | null;
  name?: string | null;
  etsy_review_average?: number | null;
  etsy_review_count?: number | null;
  etsy_suspended?: boolean;
  etsy_suspended_reason?: string | null;
  etsy_newly_suspended?: boolean;
  etsy_suspended_since?: string | number | Date | { seconds?: number; toDate?: () => Date } | null;
  etsy_suspension_status_changed_at?: string | number | Date | { seconds?: number; toDate?: () => Date } | null;
  etsy_health_status?: string | null;
  etsy_health_error?: string | null;
  etsy_health_checked_at?: string | number | Date | { seconds?: number; toDate?: () => Date } | null;
  evaluation_worker_status?: EvaluationWorkerStatus;
  worker_status?: {
    status: 'idle' | 'processing' | 'error';
    last_heartbeat: string;
    last_error?: string;
    pending_count?: number;
    version?: string;
    review_status?: any;
  };
}

export interface EvaluationWorkerStatus {
  workerId?: string;
  status: 'idle' | 'processing' | 'auth-required' | 'error' | 'offline';
  lastHeartbeat?: string;
  currentRunId?: string | null;
  currentStage?: string | null;
  lastRunId?: string;
  lastError?: string;
  extensionVersion?: string;
}

export type EvaluationScope =
  'listings' | 'reviews' | 'seller' | 'full' | 'custom';
export type EvaluationTool =
  | 'collect_shop_overview'
  | 'collect_public_listings'
  | 'collect_listing_details'
  | 'collect_public_reviews'
  | 'collect_seller_stats'
  | 'collect_seller_ads'
  | 'collect_seller_orders'
  | 'collect_seller_messages';

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
  provider: 'anthropic' | '9router';
  model: string;
  createdAt: string;
  executionMode?: 'browser-agent' | 'deterministic';
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
  type: 'public-shop-collection' | 'full-shop-evaluation' | 'agent-evaluation';
  status:
    'queued' | 'running' | 'collected' | 'partial' | 'failed' | 'cancelled';
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
    status: 'connecting' | 'running' | 'completed' | 'failed';
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
    status: 'running' | 'completed' | 'failed';
    provider?: 'anthropic' | '9router';
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
  level: 'info' | 'warn' | 'error';
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
  type: 'collect-public-shop' | 'full-shop-evaluation' | 'agent-evaluation';
  periodDays?: number;
  scope?: EvaluationScope;
  customPrompt?: string;
  agentPlan?: EvaluationAgentPlan;
  requestedTools?: EvaluationTool[];
  crawlLimits?: EvaluationCrawlLimits;
  toolNotes?: EvaluationToolNotes;
  autoAnalyze?: boolean;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
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
  provider: 'printway' | 'merchize';
  name: string;
  base_url: string;
  api_token: string;
}

export interface OrderItem {
  name: string;
  variant?: string; 
  variant2?: string;
  personalization?: string;
  quantity: number;
  price: number;
  image?: string;
  transactionId?: string;
  sku?: string;
  listingId?: string;
  category_code?: string;
  customerFiles?: string[];
}

export interface OrderDetails {
  customerFiles?: string[];
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
    phone?: string;
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

export interface Record {
  id?: string; // Unique ID for the record, usually from Firestore document ID
  email_id?: string; // The unique ID of the source email message
  dt_local: string;
  amount: number;
  order_id: string | null;
  currency: string | null;
  source: string;
  account: string;
  kind: 'order' | 'Funds' | 'case' | 'help';
  case_msg?: string | null;
  help_kind?: string | null;
  cost_total?: number | null;
  is_manual_cost?: boolean;
  ff_code?: string;
  fulfill_provider?: string; // e.g. "IP", "Printway"
  fulfill_date?: string; // Date of fulfillment from provider
  product_name?: string;
  details?: OrderDetails;
  status?: 'New' | 'Refunded';
  refund_details?: RefundDetails;
  category_code?: string; // Overall category code for the record (if applicable)
}

export interface Category {
  id: string; // Firestore document ID
  code: string; // Unique identifier (e.g., MUG-11OZ)
  name: string; // Display name
  createdAt?: string;
  updatedAt?: string;
}

export interface RefundDetails {
  refundAmount: number;
  refundCurrency: string;
  deductedFromShop: number;
  deductedCurrency: string;
  refundedFee: number;
  feeCurrency: string;
  reason: string;
}

export interface EtsyReviewImage {
  url_75x75?: string | null;
  url_300x300?: string | null;
  url_fullxfull?: string | null;
}

export interface EtsyReview {
  id?: string;
  transaction_id: string;
  order_id: string;
  shop_id: string;
  shop_label?: string | null;
  rating: number | null;
  review: string;
  create_date: string;
  buyer_name: string | null;
  buyer_login_name: string | null;
  listing_id: string;
  listing_title: string;
  review_photo_detailed: EtsyReviewImage | null;
  listing_image: EtsyReviewImage | null;
  updated_at?: string;
}

export interface EtsyListing {
  id?: string;
  listing_id: string;
  title: string;
  tags: string[];
  images: string[];
  sku: string;
  product_type?: string | null;
  employee_id?: string | null;
  create_date: string;
  update_date: string;
  shop_id: string;
  shop_label: string;
  state?: number | null;
  url?: string | null;
  first_sale_date?: string | null;
  first_sale_order_id?: string | null;
  last_sale_date?: string | null;
}

export interface CostData {
  order_id: string;
  cost_total: number;
  ff_code: string;
  currency: string;
  product_name?: string;
}

export type Tab =
  | 'Overview'
  | 'Order List'
  | 'Products'
  | 'Support'
  | 'Fulfill'
  | 'Reviews'
  | 'Shop Evaluation'
  | 'KPI'
  | 'Design'
  | 'Templete'
  | 'Workload';

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
  'new' | 'todo' | 'in_review' | 'need_fix' | 'done' | 'overdue';

export type DesignPriority = 'low' | 'normal' | 'high';

export type DesignType = 'make_mockup' | 'fulfillment';

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
  direction?: 'up' | 'down' | 'neutral';
  previousValue?: string;
  previousLabel?: string;
  refundInfo?: string;
  conversionDetails?: {
    originalAmounts: { [currency: string]: number };
    rates: { [currency: string]: number };
  };
  // Fields for inline currency conversion display
  conversionRate?: number; // Exchange rate to USD
  usdValue?: number; // Converted value in USD
  refundOriginal?: number; // Refund amount in original currency
  refundUSD?: number; // Refund amount in USD
  shopBreakdown?: Array<{ shopName: string; count: number }>;
  detailLines?: Array<{ label: string; value: string; tone?: 'default' | 'good' | 'bad' | 'muted' }>;
}

export interface KpiData {
  [key: string]: KpiValue | { [currency: string]: KpiValue };
}

// FIX: Allowed null in TableData rows to support records with missing cost data.
export interface TextWithSubtitleCell {
  type: 'text_with_subtitle';
  main: string;
  subtitle: string;
  subtitleClass?: string;
  mainClass?: string;
  trendDirection?: 'up' | 'down' | 'neutral';
  mainAmountMap?: { [c: string]: number };
  subtitleAmountMap?: { [c: string]: number };
  subtitleLabel?: string;
  subtitleValue?: string;
  subtitleDelta?: string;
  subtitleDeltaDirection?: 'up' | 'down' | 'neutral';
  extraSubtitle?: string;
  extraSubtitleClass?: string;
  extraSubtitleAmountMap?: { [c: string]: number };
  extraSubtitleLabel?: string;
  extraSubtitleDelta?: string;
  value?: number;
}

export interface TableData {
  headers: string[];
  rows: (string | number | null | any | { type: 'button', label: string, id: string } | { type: 'image', src: string | null, fullSrc?: string | null, alt: string } | { type: 'value_with_unit', value: number, display: string, amountMap?: { [c: string]: number } } | { type: 'action_group', actions: any[] } | TextWithSubtitleCell)[][];
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
  sku?: string;
  name: string;
  quantity: number;
  revenue: number;
  revenueUSD?: number;
  currency?: string;
  image?: string;
  category?: string;
  classification?: string;
  size?: string;
  shop?: string;
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
    allProductChartData: FulfillChartData[];
    refundedChartData: FulfillChartData[];
    totalCost: number; // Sum of all costs in displayed records
    refundRate: number; // (Refunded Orders / Total Orders) * 100
  };
  summary: {
    kpis: KpiData;
    table: TableData;
    chartData: SummaryChartData[];
    topProductsByShop: { [shopName: string]: TopProduct[] };
    topProductsByCategory: { [category: string]: TopProduct[] };
    topProductsBySize: { [size: string]: TopProduct[] };
    categoryComparison: TopProduct[];
  };
  products: TableData;
  variants: TableData;
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
  date: string;
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

export interface UserProfile {
  uid?: string; // Added for convenience when fetching from Firestore
  teamId: string;
  role: 'owner' | 'user';
  permissions: { [key: string]: boolean };
  allowedAccounts?: string[];
  email?: string;
  displayName?: string; // Optional display name
  photoURL?: string;
  [key: string]: any;
}

export interface PODTeam {
  uid: string; // Unique identifier for the POD team (e.g. 'pod-team-1')
  displayName: string; // Name of the team (e.g. 'POD Team Alpha')
  allowedAccounts: string[]; // List of account emails assigned to this team
  memberIds: string[]; // Authentication UIDs assigned to this POD team
  photoURL?: string; // Team avatar/icon URL
  description?: string; // Description or notes
  createdAt?: string;
  updatedAt?: string;
}
