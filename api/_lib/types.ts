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
  product_name?: string;
  details?: OrderDetails; // Added detailed info
}

export interface CostData {
  order_id: string;
  cost_total: number;
  ff_code: string;
  currency: string;
  product_name?: string;
}

export type Tab = 'Overview' | 'Order List' | 'eBay' | 'Etsy' | 'Case' | 'Help' | 'Fulfill' | 'Products';
export interface KpiValue {
  value: string;
  change?: number; // e.g., 5.2 for 5.2%
  direction?: 'up' | 'down' | 'neutral';
}

export interface KpiData {
  [key: string]: KpiValue | { [currency: string]: KpiValue };
}

// FIX: Allowed null in TableData rows to support records with missing cost data.
export interface TableData {
  headers: string[];
  rows: (string | number | null | { type: 'button', label: string, id: string } | { type: 'image', src: string | null, fullSrc: string | null, alt: string } | { type: 'value_with_unit', value: number, display: string } | { type: 'action_group', actions: any[] })[][];
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