import type { EtsyListing } from '../../types';
import type { ReportOrderRecord } from '../../services/reportService';

const DAY_MS = 86400000;
const normalizeSku = (value: unknown) => String(value || '').trim().toUpperCase();
const parseTime = (value: unknown) => {
  const time = new Date(String(value || '')).getTime();
  return Number.isFinite(time) ? time : null;
};

export interface ListingSaleObservation {
  key: string;
  date: string;
  orderId: string;
  listingId: string;
  sku: string;
}

export interface ListingSaleObservationIndex {
  byListingId: Map<string, ListingSaleObservation[]>;
  bySku: Map<string, ListingSaleObservation[]>;
  uniqueListingIdBySku: Map<string, string>;
}

export interface ListingCohortStats {
  listingCount: number;
  listingsWithFirstSale: number;
  averageFirstSaleHours: number | null;
  firstSaleDurationsHours: number[];
  d7Eligible: number;
  d7Converted: number;
  d7Rate: number | null;
  d14Eligible: number;
  d14Converted: number;
  d14Rate: number | null;
  d30Eligible: number;
  d30Converted: number;
  d30Rate: number | null;
}

const addObservation = (
  lookup: Map<string, ListingSaleObservation[]>,
  key: string,
  observation: ListingSaleObservation
) => {
  if (!key) return;
  const observations = lookup.get(key) || [];
  observations.push(observation);
  lookup.set(key, observations);
};

export const buildListingSaleObservationIndex = (
  orders: ReportOrderRecord[],
  listings: EtsyListing[] = []
): ListingSaleObservationIndex => {
  const byListingId = new Map<string, ListingSaleObservation[]>();
  const bySku = new Map<string, ListingSaleObservation[]>();
  const listingIdsBySku = listings.reduce((lookup, listing) => {
    const sku = normalizeSku(listing.sku);
    if (!sku) return lookup;
    const listingIds = lookup.get(sku) || new Set<string>();
    listingIds.add(listing.listing_id);
    lookup.set(sku, listingIds);
    return lookup;
  }, new Map<string, Set<string>>());
  const uniqueListingIdBySku = new Map([...listingIdsBySku.entries()]
    .filter(([, listingIds]) => listingIds.size === 1)
    .map(([sku, listingIds]) => [sku, [...listingIds][0]]));
  const uniqueOrders = [...new Map(orders.map((order, orderIndex) => [
    String(order.order_id || order.id || '').trim() || `row:${orderIndex}`,
    order,
  ])).values()];

  uniqueOrders.forEach((order, orderIndex) => {
    if (order.kind !== 'order' || order.status === 'Refunded' || order.source === 'Etsy_Refunded') return;
    const date = new Date(order.dt_local);
    if (Number.isNaN(date.getTime())) return;
    const orderId = String(order.order_id || order.id || '').trim();
    order.items.forEach((item, itemIndex) => {
      const listingId = String(item.listingId || '').trim();
      const sku = normalizeSku(item.sku);
      const observation: ListingSaleObservation = {
        key: `${orderId || order.id || `row:${orderIndex}`}:${listingId || sku}:${itemIndex}`,
        date: date.toISOString(),
        orderId,
        listingId,
        sku,
      };
      addObservation(byListingId, listingId, observation);
      addObservation(bySku, sku, observation);
    });
  });

  return { byListingId, bySku, uniqueListingIdBySku };
};

const getListingObservations = (listing: EtsyListing, index: ListingSaleObservationIndex) => {
  const directObservations = index.byListingId.get(listing.listing_id) || [];
  const sku = normalizeSku(listing.sku);
  const skuFallbackObservations = index.uniqueListingIdBySku.get(sku) === listing.listing_id
    ? (index.bySku.get(sku) || []).filter(observation => !observation.listingId)
    : [];
  const observations = [...directObservations, ...skuFallbackObservations];
  return [...new Map(observations.map(observation => [observation.key, observation])).values()];
};

const rate = (converted: number, eligible: number) => eligible > 0 ? converted / eligible * 100 : null;

export const calculateListingCohortStats = (
  listings: EtsyListing[],
  index: ListingSaleObservationIndex,
  asOfValue: string
): ListingCohortStats => {
  const asOfTime = parseTime(asOfValue.includes('T') ? asOfValue : `${asOfValue.slice(0, 10)}T23:59:59.999Z`) ?? Date.now();
  const uniqueListings = [...new Map(listings.map(listing => [listing.listing_id, listing])).values()];
  const firstSaleDurationsHours: number[] = [];
  let listingsWithFirstSale = 0;
  let d7Eligible = 0;
  let d7Converted = 0;
  let d14Eligible = 0;
  let d14Converted = 0;
  let d30Eligible = 0;
  let d30Converted = 0;

  uniqueListings.forEach(listing => {
    const createdAt = parseTime(listing.create_date);
    if (createdAt === null || createdAt > asOfTime) return;
    const observations = getListingObservations(listing, index)
      .filter(observation => {
        const saleAt = parseTime(observation.date);
        return saleAt !== null && saleAt >= createdAt && saleAt <= asOfTime;
      });
    const observedFirstSale = observations
      .map(observation => observation.date)
      .sort()[0];
    const firstSaleCandidates = [listing.first_sale_date, observedFirstSale]
      .map(parseTime)
      .filter((value): value is number => value !== null && value >= createdAt && value <= asOfTime);
    const firstSaleAt = firstSaleCandidates.length ? Math.min(...firstSaleCandidates) : null;
    const ageMs = asOfTime - createdAt;

    if (firstSaleAt !== null) {
      listingsWithFirstSale += 1;
      firstSaleDurationsHours.push((firstSaleAt - createdAt) / 3600000);
    }
    if (ageMs >= 7 * DAY_MS) {
      d7Eligible += 1;
      if (firstSaleAt !== null && firstSaleAt - createdAt <= 7 * DAY_MS) d7Converted += 1;
    }
    if (ageMs >= 14 * DAY_MS) {
      d14Eligible += 1;
      if (firstSaleAt !== null && firstSaleAt - createdAt <= 14 * DAY_MS) d14Converted += 1;
    }
    if (ageMs >= 30 * DAY_MS) {
      d30Eligible += 1;
      if (firstSaleAt !== null && firstSaleAt - createdAt <= 30 * DAY_MS) d30Converted += 1;
    }
  });

  return {
    listingCount: uniqueListings.length,
    listingsWithFirstSale,
    averageFirstSaleHours: firstSaleDurationsHours.length
      ? firstSaleDurationsHours.reduce((sum, hours) => sum + hours, 0) / firstSaleDurationsHours.length
      : null,
    firstSaleDurationsHours,
    d7Eligible,
    d7Converted,
    d7Rate: rate(d7Converted, d7Eligible),
    d14Eligible,
    d14Converted,
    d14Rate: rate(d14Converted, d14Eligible),
    d30Eligible,
    d30Converted,
    d30Rate: rate(d30Converted, d30Eligible),
  };
};
