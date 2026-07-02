import React, { Suspense, useMemo, useCallback, useState, useEffect } from 'react';
import ChartErrorBoundary from '../ui/ChartErrorBoundary';
import LoadingSpinner from '../ui/LoadingSpinner';
import { OrderItem, ProcessedData, Record } from '../../types';
import DataTable from '../ui/DataTable';
import { useUISettings } from '../../contexts/UIContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { hasPermission } from '../../utils/permissionHelper';
import { useNotification } from '../../contexts/NotificationContext';
import Pagination from '../ui/Pagination';
import { Search, Filter, CheckSquare, X, ChevronRight, Zap, Package, ChevronLeft, Check, ChevronDown, Tag } from 'lucide-react';
import { calculateItemNetRevenue, getOrderItemRevenueContext } from '../../utils/revenueUtils';

const TopProductsChart = React.lazy(() => import('../charts/TopProductsChart'));
import { db, updateRecordsInFirebase } from '../../services/firebaseService';
import { collection, getDocs } from 'firebase/firestore';

const ITEMS_PER_PAGE = 200;
const SKU_CLEANUP_VISIBLE_GROUP_LIMIT = 100;
const INVALID_SKU_VALUES = new Set(['', '-', 'NULL', 'NULL_RATE_LIMIT']);

type SkuCleanupItemRef = {
    refKey: string;
    recordId: string;
    orderId: string;
    shop: string;
    itemIndex: number;
    sku: string;
    rawSku: string;
    name: string;
    quantity: number;
    revenue: number;
    image?: string;
};

type SkuCleanupVariant = {
    sku: string;
    label: string;
    quantity: number;
    revenue: number;
    orders: Set<string>;
    shops: Set<string>;
    refs: SkuCleanupItemRef[];
};

type SkuCleanupGroup = {
    key: string;
    matchType: 'title' | 'mockup';
    name: string;
    quantity: number;
    revenue: number;
    orders: number;
    shops: string[];
    variants: SkuCleanupVariant[];
    suggestedSku: string;
    confidence: 'high' | 'review';
};

const getVariantImages = (variant: SkuCleanupVariant, limit = 6) => {
    const seen = new Set<string>();
    const images: string[] = [];

    variant.refs.forEach(ref => {
        const image = String(ref.image || '').trim();
        if (!image || seen.has(image)) return;
        seen.add(image);
        images.push(image);
    });

    return images.slice(0, limit);
};

const getVariantImageSignature = (variant: SkuCleanupVariant) => {
    const images = Array.from(new Set(variant.refs.map(ref => normalizeCleanupImageUrl(ref.image)).filter(Boolean))).sort();
    return images.length ? images.join('|') : '';
};

const getVariantShopSignature = (variant: SkuCleanupVariant) => (
    Array.from(variant.shops).sort().join('|')
);

const getSkuCleanupRefKey = (recordId: string, itemIndex: number) => `${recordId}:${itemIndex}`;

const hashString = (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
};

const getCleanupUpdatedItemCount = (group: SkuCleanupGroup, canonicalSku: string) => (
    group.variants.reduce((sum, variant) => {
        return sum + variant.refs.filter(ref => normalizeCleanupSku(ref.rawSku) !== canonicalSku).length;
    }, 0)
);

const getCleanupVariantKey = (groupKey: string, variantSku: string) => `${groupKey}::${variantSku}`;

const isAutoFixableSkuGroup = (group: SkuCleanupGroup, canonicalSku: string) => {
    const cleanCanonicalSku = normalizeCleanupSku(canonicalSku);
    if (!cleanCanonicalSku) return false;
    if (group.variants.length < 2 || getCleanupUpdatedItemCount(group, cleanCanonicalSku) === 0) return false;

    const shopSignatures = new Set(group.variants.map(getVariantShopSignature));
    if (shopSignatures.size !== 1) return false;

    const imageSignatures = new Set(group.variants.map(getVariantImageSignature));
    if (imageSignatures.size !== 1 || !Array.from(imageSignatures)[0]) return false;

    return true;
};

const normalizeCleanupSku = (sku?: string | null) => {
    const normalized = String(sku || '').trim().toUpperCase();
    return INVALID_SKU_VALUES.has(normalized) ? '' : normalized;
};

const normalizeCleanupName = (name?: string | null) => (
    name || ''
).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeCleanupImageUrl = (image?: string | null) => {
    const rawImage = String(image || '').trim();
    if (!rawImage) return '';

    try {
        const url = new URL(rawImage);
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/il_(?:fullxfull|\d+x\d+|\d+xN)\./g, 'il_mockup.');
        return url.toString().toLowerCase();
    } catch {
        return rawImage.split('?')[0].split('#')[0].replace(/il_(?:fullxfull|\d+x\d+|\d+xN)\./g, 'il_mockup.').toLowerCase();
    }
};

const getSkuBase = (sku: string) => {
    const parts = sku.split('-').filter(Boolean);
    if (parts.length >= 3) return parts.slice(0, 3).join('-');
    return sku;
};

const getSkuSuffix = (sku: string) => {
    const parts = sku.split('-').filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 1] : sku;
};

const isFullSku = (sku: string) => sku.split('-').filter(Boolean).length >= 2;

const suggestCanonicalSku = (skus: string[]) => {
    const validSkus = skus.filter(Boolean);
    if (validSkus.length === 0) return { sku: '', confidence: 'review' as const };

    const baseCounts = new Map<string, number>();
    const candidateSkus = validSkus.some(isFullSku) ? validSkus.filter(isFullSku) : validSkus;
    candidateSkus.forEach(sku => {
        const base = getSkuBase(sku);
        baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
    });

    const sortedBases = Array.from(baseCounts.entries()).sort((a, b) => {
        const countDiff = b[1] - a[1];
        if (countDiff !== 0) return countDiff;

        const lengthDiff = b[0].split('-').filter(Boolean).length - a[0].split('-').filter(Boolean).length;
        if (lengthDiff !== 0) return lengthDiff;

        return a[0].localeCompare(b[0]);
    });
    const bestBase = sortedBases[0]?.[0] || '';
    const matchingSuffixSkus = skus.filter(sku => sku && getSkuSuffix(sku) === getSkuSuffix(bestBase));
    const hasCompetingBase = sortedBases.some(([base]) => base !== bestBase && getSkuSuffix(base) !== getSkuSuffix(bestBase));

    return {
        sku: bestBase,
        confidence: isFullSku(bestBase) && matchingSuffixSkus.length > 1 && !hasCompetingBase ? 'high' as const : 'review' as const,
    };
};

const buildSkuCleanupGroups = (records: Record[], accountLabelMap: Map<string, string>) => {
    const groups = new Map<string, SkuCleanupGroup>();

    const ensureGroup = (key: string, matchType: SkuCleanupGroup['matchType'], name: string): SkuCleanupGroup => {
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                matchType,
                name,
                quantity: 0,
                revenue: 0,
                orders: 0,
                shops: [],
                variants: [],
                suggestedSku: '',
                confidence: 'review',
            });
        }
        return groups.get(key)!;
    };

    const addRefToGroup = (
        group: SkuCleanupGroup,
        record: Record,
        item: OrderItem,
        itemIndex: number,
        shop: string,
        sku: string,
        rawSku: string,
        name: string,
        revenue: number,
    ) => {
        const quantity = Number(item.quantity || 0);
        group.quantity += quantity;
        group.revenue += revenue;
        if (!group.shops.includes(shop)) group.shops.push(shop);

        const variantKey = sku || '__EMPTY__';
        let variant = group.variants.find(entry => entry.sku === variantKey);
        if (!variant) {
            variant = {
                sku: variantKey,
                label: sku || '(empty)',
                quantity: 0,
                revenue: 0,
                orders: new Set<string>(),
                shops: new Set<string>(),
                refs: [],
            };
            group.variants.push(variant);
        }

        variant.quantity += quantity;
        variant.revenue += revenue;
        if (record.order_id) variant.orders.add(record.order_id);
        variant.shops.add(shop);
        variant.refs.push({
            refKey: getSkuCleanupRefKey(record.id!, itemIndex),
            recordId: record.id!,
            orderId: record.order_id || record.id!,
            shop,
            itemIndex,
            sku,
            rawSku,
            name,
            quantity,
            revenue,
            image: item.image,
        });
    };

    records.forEach(record => {
        if (!record.id || record.kind !== 'order' || !record.details?.items?.length) return;
        const shop = accountLabelMap.get(record.account) || record.account || 'Unknown';
        const financials = record.details.financials;
        const revenueContext = getOrderItemRevenueContext(record.details.items, financials);

        record.details.items.forEach((item, itemIndex) => {
            const name = String(item.name || record.product_name || '').trim();
            const nameKey = normalizeCleanupName(name);
            if (!nameKey) return;

            const sku = normalizeCleanupSku(item.sku);
            const rawSku = item.sku || '';
            const revenue = calculateItemNetRevenue(item, revenueContext);

            addRefToGroup(ensureGroup(`title:${nameKey}`, 'title', name), record, item, itemIndex, shop, sku, rawSku, name, revenue);

            const imageKey = normalizeCleanupImageUrl(item.image);
            if (imageKey) {
                addRefToGroup(ensureGroup(`mockup:${hashString(imageKey)}`, 'mockup', name), record, item, itemIndex, shop, sku, rawSku, name, revenue);
            }
        });
    });

    const seenRefSignatures = new Set<string>();

    return Array.from(groups.values()).map(group => {
        const skus = group.variants.map(variant => variant.sku).filter(sku => sku && sku !== '__EMPTY__');
        const suggestion = suggestCanonicalSku(skus);
        const hasEmpty = group.variants.some(variant => variant.sku === '__EMPTY__');
        const hasMultipleSkus = new Set(skus.map(getSkuBase)).size > 1 || skus.some(sku => sku !== getSkuBase(sku));
        const suffixSet = new Set(skus.map(getSkuSuffix));
        const hasPartialSku = skus.some(sku => !isFullSku(sku) && suffixSet.has(sku));
        const shouldShow = hasEmpty || hasMultipleSkus || hasPartialSku;

        if (!shouldShow || !suggestion.sku) return null;
        if (group.variants.length < 2) return null;

        const refSignature = group.variants.flatMap(variant => variant.refs.map(ref => ref.refKey)).sort().join('|');
        if (!refSignature || seenRefSignatures.has(refSignature)) return null;
        seenRefSignatures.add(refSignature);

        group.suggestedSku = suggestion.sku;
        group.confidence = suggestion.confidence;
        group.orders = new Set(group.variants.flatMap(variant => Array.from(variant.orders))).size;
        group.variants.sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label));
        group.shops.sort();

        return group;
    }).filter(Boolean).sort((a, b) => (b!.quantity - a!.quantity) || b!.revenue - a!.revenue) as SkuCleanupGroup[];
};

const getStaffFromSku = (sku: string): string => {
    if (!sku || sku === '-') return 'Unknown';
    const parts = sku.split('-');
    if (parts.length > 1) {
        return parts[1] || 'Unknown';
    }
    return 'Unknown';
};

interface ProductsTabProps {
    processedData: ProcessedData;
}

const ProductsTab: React.FC<ProductsTabProps> = ({ processedData }) => {
    const { globalUsdMode } = useUISettings();
    const { exchangeRates, records, accounts, teamId } = useDashboard();
    const { addNotification } = useNotification();

    const [isExporting, setIsExporting] = useState(false);
    const [isSkuCleanupOpen, setIsSkuCleanupOpen] = useState(false);
    const [isApplyingSkuCleanup, setIsApplyingSkuCleanup] = useState(false);
    const [skuCleanupProgress, setSkuCleanupProgress] = useState<string | null>(null);
    const [selectedCleanupSkus, setSelectedCleanupSkus] = useState<{ [groupKey: string]: string }>({});
    const [selectedCleanupVariants, setSelectedCleanupVariants] = useState<{ [variantKey: string]: boolean }>({});
    const [dismissedCleanupGroupKeys, setDismissedCleanupGroupKeys] = useState<Set<string>>(() => new Set());

    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(0);
    const [viewMode, setViewMode] = useState<'product' | 'variant' | 'staff'>('product');

    const [userDisplayNames, setUserDisplayNames] = useState<{ [empID: string]: string }>({});

    const accountLabelMap = useMemo(() => new Map(accounts.map(account => [account.email, account.label || account.email])), [accounts]);
    const rawSkuCleanupGroups = useMemo(
        () => buildSkuCleanupGroups(records, accountLabelMap),
        [records, accountLabelMap]
    );
    const pendingSkuCleanupGroups = useMemo(
        () => rawSkuCleanupGroups.filter(group => !dismissedCleanupGroupKeys.has(group.key)),
        [rawSkuCleanupGroups, dismissedCleanupGroupKeys]
    );
    const skuCleanupGroups = useMemo(
        () => pendingSkuCleanupGroups.slice(0, SKU_CLEANUP_VISIBLE_GROUP_LIMIT),
        [pendingSkuCleanupGroups]
    );
    const hasMoreSkuCleanupGroups = pendingSkuCleanupGroups.length > skuCleanupGroups.length;

    useEffect(() => {
        setDismissedCleanupGroupKeys(new Set());
    }, [records]);

    useEffect(() => {
        setSelectedCleanupSkus(current => {
            const next: { [groupKey: string]: string } = {};
            skuCleanupGroups.forEach(group => {
                next[group.key] = current[group.key] || group.suggestedSku;
            });
            return next;
        });
    }, [skuCleanupGroups]);

    useEffect(() => {
        setSelectedCleanupVariants(current => {
            const next: { [variantKey: string]: boolean } = {};
            skuCleanupGroups.forEach(group => {
                const canonicalSku = normalizeCleanupSku(selectedCleanupSkus[group.key] || group.suggestedSku);
                group.variants.forEach(variant => {
                    const key = getCleanupVariantKey(group.key, variant.sku);
                    const shouldUpdate = normalizeCleanupSku(variant.sku === '__EMPTY__' ? '' : variant.sku) !== canonicalSku;
                    next[key] = current[key] ?? shouldUpdate;
                });
            });
            return next;
        });
    }, [skuCleanupGroups, selectedCleanupSkus]);

    const safeSkuCleanupGroups = useMemo(() => {
        return skuCleanupGroups.filter(group => {
            const selectedSku = selectedCleanupSkus[group.key] || group.suggestedSku;
            return isAutoFixableSkuGroup(group, selectedSku);
        });
    }, [skuCleanupGroups, selectedCleanupSkus]);

    const applySkuCleanupGroups = useCallback(async (targetGroups: SkuCleanupGroup[], successLabel: string) => {
        const cleanupTargetsByRefKey = new Map<string, { canonicalSku: string; sourceSku: string }>();

        targetGroups.forEach(group => {
            const canonicalSku = normalizeCleanupSku(selectedCleanupSkus[group.key] || group.suggestedSku);
            if (!canonicalSku) return;

            group.variants.forEach(variant => {
                const sourceSku = variant.sku === '__EMPTY__' ? '' : variant.sku;
                const variantKey = getCleanupVariantKey(group.key, variant.sku);
                if (selectedCleanupVariants[variantKey] && normalizeCleanupSku(sourceSku) !== canonicalSku) {
                    variant.refs.forEach(ref => {
                        if (!cleanupTargetsByRefKey.has(ref.refKey)) {
                            cleanupTargetsByRefKey.set(ref.refKey, {
                                canonicalSku,
                                sourceSku: normalizeCleanupSku(sourceSku),
                            });
                        }
                    });
                }
            });
        });

        if (cleanupTargetsByRefKey.size === 0) {
            addNotification('Please choose a valid SKU before applying.', 'error');
            return;
        }

        const updates: (Partial<Record> & { id: string })[] = [];
        let updatedItems = 0;

        records.forEach(record => {
            if (!record.id || !record.details?.items?.length) return;

            let changed = false;
            const nextItems: OrderItem[] = record.details.items.map((item, itemIndex) => {
                const cleanupTarget = cleanupTargetsByRefKey.get(getSkuCleanupRefKey(record.id!, itemIndex));
                if (!cleanupTarget) return item;

                const currentSku = normalizeCleanupSku(item.sku);
                if (currentSku !== cleanupTarget.sourceSku) return item;
                if (currentSku === cleanupTarget.canonicalSku) return item;

                changed = true;
                updatedItems++;
                return { ...item, sku: cleanupTarget.canonicalSku };
            });

            if (!changed) return;

            updates.push({
                id: record.id,
                dt_local: record.dt_local,
                details: {
                    ...record.details,
                    items: nextItems,
                },
            });
        });

        if (updates.length === 0) {
            addNotification('No SKU changes needed.', 'info');
            return;
        }

        setIsApplyingSkuCleanup(true);
        setSkuCleanupProgress(`Updating 0/${updates.length} records...`);
        try {
            await updateRecordsInFirebase(teamId, updates, {
                batchSize: 250,
                onProgress: ({ processed, total, batchIndex, batchCount, writes }) => {
                    setSkuCleanupProgress(`Committing batch ${batchIndex}/${batchCount} (${writes} writes), ${processed}/${total} records...`);
                },
            });
            setDismissedCleanupGroupKeys(prev => {
                const next = new Set(prev);
                targetGroups.forEach(group => next.add(group.key));
                return next;
            });
            addNotification(`${successLabel}: updated ${updatedItems} items in ${updates.length} records.`, 'success');
        } catch (error) {
            console.error('SKU cleanup failed:', error);
            addNotification('SKU cleanup failed. Please try again.', 'error');
        } finally {
            setIsApplyingSkuCleanup(false);
            setSkuCleanupProgress(null);
        }
    }, [records, selectedCleanupSkus, selectedCleanupVariants, teamId, addNotification]);

    const handleApplySkuCleanup = useCallback(async (group: SkuCleanupGroup) => {
        await applySkuCleanupGroups([group], 'SKU cleanup');
    }, [applySkuCleanupGroups]);

    const handleAutoFixSafeSkuGroups = useCallback(async () => {
        if (safeSkuCleanupGroups.length === 0) {
            addNotification('No safe SKU groups to auto fix.', 'info');
            return;
        }

        await applySkuCleanupGroups(safeSkuCleanupGroups, `Auto fixed ${safeSkuCleanupGroups.length} SKU groups`);
    }, [safeSkuCleanupGroups, applySkuCleanupGroups, addNotification]);

    const handleCleanupSkuTargetChange = useCallback((group: SkuCleanupGroup, nextSku: string) => {
        setSelectedCleanupSkus(prev => ({ ...prev, [group.key]: nextSku }));
        setSelectedCleanupVariants(prev => {
            const next = { ...prev };
            group.variants.forEach(variant => {
                const sourceSku = variant.sku === '__EMPTY__' ? '' : variant.sku;
                next[getCleanupVariantKey(group.key, variant.sku)] = normalizeCleanupSku(sourceSku) !== normalizeCleanupSku(nextSku);
            });
            return next;
        });
    }, []);

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const usersCol = collection(db, 'users');
                const usersSnapshot = await getDocs(usersCol);
                const mapping: { [empID: string]: string } = {};
                usersSnapshot.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.empID && data.displayName) {
                        mapping[String(data.empID).trim()] = data.displayName;
                    }
                });
                setUserDisplayNames(mapping);
            } catch (e) {
                console.error("Error fetching users for staff mapping:", e);
            }
        };
        fetchUsers();
    }, []);
    
    // Reset page when filtering
    useEffect(() => {
        setCurrentPage(0);
    }, [searchTerm, viewMode]);



    // Advanced search logic: +include, -exclude
    const filterByAdvancedSearch = useCallback((text: string, query: string) => {
        if (!query) return true;
        const normalizedText = text.toLowerCase();
        const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);

        const positive = tokens.filter(t => !t.startsWith('-')).map(t => t.startsWith('+') ? t.substring(1) : t);
        const negative = tokens.filter(t => t.startsWith('-')).map(t => t.substring(1));

        // Must match ALL positive tokens
        const matchesPositive = positive.every(p => normalizedText.includes(p));
        if (!matchesPositive) return false;

        // Must match NONE of the negative tokens
        const matchesNegative = negative.some(n => normalizedText.includes(n));
        if (matchesNegative) return false;

        return true;
    }, []);

    // 1. Filter Products
    const filteredProducts = useMemo(() => {
        let rows = processedData.products.rows;
        if (searchTerm) {
            rows = rows.filter(row => filterByAdvancedSearch(`${row[1]} ${row[2]} ${row[4]}`, searchTerm));
        }
        return rows;
    }, [processedData.products.rows, searchTerm, filterByAdvancedSearch]);

    // 2. Filter Variants
    const filteredVariants = useMemo(() => {
        let rows = processedData.variants.rows;
        if (searchTerm) {
            rows = rows.filter(row => filterByAdvancedSearch(String(row[1] || ''), searchTerm));
        }
        return rows;
    }, [processedData.variants.rows, searchTerm, filterByAdvancedSearch]);

    // Final filtered list for display
    const filteredRows = useMemo(() => {
        if (viewMode === 'product') return filteredProducts;
        if (viewMode === 'variant') return filteredVariants;

        const staffMap = new Map<string, {
            staffCode: string;
            quantity: number;
            revenueUSD: number;
            revenuesByCurrency: { [currency: string]: number };
        }>();

        filteredProducts.forEach(row => {
            const sku = row[1] as string;
            const staffCode = getStaffFromSku(sku);
            const quantity = (row[6] as number) || 0;
            const currency = (row[8] as string) || 'USD';
            const rawRevenue = (row[9] as number) || 0;

            let rate = 1;
            if (exchangeRates && currency !== 'USD') {
                rate = exchangeRates[currency] || 1;
            }
            const revenueUSD = rawRevenue * rate;

            if (!staffMap.has(staffCode)) {
                staffMap.set(staffCode, {
                    staffCode,
                    quantity: 0,
                    revenueUSD: 0,
                    revenuesByCurrency: {}
                });
            }

            const staffData = staffMap.get(staffCode)!;
            staffData.quantity += quantity;
            staffData.revenueUSD += revenueUSD;
            staffData.revenuesByCurrency[currency] = (staffData.revenuesByCurrency[currency] || 0) + rawRevenue;
        });

        return Array.from(staffMap.values())
            .filter(staffData => !!userDisplayNames[staffData.staffCode])
            .sort((a, b) => b.revenueUSD - a.revenueUSD)
            .map(staffData => {
                let revenueCell;
                if (globalUsdMode && exchangeRates) {
                    revenueCell = {
                        type: 'value_with_unit' as const,
                        value: staffData.revenueUSD,
                        display: `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(staffData.revenueUSD)}`
                    };
                } else {
                    const currencies = Object.keys(staffData.revenuesByCurrency);
                    if (currencies.length === 0) {
                        revenueCell = {
                            type: 'value_with_unit' as const,
                            value: 0,
                            display: '$0.00 USD'
                        };
                    } else if (currencies.length === 1) {
                        const cur = currencies[0];
                        const val = staffData.revenuesByCurrency[cur];
                        revenueCell = {
                            type: 'value_with_unit' as const,
                            value: val,
                            display: `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)} ${cur}`
                        };
                    } else {
                        const displayStr = currencies
                            .map(cur => `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(staffData.revenuesByCurrency[cur])} ${cur}`)
                            .join(' + ');
                        revenueCell = {
                            type: 'value_with_unit' as const,
                            value: staffData.revenueUSD,
                            display: displayStr
                        };
                    }
                }

                const displayName = userDisplayNames[staffData.staffCode] || 'Unknown';

                return [
                    staffData.staffCode,
                    displayName,
                    staffData.quantity,
                    revenueCell
                ];
            });
    }, [viewMode, filteredProducts, filteredVariants, exchangeRates, globalUsdMode, userDisplayNames]);

    const handleExportInventory = useCallback(async () => {
        setIsExporting(true);
        try {
            const date = new Date().toISOString().split('T')[0];

            // For export, we always include ALL categories as per user request
            // but we still honor the search term if the user is looking for something specific
            const exportProducts = searchTerm ?
                processedData.products.rows.filter(row => filterByAdvancedSearch(`${row[1]} ${row[2]} ${row[4]}`, searchTerm)) :
                processedData.products.rows;

            const exportVariants = searchTerm ?
                processedData.variants.rows.filter(row => filterByAdvancedSearch(String(row[1] || ''), searchTerm)) :
                processedData.variants.rows;

            const { exportInventoryToExcel } = await import('../../utils/excelExport');
            await exportInventoryToExcel(
                { ...processedData.products, rows: exportProducts },
                { ...processedData.variants, rows: exportVariants },
                true, // includeImages
                globalUsdMode,
                exchangeRates,
                `inventory_${date}.xlsx`
            );
        } catch (e) {
            addNotification('Export failed. Please try again.', 'error');
        } finally {
            setIsExporting(false);
        }
    }, [processedData.products, processedData.variants, searchTerm, filterByAdvancedSearch, globalUsdMode, exchangeRates, addNotification]);



    // Headers: ['Checkbox', 'Image', 'Product Name', 'Listing ID', 'Category', 'Variant/Size', 'Shop', 'Quantity', 'Revenue']
    const displayRows = useMemo(() => {
        const rows = filteredRows;

        if (viewMode === 'staff') {
            return rows;
        }

        if (viewMode === 'variant') {
            return rows.map(row => {
                const pCategory = row[0] as string;
                const pVariant = row[1] as string;
                const quantity = row[2];

                const currency = row[4] as string;
                const rawRevenue = row[5] as number;
                let revenueCell = row[3];

                if (globalUsdMode && exchangeRates) {
                    const rate = (currency && currency !== 'USD' && exchangeRates[currency]) ? exchangeRates[currency] : 1;
                    const usdRevenue = rawRevenue * rate;
                    revenueCell = {
                        type: 'value_with_unit' as const,
                        value: usdRevenue,
                        display: `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usdRevenue)}`
                    };
                }

                return [
                    pCategory,
                    pVariant,
                    quantity,
                    revenueCell
                ];
            });
        }

        return rows.map(row => {
            const pSku = row[1] as string;
            const pName = row[2] as string;
            const pCategory = row[3] as string;
            const pVariant = row[4] as string;
            const pGroupingKey = row[11] as string;


            const currency = row[8] as string; // Index 8 is currency
            const rawRevenue = row[9] as number; // Index 9 is raw revenue

            let revenueCell = row[7]; // Index 7 is formatted revenue

            if (globalUsdMode && exchangeRates) {
                const rate = (currency && currency !== 'USD' && exchangeRates[currency])
                    ? exchangeRates[currency]
                    : 1;
                const usdRevenue = rawRevenue * rate;
                revenueCell = {
                    type: 'value_with_unit' as const,
                    value: usdRevenue,
                    display: `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usdRevenue)}`
                };
            }

            return [
                row[0],
                pSku,
                pName,
                pCategory,
                pVariant,
                row[5], // Shop
                row[6], // Quantity
                revenueCell
            ];
        });
    }, [filteredRows, globalUsdMode, exchangeRates, viewMode]);

    const headers = viewMode === 'product'
        ? processedData.products.headers
        : viewMode === 'staff'
            ? ['Staff Code', 'Staff Name', 'Quantity', 'Revenue']
            : processedData.variants.headers;

    const totalPages = Math.ceil(displayRows.length / ITEMS_PER_PAGE);
    const paginatedRows = useMemo(() => {
        return displayRows.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
    }, [displayRows, currentPage]);

    return (
        <div className="flex flex-col min-h-0 h-full bg-gray-50 dark:bg-gray-900">
            <div className="flex-1 overflow-y-auto p-2 md:p-6 pb-24 md:pb-6">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 relative hover:z-50 transition-all duration-300">
                        <ChartErrorBoundary>
                            <TopProductsChart
                                data={processedData.summary.topProductsByShop}
                                title="Top Products by Shop"
                            />
                        </ChartErrorBoundary>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 relative hover:z-50 transition-all duration-300">
                        <ChartErrorBoundary>
                            <TopProductsChart
                                data={{ "Comparison": processedData.summary.categoryComparison }}
                                detailedData={processedData.summary.topProductsByCategory}
                                title="Sales by Category"
                                hideTitle={false}
                            />
                        </ChartErrorBoundary>
                    </div>
                </div>

                <div className="mb-8" id="inventory-section">
                    <div className="flex flex-col h-auto md:h-[800px] border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-visible md:overflow-hidden shadow-sm">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md relative z-30">
                            <div className="flex items-center justify-between w-full lg:w-auto gap-4">
                                {viewMode === 'product' ? (
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
                                            Product Summary
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-medium">({filteredRows.length} items)</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
                                            {viewMode === 'staff' ? 'Staff Summary' : 'Variant Summary'}
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-medium">({filteredRows.length} items)</span>
                                    </div>
                                )}

                                {/* Export Button - Mobile Only here */}
                                <div className="lg:hidden flex-shrink-0">
                                    <button
                                        onClick={handleExportInventory}
                                        disabled={isExporting}
                                        className="flex items-center justify-center p-2.5 bg-green-50 hover:bg-green-100 text-green-700 dark:bg-green-900/20 dark:hover:bg-green-900/40 dark:text-green-400 rounded-xl transition-colors border border-green-200 dark:border-green-800 disabled:opacity-50 shadow-sm"
                                        title="Export Inventory"
                                    >
                                        {isExporting
                                            ? <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                                            : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto flex-1 lg:justify-end">
                                <div className="relative w-full sm:w-80 group">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Search size={16} className="text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Search products..."
                                        className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <span className="px-1.5 py-0.5 bg-gray-200/50 dark:bg-gray-800 rounded text-[9px] font-bold text-gray-500  tracking-tighter">
                                            {filteredRows.length} found
                                        </span>
                                    </div>
                                </div>

                                <div className="relative w-full sm:w-52">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Filter size={14} className="text-gray-400" />
                                    </div>
                                    <select
                                        className="w-full pl-9 pr-10 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none appearance-none cursor-pointer font-medium"
                                        value={viewMode}
                                        onChange={(e) => setViewMode(e.target.value as 'product' | 'variant' | 'staff')}
                                    >
                                        <option value="product">Group by Product</option>
                                        <option value="variant">Group by Variant</option>
                                        <option value="staff">Group by Staff</option>
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <ChevronDown size={14} className="text-gray-400" />
                                    </div>
                                </div>

                                {/* SKU Cleanup Button */}
                                <button
                                    onClick={() => setIsSkuCleanupOpen(true)}
                                    disabled={pendingSkuCleanupGroups.length === 0}
                                    className="flex items-center justify-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 dark:text-amber-300 rounded-lg transition-colors border border-amber-200 dark:border-amber-800 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold whitespace-nowrap"
                                    title={pendingSkuCleanupGroups.length ? 'Clean SKU groups that need review' : 'No SKU cleanup issues found'}
                                >
                                    <Tag size={14} />
                                    Clean SKU
                                    {pendingSkuCleanupGroups.length > 0 && (
                                        <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-600 text-white text-[10px] flex items-center justify-center">
                                            {pendingSkuCleanupGroups.length}
                                        </span>
                                    )}
                                </button>

                                {/* Export Button - Desktop Only here */}
                                <button
                                    onClick={handleExportInventory}
                                    disabled={isExporting}
                                    className="hidden lg:flex items-center justify-center p-2 bg-green-50 hover:bg-green-100 text-green-700 dark:bg-green-900/20 dark:hover:bg-green-900/40 dark:text-green-400 rounded-lg transition-colors border border-green-200 dark:border-green-800 disabled:opacity-50"
                                    title="Export Inventory (By Product + By Variant)"
                                >
                                    {isExporting
                                        ? <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                                        : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
                                </button>
                            </div>
                        </div>



                        <div className="flex-1 min-h-0 relative">
                            <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                                <DataTable
                                    headers={headers}
                                    data={paginatedRows}
                                    columnWidths={viewMode === 'product' ? {
                                        'Image': 80,
                                        'SKU': 200,
                                        'Product Name': 300,
                                        'Category': 160,
                                        'Variant/Size': 180,
                                        'Shop': 120,
                                        'Quantity': 80,
                                        'Revenue': 120
                                    } : viewMode === 'staff' ? {
                                        'Staff Code': 150,
                                        'Staff Name': 200,
                                        'Quantity': 100,
                                        'Revenue': 150
                                    } : {
                                        'Category': 200,
                                        'Variant/Size': 400,
                                        'Quantity': 100,
                                        'Revenue': 200
                                    }}
                                />
                            </Suspense>
                        </div>

                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={setCurrentPage}
                        />
                    </div>
                </div>
            </div>

            {isSkuCleanupOpen && (
                <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
                    <div className="w-full max-w-7xl max-h-[88vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-base font-bold text-gray-900 dark:text-white">SKU Cleanup</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Only products with missing, partial, or conflicting SKUs are shown. Matching also uses mockup image links.
                                    {hasMoreSkuCleanupGroups ? ` Showing first ${SKU_CLEANUP_VISIBLE_GROUP_LIMIT} of ${pendingSkuCleanupGroups.length}.` : ''}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {skuCleanupProgress && (
                                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-300">
                                        {skuCleanupProgress}
                                    </span>
                                )}
                                <button
                                    onClick={handleAutoFixSafeSkuGroups}
                                    disabled={isApplyingSkuCleanup || safeSkuCleanupGroups.length === 0}
                                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Auto apply only groups with same product, same shops, and same image links"
                                >
                                    Auto fix safe {safeSkuCleanupGroups.length > 0 ? `(${safeSkuCleanupGroups.length})` : ''}
                                </button>
                                <button
                                    onClick={() => setIsSkuCleanupOpen(false)}
                                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
                                    aria-label="Close SKU cleanup"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {skuCleanupGroups.length === 0 ? (
                                <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                                    No SKU cleanup issues found in the current loaded records.
                                </div>
                            ) : skuCleanupGroups.map(group => {
                                const selectedSku = selectedCleanupSkus[group.key] || group.suggestedSku;
                                const isAutoSafe = isAutoFixableSkuGroup(group, selectedSku);
                                const candidateSkus = Array.from(new Set([
                                    group.suggestedSku,
                                    ...group.variants
                                        .map(variant => variant.sku)
                                        .filter(sku => sku && sku !== '__EMPTY__')
                                        .map(getSkuBase)
                                ])).filter(Boolean);
                                const dropdownSkus = candidateSkus.includes(selectedSku) ? candidateSkus : [selectedSku, ...candidateSkus].filter(Boolean);
                                const updatedItems = group.variants.reduce((sum, variant) => {
                                    const sourceSku = variant.sku === '__EMPTY__' ? '' : variant.sku;
                                    const variantKey = getCleanupVariantKey(group.key, variant.sku);
                                    if (!selectedCleanupVariants[variantKey]) return sum;
                                    if (normalizeCleanupSku(sourceSku) === normalizeCleanupSku(selectedSku)) return sum;
                                    return sum + variant.refs.length;
                                }, 0);

                                return (
                                    <div key={group.key} className="border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/60 overflow-hidden">
                                        <div className="p-3 flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${group.confidence === 'high' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'}`}>
                                                        {group.confidence === 'high' ? 'Suggested' : 'Review'}
                                                    </span>
                                                    {group.matchType === 'mockup' && (
                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                                            Mockup match
                                                        </span>
                                                    )}
                                                    {isAutoSafe && (
                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                                            Auto safe
                                                        </span>
                                                    )}
                                                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                                        {group.variants.length} SKU variants - {group.quantity} qty - {group.orders} orders
                                                    </span>
                                                </div>
                                                <h4 className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-2">
                                                    {group.name}
                                                </h4>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                                    {group.shops.join(', ')}
                                                </p>
                                            </div>

                                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 lg:min-w-[620px]">
                                                <select
                                                    value={selectedSku}
                                                    onChange={(event) => handleCleanupSkuTargetChange(group, event.target.value)}
                                                    className="flex-1 min-w-[220px] px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-semibold text-gray-800 dark:text-gray-100 outline-none focus:ring-2 focus:ring-amber-500/20"
                                                >
                                                    {dropdownSkus.map(sku => (
                                                        <option key={sku} value={sku}>{sku}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    type="text"
                                                    value={selectedSku}
                                                    onChange={(event) => handleCleanupSkuTargetChange(group, event.target.value)}
                                                    placeholder="Custom SKU"
                                                    className="flex-1 min-w-[240px] px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-semibold text-gray-800 dark:text-gray-100 outline-none focus:ring-2 focus:ring-amber-500/20"
                                                    title="Type any SKU if the correct one is not in the list"
                                                />
                                                <button
                                                    onClick={() => handleApplySkuCleanup(group)}
                                                    disabled={isApplyingSkuCleanup || !selectedSku || updatedItems === 0}
                                                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                                >
                                                    Apply {updatedItems}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="overflow-x-auto border-t border-gray-200 dark:border-gray-700">
                                            <table className="w-full text-xs">
                                                <thead className="bg-white/70 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400">
                                                    <tr>
                                                        <th className="text-left px-3 py-2 font-semibold">Update</th>
                                                        <th className="text-left px-3 py-2 font-semibold">Current SKU</th>
                                                        <th className="text-left px-3 py-2 font-semibold">Images</th>
                                                        <th className="text-right px-3 py-2 font-semibold">Qty</th>
                                                        <th className="text-right px-3 py-2 font-semibold">Items</th>
                                                        <th className="text-left px-3 py-2 font-semibold">Shops</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                                    {group.variants.map(variant => {
                                                        const images = getVariantImages(variant);
                                                        const totalImages = new Set(variant.refs.map(ref => ref.image).filter(Boolean)).size;
                                                        const sourceSku = variant.sku === '__EMPTY__' ? '' : variant.sku;
                                                        const variantKey = getCleanupVariantKey(group.key, variant.sku);
                                                        const isCanonicalVariant = normalizeCleanupSku(sourceSku) === normalizeCleanupSku(selectedSku);
                                                        const isVariantSelected = Boolean(selectedCleanupVariants[variantKey]) && !isCanonicalVariant;

                                                        return (
                                                            <tr key={variant.sku} className="text-gray-700 dark:text-gray-200">
                                                                <td className="px-3 py-2">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isVariantSelected}
                                                                        disabled={isCanonicalVariant}
                                                                        onChange={(event) => setSelectedCleanupVariants(prev => ({
                                                                            ...prev,
                                                                            [variantKey]: event.target.checked,
                                                                        }))}
                                                                        className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 disabled:opacity-40"
                                                                        title={isCanonicalVariant ? 'Already canonical SKU' : 'Update this SKU variant'}
                                                                    />
                                                                </td>
                                                                <td className="px-3 py-2 font-mono min-w-[180px]">
                                                                    <span className={variant.sku === '__EMPTY__' ? 'text-red-500 font-semibold' : ''}>
                                                                        {variant.label}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-2 min-w-[220px]">
                                                                    {images.length > 0 ? (
                                                                        <div className="flex items-center gap-1.5">
                                                                            {images.map(image => (
                                                                                <a
                                                                                    key={image}
                                                                                    href={image}
                                                                                    target="_blank"
                                                                                    rel="noreferrer"
                                                                                    className="block h-10 w-10 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:ring-2 hover:ring-amber-400 transition"
                                                                                    title="Open image"
                                                                                >
                                                                                    <img
                                                                                        src={image}
                                                                                        alt=""
                                                                                        loading="lazy"
                                                                                        className="h-full w-full object-cover"
                                                                                    />
                                                                                </a>
                                                                            ))}
                                                                            {totalImages > images.length && (
                                                                                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                                                                    +{totalImages - images.length}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <span className="text-gray-400">No image</span>
                                                                    )}
                                                                </td>
                                                                <td className="px-3 py-2 text-right font-semibold">{variant.quantity}</td>
                                                                <td className="px-3 py-2 text-right">{variant.refs.length}</td>
                                                                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                                                                    {Array.from(variant.shops).sort().join(', ')}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductsTab;
