/**
 * Constants for Data Table Column Indices
 * Needed because some data is hidden in the row array for filtering purposes.
 */

// Indices for Order List Table Row
// Header order: Image=0, Product=1, Variants=2, OrderID=3, Revenue=4, Curren=5, Cost=6, FF Code=7, Case=8, Help=9, Account=10, Date=11, Source=12
// Hidden (not in headers array): RecordID=13, DT_LOCAL_RAW=14, SOURCE=15, IS_REFUNDED=16
export const ORDER_LIST_INDICES = {
    RECORD_ID: 13, // Hidden column for record ID (row click → open detail modal)
    DT_LOCAL_RAW: 14, // Hidden column for date filtering
    SOURCE: 15, // Hidden column for source filtering
    IS_REFUNDED: 16, // Hidden boolean: true if order is Refunded (for row highlight)
} as const;
