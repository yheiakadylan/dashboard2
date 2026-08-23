export interface OrderTaskItemInput {
  name?: unknown;
  sku?: unknown;
  variant?: unknown;
  variant1?: unknown;
  variant2?: unknown;
  personalization?: unknown;
  quantity?: unknown;
  transactionId?: unknown;
  image?: unknown;
  customerFiles?: unknown;
  listingId?: unknown;
  category_code?: unknown;
}

interface BuildOrderTaskPayloadInput {
  taskId: string;
  orderId: string;
  source?: string;
  productName?: unknown;
  item: OrderTaskItemInput;
  accountId: string;
  shopLabel: string;
  createdAt: string;
  updatedAt?: string;
  shippingAddress?: globalThis.Record<string, unknown> | null;
}

const text = (value: unknown) => String(value ?? '').trim();

export const getOrderTaskDocumentId = (orderId: unknown, itemIndex = 0, itemCount = 1): string => {
  const normalizedOrderId = text(orderId);
  if (!normalizedOrderId) throw new Error('Order ID is required');
  return itemCount > 1 ? `${normalizedOrderId}-${itemIndex + 1}` : normalizedOrderId;
};

export const normalizeOrderTaskSku = (value: unknown): string => text(value).toUpperCase();

export const parseOrderTaskSku = (value: unknown) => {
  const sku = normalizeOrderTaskSku(value);
  const parts = sku.split('-');
  const isValid = sku !== 'NULL' && parts.length >= 3 && parts[0] !== '' && parts[1] !== '' && parts.slice(2).join('-') !== '';
  return {
    sku,
    productType: isValid ? parts[0] : '',
    ideaEmpId: isValid ? parts[1] : '',
    originalSku: isValid ? parts.slice(2).join('-') : '',
  };
};

export const normalizeOrderShippingAddress = (
  details: { shippingAddress?: globalThis.Record<string, unknown>; customerEmail?: unknown } | null | undefined,
): globalThis.Record<string, unknown> | null => {
  if (!details?.shippingAddress) return null;
  const city = text(details.shippingAddress.city);
  const normalizedCity = city && city === city.toUpperCase() && /[A-Z]/.test(city)
    ? city.toLowerCase().replace(/\b[a-z]/g, character => character.toUpperCase())
    : city;
  return {
    ...details.shippingAddress,
    city: normalizedCity,
    ...(details.customerEmail ? { email: text(details.customerEmail) } : {}),
  };
};

export const buildOrderTaskPayload = ({
  taskId,
  orderId,
  source,
  productName,
  item,
  accountId,
  shopLabel,
  createdAt,
  updatedAt = new Date().toISOString(),
  shippingAddress = null,
}: BuildOrderTaskPayloadInput) => {
  const parsedSku = parseOrderTaskSku(item.sku);
  const personalization = text(item.personalization);
  const quantity = Number(item.quantity);
  const platformName = source === 'Ebay_Sales' ? 'eBay' : 'Etsy';

  return {
    id: taskId,
    readableId: taskId,
    taskId: orderId,
    orderId,
    title: text(productName) || text(item.name) || `New ${platformName} Order`,
    sku: parsedSku.sku,
    productType: parsedSku.productType,
    idea_emp_id: parsedSku.ideaEmpId,
    originalSku: parsedSku.originalSku,
    description: '',
    category: text(item.category_code),
    variant1: text(item.variant1) || text(item.variant),
    variant2: text(item.variant2),
    personalization,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    transactionId: text(item.transactionId),
    listingId: text(item.listingId),
    status: personalization ? 'draft' : 'new',
    isUrgent: false,
    createdBy: 'auto_sync',
    cs_id: null,
    designerId: null,
    designerName: null,
    submission_count: 0,
    rejection_count: 0,
    account: accountId,
    shopLabel,
    mockupUrl: text(item.image),
    customerFiles: Array.isArray(item.customerFiles) ? item.customerFiles : [],
    sampleFiles: [],
    designFiles: [],
    storagePath: '',
    templateId: [],
    shippingAddress,
    created_at: createdAt,
    updatedAt,
    collectionName: 'tasks',
    schemaVersion: 1,
  };
};
