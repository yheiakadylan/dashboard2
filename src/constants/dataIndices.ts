/**
 * Constants for Data Table Column Indices.
 * Some metadata is appended after the visible order columns.
 */

// Visible: Image, Product, Variants, Order ID, Revenue, Currency, Cost,
// Provider, FF Code, Rating, Case, Help, Account, Date, Source (0-14).
export const ORDER_LIST_INDICES = {
    RECORD_ID: 15,
    DT_LOCAL_RAW: 16,
    SOURCE: 17,
    IS_REFUNDED: 18,
} as const;
