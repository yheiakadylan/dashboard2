/**
 * Constants for Data Table Column Indices
 * Needed because some data is hidden in the row array for filtering purposes.
 */

// Indices for Order List Table Row
// Header order: Image=0, Product=1, Variants=2, OrderID=3, Revenue=4, Curren=5, Cost=6, FF Code=7, Rating=8, Case=9, Help=10, Account=11, Date=12, Source=13
// Hidden (not in headers array): RecordID=14, DT_LOCAL_RAW=15, SOURCE=16, IS_REFUNDED=17
export const ORDER_LIST_INDICES = {
    RECORD_ID: 14, // Hidden column for record ID (row click → open detail modal)
    DT_LOCAL_RAW: 15, // Hidden column for date filtering
    SOURCE: 16, // Hidden column for source filtering
    IS_REFUNDED: 17, // Hidden boolean: true if order is Refunded (for row highlight)
} as const;
