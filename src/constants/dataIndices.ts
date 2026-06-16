/**
 * Constants for Data Table Column Indices
 * Needed because some data is hidden in the row array for filtering purposes.
 */

// Indices for Order List Table Row
export const ORDER_LIST_INDICES = {
    DT_LOCAL_RAW: 14, // Hidden column for date filtering
    SOURCE: 15,       // Hidden column for source filtering
    IS_REFUNDED: 17,  // Hidden boolean: true if order is Refunded (for row highlight)
} as const;
