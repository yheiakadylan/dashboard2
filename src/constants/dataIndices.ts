/**
 * Constants for Data Table Column Indices
 * Needed because some data is hidden in the row array for filtering purposes.
 */

// Indices for Order List Table Row
export const ORDER_LIST_INDICES = {
    STATUS: 4,        // Status column (Image=0, Product=1, Variants=2, OrderID=3, Status=4)
    DT_LOCAL_RAW: 14, // Hidden column for date filtering
    SOURCE: 15,       // Hidden column for source filtering
} as const;
