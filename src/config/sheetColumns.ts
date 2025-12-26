// File: src/config/sheetColumns.ts
/**
 * Google Sheets Column Configuration
 * Professional English column names for clean, modern sheets
 */

export const GOOGLE_SHEET_COLUMNS = [
    'No.',
    'Shop',
    'Product',
    'Product URL',
    'Mockup',
    'Date & Time',
    'Order ID',
    'Tracking',
    'Customer Info',
    'Revenue',
    'Base Cost',
    'Extra Cost',
    'AI Design',
    'Variant',
    'Requirements',
    'Order Status',
    'Fulfillment',
    'PTS Link',
    'Notes',
    'FF Status'
] as const;

// Type for column names
export type SheetColumn = typeof GOOGLE_SHEET_COLUMNS[number];

// Column indices for programmatic access
export const COL = {
    NO: 0,
    SHOP: 1,
    PRODUCT: 2,
    PRODUCT_URL: 3,
    MOCKUP: 4,
    DATE: 5,
    ORDER_ID: 6,
    TRACKING: 7,
    CUSTOMER: 8,
    REVENUE: 9,
    BASE_COST: 10,
    EXTRA_COST: 11,
    AI_DESIGN: 12,
    VARIANT: 13,
    REQUIREMENTS: 14,
    ORDER_STATUS: 15,
    FULFILLMENT: 16,
    PTS_LINK: 17,
    NOTES: 18,
    FF_STATUS: 19
} as const;
