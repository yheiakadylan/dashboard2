type RevenueItem = {
    quantity?: number | null;
    price?: number | null;
};

type RevenueFinancials = {
    discount?: number | null;
    shipping?: number | null;
};

export const getItemQuantity = (item: RevenueItem) => Number(item.quantity || 0);

export const getItemPrice = (item: RevenueItem) => Number(item.price || 0);

export const getOrderItemRevenueContext = (
    items: RevenueItem[],
    financials?: RevenueFinancials | null,
) => {
    const totalListValue = items.reduce((sum, item) => sum + (getItemPrice(item) * getItemQuantity(item)), 0);
    const totalQuantity = items.reduce((sum, item) => sum + getItemQuantity(item), 0);

    return {
        totalListValue,
        totalQuantity,
        totalDiscount: Number(financials?.discount || 0),
        totalShipping: Number(financials?.shipping || 0),
        itemCount: items.length,
    };
};

export const calculateItemNetRevenue = (
    item: RevenueItem,
    context: ReturnType<typeof getOrderItemRevenueContext>,
) => {
    const quantity = getItemQuantity(item);
    const gross = getItemPrice(item) * quantity;
    const weight = context.totalListValue > 0
        ? gross / context.totalListValue
        : (context.itemCount > 0 ? 1 / context.itemCount : 0);
    const proportionalDiscount = context.totalDiscount * weight;
    const proportionalShipping = context.totalQuantity > 0
        ? (context.totalShipping / context.totalQuantity) * quantity
        : 0;

    return gross - proportionalDiscount + proportionalShipping;
};
