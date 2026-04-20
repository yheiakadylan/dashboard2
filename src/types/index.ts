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

  // Listing Tracker fields
  listing_tracking_enabled?: boolean; // Enable/disable crawling for this shop
  total_listings?: number; // Current total active listings
  last_listing_crawl?: Date; // Last crawl timestamp
  last_crawl_stats?: {
    added: number;
    removed: number;
    total: number;
    timestamp: string;
  };
  last_crawl_error?: string; // ✅ Error message if last crawl failed
  last_crawl_error_at?: Date; // ✅ Timestamp of last error
  worker_status?: {
    status: 'idle' | 'processing' | 'error';
    last_heartbeat: string;
    last_error?: string;
    pending_count?: number;
    version?: string;
  };
}


export interface OrderItem {
  name: string;
  variant?: string; // Material & Size, etc.
  personalization?: string;
  quantity: number;
  price: number;
  image?: string;
  transactionId?: string;
  sku?: string;
  listing_id?: string;
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
  cost_total?: number;
  ff_code?: string;
  fulfill_provider?: string; // e.g. "IP", "Printway"
  fulfill_date?: string; // Date of fulfillment from provider
  product_name?: string;
  details?: OrderDetails;
  status?: 'New' | 'Refunded';
  refund_details?: RefundDetails;
  listing_id?: string; // Mapped from listing tracker based on image
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

export interface CostData {
  order_id: string;
  cost_total: number;
  ff_code: string;
  currency: string;
  product_name?: string;
}

export type Tab = 'Overview' | 'Order List' | 'Products' | 'Support' | 'Fulfill' | 'Listing';
export interface KpiValue {
  value: string;
  change?: number; // e.g., 5.2 for 5.2%
  direction?: 'up' | 'down' | 'neutral';
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
}

export interface KpiData {
  [key: string]: KpiValue | { [currency: string]: KpiValue };
}

// FIX: Allowed null in TableData rows to support records with missing cost data.
export interface TableData {
  headers: string[];
  rows: (string | number | null | { type: 'button', label: string, id: string } | { type: 'image', src: string | null, fullSrc: string | null, alt: string } | { type: 'value_with_unit', value: number, display: string, amountMap?: { [c: string]: number } } | { type: 'action_group', actions: any[] } | { type: 'text_with_subtitle', main: string, subtitle: string, subtitleClass?: string, mainAmountMap?: { [c: string]: number }, subtitleAmountMap?: { [c: string]: number } })[][];
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
  revenueUSD?: number; // Normalized revenue for ranking
  currency?: string;
  image?: string; // Added image field
  code?: string; // Added code field for categories
  classification?: string; // Original variant string
  size?: string; // Extracted size
  listing_id?: string;
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
    topProductsByCategory: { [categoryName: string]: TopProduct[] };
    topProductsBySize: { [size: string]: TopProduct[] };
    categoryComparison: any[];
    unmappedKeywords: { keyword: string; count: number }[];
  };
  products: TableData;
  variants: TableData; // New field for detailed variants table
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

export interface DailyStats {
  date: string;
  new_listings: number;
  removed_listings: number;
  total_listings?: number;
  shops?: {
    [key: string]: {
      new: number;
      removed: number;
      total: number;
    }
  };
  shops_crawled?: number;
  crawl_errors?: number;
  createdAt?: string;
  source?: string;
}
