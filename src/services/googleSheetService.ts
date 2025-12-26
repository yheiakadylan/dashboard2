import { Record } from '../types';
import { getGoogleAccessToken } from './authService';
import { Account } from '../types';
import { GOOGLE_SHEET_COLUMNS } from '../config/sheetColumns';

// Múi giờ cố định UTC-7  
const TIMEZONE_UTC7 = 'Etc/GMT+7'; // Fixed UTC-7 (no DST)

// Use shared column configuration (convert readonly to mutable)
const COLUMNS = [...GOOGLE_SHEET_COLUMNS];

interface SheetInfo {
    title: string;
    sheetId: number;
}

interface DateGroup {
    dateString: string;
    orders: Map<string, OrderGroup>;
}

interface OrderGroup {
    orderId: string;
    rows: any[][];
    sortTime: number;
}

// Helper to safely format range with sheet name
const getRange = (sheetName: string, range: string) => {
    const safeName = sheetName.includes(' ') || /[^a-zA-Z0-9]/.test(sheetName)
        ? `'${sheetName}'`
        : sheetName;
    return `${safeName}!${range}`;
};

// Convert timestamp to UTC-7 date+time string DD/MM/YYYY HH:mm
const toUTC7DateString = (timestamp: string): string => {
    const date = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIMEZONE_UTC7,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    return formatter.format(date);
};

// Get month key in Vietnamese format: "Tháng M" (e.g., "Tháng 1", "Tháng 12")
const getVietnameseMonthKey = (timestamp: string): string => {
    try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return 'Unsorted';

        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: TIMEZONE_UTC7,
            month: 'numeric',
            year: 'numeric'
        });

        const parts = formatter.formatToParts(date);
        const month = parts.find(p => p.type === 'month')?.value;
        const year = parts.find(p => p.type === 'year')?.value;

        return `Tháng ${month} - ${year}`;
    } catch {
        return 'Unsorted';
    }
};

// Parse existing date/time from sheet and return timestamp
const parseDateTimeFromSheet = (value: any): number => {
    if (!value) return 0;

    const asNum = Number(value);
    if (!isNaN(asNum) && asNum > 30000) {
        // Excel serial number
        return Math.round((asNum - 25569) * 86400000);
    }

    // Parse DD/MM/YYYY HH:mm or DD/MM/YYYY format
    const str = String(value).trim();
    const parts = str.split(/[\s,]+/); // Split by space or comma

    if (parts.length >= 1) {
        const datePart = parts[0]; // "DD/MM/YYYY"
        const timePart = parts[1] || '00:00'; // "HH:mm" or default

        const [day, month, year] = datePart.split('/').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);

        if (year && month && day) {
            return new Date(year, month - 1, day, hour || 0, minute || 0).getTime();
        }
    }

    return 0;
};

// Đọc toàn bộ dữ liệu hiện tại từ sheet
const readExistingSheetData = async (
    spreadsheetId: string,
    sheetName: string,
    accessToken: string
) => {
    const readRange = getRange(sheetName, 'A:ZZ');
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${readRange}?valueRenderOption=FORMULA`;

    const res = await fetch(readUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data = await res.json();
    return data.values || [];
};

// Phân tích cấu trúc dữ liệu hiện tại theo ngày
const analyzeSheetStructure = (
    allRows: any[][],
    dateColIndex: number,
    orderNumIndex: number
) => {
    const dateGroups: DateGroup[] = [];
    let currentDateGroup: DateGroup | null = null;
    let currentOrderGroup: OrderGroup | null = null;

    allRows.forEach((row, idx) => {
        if (idx === 0) return; // Skip header

        // Check if this is a date header row (merged row with date)
        const firstCell = String(row[0] || '').trim();
        const isDateRow = firstCell.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/);

        if (isDateRow) {
            // New date group
            if (currentDateGroup && currentOrderGroup) {
                currentDateGroup.orders.set(currentOrderGroup.orderId, currentOrderGroup);
            }

            currentDateGroup = {
                dateString: firstCell,
                orders: new Map()
            };
            dateGroups.push(currentDateGroup);
            currentOrderGroup = null;
        } else if (currentDateGroup) {
            // Data row
            const orderId = String(row[orderNumIndex] || '').trim();

            if (orderId && orderId !== 'Order number') {
                if (!currentOrderGroup || currentOrderGroup.orderId !== orderId) {
                    // Save previous order
                    if (currentOrderGroup) {
                        currentDateGroup.orders.set(currentOrderGroup.orderId, currentOrderGroup);
                    }

                    // New order group
                    currentOrderGroup = {
                        orderId,
                        rows: [row],
                        sortTime: 0
                    };
                } else {
                    // Same order, add row (multi-item)
                    currentOrderGroup.rows.push(row);
                }
            }
        }
    });

    // Save last group
    if (currentDateGroup && currentOrderGroup) {
        currentDateGroup.orders.set(currentOrderGroup.orderId, currentOrderGroup);
    }

    return dateGroups;
};

/**
 * Check which orders are new vs already exist in the sheet
 * Returns {newOrders, existingOrders}
 */
export const getNewAndExistingOrders = async (
    spreadsheetId: string,
    sheetName: string,
    records: Record[],
    accessToken: string
): Promise<{ newOrders: Record[]; existingOrders: Record[] }> => {
    try {
        // Read existing data
        const allRows = await readExistingSheetData(spreadsheetId, sheetName, accessToken);

        if (allRows.length === 0) {
            // Empty sheet - all records are new
            return { newOrders: records, existingOrders: [] };
        }

        const currentHeaders = allRows[0];
        const orderNumIndex = currentHeaders.findIndex(h =>
            h.toLowerCase().includes('order number') || h.toLowerCase().includes('order num')
        );

        if (orderNumIndex === -1) {
            // Can't find order column - assume all new
            return { newOrders: records, existingOrders: [] };
        }

        // Build set of existing order numbers
        const existingOrderNumbers = new Set<string>();
        for (let i = 1; i < allRows.length; i++) {
            const orderNum = String(allRows[i][orderNumIndex] || '').trim();
            if (orderNum) existingOrderNumbers.add(orderNum);
        }

        // Filter records
        const newOrders: Record[] = [];
        const existingOrders: Record[] = [];

        records.forEach(r => {
            const orderId = String(r.order_id).trim();
            if (existingOrderNumbers.has(orderId)) {
                existingOrders.push(r);
            } else {
                newOrders.push(r);
            }
        });

        return { newOrders, existingOrders };
    } catch (error) {
        console.error('Error checking existing orders:', error);
        // On error, assume all new
        return { newOrders: records, existingOrders: [] };
    }
};


// Sync batch to specific sheet with INSERT logic
const syncBatchToSpecificSheet = async (
    spreadsheetId: string,
    sheetInfo: SheetInfo,
    records: Record[],
    accessToken: string,
    accountLabelMap: Map<string, string>
) => {
    const { title: sheetName, sheetId: sheetIdNum } = sheetInfo;

    // 1. Read existing data
    let allRows = await readExistingSheetData(spreadsheetId, sheetName, accessToken);

    // 2. Initialize headers if needed
    let currentHeaders: string[] = [];

    if (allRows.length === 0) {
        // Empty sheet - write headers (20 columns now: A-T)
        const writeHeaderRange = getRange(sheetName, `A1:${String.fromCharCode(65 + COLUMNS.length - 1)}1`);
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${writeHeaderRange}?valueInputOption=RAW`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: [COLUMNS] })
        });

        // Format header row
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                requests: [
                    // Header formatting (existing)
                    {
                        repeatCell: {
                            range: {
                                sheetId: sheetIdNum,
                                startRowIndex: 0,
                                endRowIndex: 1,
                                startColumnIndex: 0,
                                endColumnIndex: COLUMNS.length
                            },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: { red: 0.26, green: 0.52, blue: 0.96 },
                                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 11 },
                                    horizontalAlignment: "CENTER",
                                    verticalAlignment: "MIDDLE"
                                }
                            },
                            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                        }
                    },
                    // Column widths (NEW)
                    // Date & Time: base 120px + 5px = 125px
                    {
                        updateDimensionProperties: {
                            range: { sheetId: sheetIdNum, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
                            properties: { pixelSize: 125 },
                            fields: 'pixelSize'
                        }
                    },
                    // Customer Info: 200px (double)
                    {
                        updateDimensionProperties: {
                            range: { sheetId: sheetIdNum, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 },
                            properties: { pixelSize: 200 },
                            fields: 'pixelSize'
                        }
                    },
                    // Variant: 150px (1.5x)
                    {
                        updateDimensionProperties: {
                            range: { sheetId: sheetIdNum, dimension: 'COLUMNS', startIndex: 13, endIndex: 14 },
                            properties: { pixelSize: 150 },
                            fields: 'pixelSize'
                        }
                    }
                ]
            })
        });

        // RE-READ để allRows có header row
        allRows = await readExistingSheetData(spreadsheetId, sheetName, accessToken);
        currentHeaders = COLUMNS;
    } else {
        currentHeaders = allRows[0] || [];
    }

    // 3. Find column indices (direct matching with new clean column names)
    const dateColIndex = currentHeaders.findIndex(h => h === 'Date & Time');
    const orderNumIndex = currentHeaders.findIndex(h => h === 'Order ID');
    const sttColIndex = currentHeaders.findIndex(h => h === 'No.');
    const mockupColIndex = currentHeaders.findIndex(h => h === 'Mockup');
    const customerColIndex = currentHeaders.findIndex(h => h === 'Customer Info');
    const fileFfColIndex = currentHeaders.findIndex(h => h === 'Variant');
    const linkColIndex = currentHeaders.findIndex(h => h === 'Product URL');
    const trackingColIndex = currentHeaders.findIndex(h => h === 'Tracking');

    // 4. Analyze existing structure
    const existingDateGroups = analyzeSheetStructure(allRows, dateColIndex, orderNumIndex);

    // 5. Recover product URL mapping
    const productUrlMap = new Map<string, string>();
    existingDateGroups.forEach(dg => {
        dg.orders.forEach(og => {
            og.rows.forEach(row => {
                if (linkColIndex !== -1) {
                    const linkValue = String(row[linkColIndex] || '');
                    if (linkValue.includes('http') || linkValue.includes('www.')) {
                        const orderId = row[orderNumIndex];
                        const matchingRecord = records.find(r => String(r.order_id) === String(orderId));
                        if (matchingRecord?.details?.items) {
                            matchingRecord.details.items.forEach(item => {
                                const pName = (item.name || '').trim();
                                if (pName && !productUrlMap.has(pName)) {
                                    productUrlMap.set(pName, linkValue);
                                }
                            });
                        }
                    }
                }
            });
        });
    });

    // 6. Filter: Only sync NEW orders (not in existing sheet)
    const existingOrderNumbers = new Set<string>();
    for (let i = 1; i < allRows.length; i++) {
        const orderNum = String(allRows[i][orderNumIndex] || '').trim();
        if (orderNum) existingOrderNumbers.add(orderNum);
    }

    console.log('[Sync] Existing orders:', Array.from(existingOrderNumbers));
    console.log('[Sync] Records to check:', records.map(r => r.order_id));

    const newRecords = records.filter(r => {
        const orderId = String(r.order_id).trim();
        return !existingOrderNumbers.has(orderId);
    });

    console.log('[Sync] New records to sync:', newRecords.length);

    if (newRecords.length === 0) {
        console.log('[Sync] All orders already exist. Skipping.');
        return { count: 0, skipped: records.length };
    }

    // 7. Build rows for new records
    const recordsToSync = new Map<string, { record: Record, rows: any[][], sortTime: number }>();

    newRecords.forEach(record => {
        const orderId = String(record.order_id).trim();
        const dateKey = toUTC7DateString(record.dt_local);

        const shopEmail = record.account || '';
        const shop = accountLabelMap.get(shopEmail) || shopEmail;
        const customerInfo = record.details?.shippingAddress
            ? [
                record.details.shippingAddress.name,
                record.details.shippingAddress.address1,
                record.details.shippingAddress.address2,
                `${record.details.shippingAddress.city}, ${record.details.shippingAddress.state} ${record.details.shippingAddress.zip}`,
                record.details.shippingAddress.country
            ].filter(Boolean).join('\n')
            : '';
        const revenue = record.amount || 0;
        const baseCost = record.cost_total || 0;

        const itemsToProcess = (record.details?.items && record.details.items.length > 0)
            ? record.details.items
            : [{ name: '', image: '', variant: '' }];

        const orderRows: any[][] = [];

        itemsToProcess.forEach((item: any) => {
            const productName = item.name || '';
            const mockup = item.image || '';
            // Filter out "Personalised item" from variant
            const rawVariant = item.variant || '';
            const variant = rawVariant.replace(/Personalised item\s*/gi, '').trim();


            const row = COLUMNS.map(col => {
                const h = col.toLowerCase();
                // No. (STT)
                if (h.includes('no.') || h.includes('stt')) return '';
                // Shop
                if (h.includes('shop')) return shop;
                // Product (Product Name)
                if (h.includes('product') && !h.includes('url')) return productName;
                // Product URL (Link)
                if (h.includes('product url') || h === 'link') {
                    const trimmedName = productName.trim();
                    return productUrlMap.get(trimmedName) || '';
                }
                // Mockup
                if (h.includes('mockup')) return mockup ? `=IMAGE("${mockup}"; 4; 200; 200)` : '';
                // Date & Time (Ngày)
                if (h.includes('date') || h.includes('ngày') || h.includes('ngay')) return dateKey;
                // Order ID (Order number)
                if (h.includes('order id') || h.includes('order number')) return record.order_id;
                // Tracking
                if (h.includes('tracking')) return '';
                // Customer Info (Tên,SĐT, địa chỉ khách)
                if (h.includes('customer') || h.includes('khách')) return customerInfo;
                // Revenue
                if (h.includes('revenue')) return revenue;
                // Base Cost (Basecost)
                if (h.includes('base cost') || h.includes('basecost')) return baseCost;
                // Variant (File ff)
                if (h.includes('variant') || h.includes('file ff')) return variant;
                return '';
            });

            orderRows.push(row);
        });

        recordsToSync.set(orderId, {
            record,
            rows: orderRows,
            sortTime: new Date(record.dt_local).getTime()
        });
    });

    // 8. Sort new orders by time (oldest to newest)
    const sortedOrders = Array.from(recordsToSync.values()).sort((a, b) => a.sortTime - b.sortTime);

    // 9. Calculate STT starting number (last STT + 1)
    let nextSTT = 1;
    if (allRows.length > 1) {
        // Find max STT in existing data
        for (let i = 1; i < allRows.length; i++) {
            const sttValue = Number(allRows[i][sttColIndex]) || 0;
            if (sttValue >= nextSTT) nextSTT = sttValue + 1;
        }
    }

    // 10. Build final rows with STT
    const finalRows: any[][] = [];
    sortedOrders.forEach(orderData => {
        orderData.rows.forEach((row, idx) => {
            if (sttColIndex !== -1 && idx === 0) {
                row[sttColIndex] = nextSTT;
            }
            finalRows.push(row);
        });
        nextSTT++;
    });

    // 11. Append new rows to sheet
    const startRowIndex = allRows.length; // Next empty row (1-indexed)
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${getRange(sheetName, `A${startRowIndex + 1}`)}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: finalRows })
    });

    // 12. Apply formatting for new orders
    const formatRequests: any[] = [];
    let currentRowIdx = startRowIndex; // 0-indexed

    sortedOrders.forEach(orderData => {
        const rowCount = orderData.rows.length;
        const startRow = currentRowIdx;
        const endRow = currentRowIdx + rowCount;

        // Border around order
        formatRequests.push({
            updateBorders: {
                range: {
                    sheetId: sheetIdNum,
                    startRowIndex: startRow,
                    endRowIndex: endRow,
                    startColumnIndex: 0,
                    endColumnIndex: COLUMNS.length
                },
                top: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
                bottom: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
                left: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
                right: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } }
            }
        });

        // Merge cells for multi-item orders
        if (rowCount > 1) {
            const shopColIdx = currentHeaders.findIndex(h => h === 'Shop');
            const dateColIdx = currentHeaders.findIndex(h => h === 'Date & Time');
            const orderNumColIdx = currentHeaders.findIndex(h => h === 'Order ID');
            const revenueColIdx = currentHeaders.findIndex(h => h === 'Revenue');
            const basecostColIdx = currentHeaders.findIndex(h => h === 'Base Cost');
            const customerColIdx = currentHeaders.findIndex(h => h === 'Customer Info');
            const trackingColIdx = currentHeaders.findIndex(h => h === 'Tracking');
            const sttColIdx = currentHeaders.findIndex(h => h === 'No.');

            const columnsToMerge = [
                { idx: sttColIdx, name: 'No.' },
                { idx: shopColIdx, name: 'Shop' },
                { idx: dateColIdx, name: 'Date & Time' },
                { idx: orderNumColIdx, name: 'Order ID' },
                { idx: trackingColIdx, name: 'Tracking' },
                { idx: customerColIdx, name: 'Customer Info' },
                { idx: revenueColIdx, name: 'Revenue' },
                { idx: basecostColIdx, name: 'Base Cost' }
            ];

            columnsToMerge.forEach(col => {
                if (col.idx !== -1) {
                    formatRequests.push({
                        mergeCells: {
                            range: {
                                sheetId: sheetIdNum,
                                startRowIndex: startRow,
                                endRowIndex: endRow,
                                startColumnIndex: col.idx,
                                endColumnIndex: col.idx + 1
                            },
                            mergeType: "MERGE_ALL"
                        }
                    });
                }
            });
        }

        currentRowIdx = endRow;
    });

    // Add column widths và row heights
    const mockupColIdx = currentHeaders.findIndex(h => h.toLowerCase().includes('mockup'));
    const customerColIdx = currentHeaders.findIndex(h => h.toLowerCase().includes('khách'));
    const fileFfColIdx = currentHeaders.findIndex(h => h.toLowerCase().includes('file ff'));

    // Set column widths
    if (mockupColIdx !== -1) {
        formatRequests.push({
            updateDimensionProperties: {
                range: { sheetId: sheetIdNum, dimension: 'COLUMNS', startIndex: mockupColIdx, endIndex: mockupColIdx + 1 },
                properties: { pixelSize: 220 },
                fields: 'pixelSize'
            }
        });
    }

    if (customerColIdx !== -1) {
        formatRequests.push({
            updateDimensionProperties: {
                range: { sheetId: sheetIdNum, dimension: 'COLUMNS', startIndex: customerColIdx, endIndex: customerColIdx + 1 },
                properties: { pixelSize: 350 },
                fields: 'pixelSize'
            }
        });
    }

    if (fileFfColIdx !== -1) {
        formatRequests.push({
            updateDimensionProperties: {
                range: { sheetId: sheetIdNum, dimension: 'COLUMNS', startIndex: fileFfColIdx, endIndex: fileFfColIdx + 1 },
                properties: { pixelSize: 280 },
                fields: 'pixelSize'
            }
        });
    }

    // Set row heights (200px for all data rows to accommodate images)
    const totalDataRows = startRowIndex + finalRows.length; // Total rows after append
    if (totalDataRows > 1) {
        formatRequests.push({
            updateDimensionProperties: {
                range: { sheetId: sheetIdNum, dimension: 'ROWS', startIndex: 1, endIndex: totalDataRows },
                properties: { pixelSize: 200 },
                fields: 'pixelSize'
            }
        });
    }

    // Center align all data cells (entire sheet)
    if (totalDataRows > 1) {
        formatRequests.push({
            repeatCell: {
                range: {
                    sheetId: sheetIdNum,
                    startRowIndex: 1,
                    endRowIndex: totalDataRows,
                    startColumnIndex: 0,
                    endColumnIndex: COLUMNS.length
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: "CENTER",
                        verticalAlignment: "MIDDLE",
                        wrapStrategy: "WRAP"
                    }
                },
                fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)"
            }
        });
    }

    // Apply formatting
    if (formatRequests.length > 0) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requests: formatRequests })
        });
    }

    return records.length;
};

export const syncRecordsToGoogleSheet = async (
    sheetId: string,
    records: Record[],
    account: Account,
    allAccounts: Account[] = [],
    _timeZone: string // Ignored, we use UTC-7
): Promise<{ success: boolean; message: string; count?: number }> => {
    try {
        if (!records.length) {
            return { success: true, message: 'No records to sync.' };
        }

        // 1. Get Access Token
        const accessToken = await getGoogleAccessToken(account, { forceRefresh: true });

        // 2. Verify token scopes
        try {
            const tokenInfoRes = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`);
            const tokenInfo = await tokenInfoRes.json();
            if (!tokenInfo.scope.includes('spreadsheets')) {
                throw new Error("Token is valid but missing 'spreadsheets' scope. Please reconnect the account.");
            }
        } catch (e: any) {
            console.error("[Google Sheets] Token Check Failed:", e);
            if (e.message.includes('missing')) throw e;
        }

        // 3. Fetch Spreadsheet Metadata
        const metadataRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title,sheets.properties.sheetId`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!metadataRes.ok) {
            const errorBody = await metadataRes.json().catch(() => ({}));
            if (metadataRes.status === 403) {
                throw new Error(`Google Sheets API Error (403): ${errorBody.error?.message || "Permission denied"}`);
            }
            if (metadataRes.status === 404) {
                throw new Error("Spreadsheet not found (404). Check the ID.");
            }
            throw new Error(`Failed to access sheet (Status: ${metadataRes.status})`);
        }

        const metadata = await metadataRes.json();
        const existingSheets: SheetInfo[] = (metadata.sheets || []).map((s: any) => ({
            title: s.properties.title,
            sheetId: s.properties.sheetId
        }));

        // 4. Group Records by Vietnamese Month
        const recordsByMonth = new Map<string, Record[]>();
        records.forEach(r => {
            const key = getVietnameseMonthKey(r.dt_local);
            if (!recordsByMonth.has(key)) recordsByMonth.set(key, []);
            recordsByMonth.get(key)!.push(r);
        });

        // 5. Create Map for Account Labels
        const accountLabelMap = new Map<string, string>();
        allAccounts.forEach(acc => accountLabelMap.set(acc.email, acc.label));

        // 6. Process Each Month
        let totalCount = 0;
        const results = [];

        for (const [monthKey, groupRecords] of recordsByMonth) {
            if (monthKey === 'Unsorted') continue;

            // Find or Create Sheet
            let targetSheet = existingSheets.find(s => s.title === monthKey);

            if (!targetSheet) {
                const addSheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        requests: [{ addSheet: { properties: { title: monthKey } } }]
                    })
                });

                if (!addSheetRes.ok) {
                    console.error(`Failed to create sheet ${monthKey}`);
                    continue;
                }

                const addSheetData = await addSheetRes.json();
                const newSheetProps = addSheetData.replies[0].addSheet.properties;
                targetSheet = { title: newSheetProps.title, sheetId: newSheetProps.sheetId };
                existingSheets.push(targetSheet);
            }

            // Sync to this specific sheet
            try {
                const result = await syncBatchToSpecificSheet(
                    sheetId,
                    targetSheet,
                    groupRecords,
                    accessToken,
                    accountLabelMap
                );
                const syncedCount = typeof result === 'number' ? result : result.count;
                totalCount += syncedCount;
                results.push(`${monthKey}: ${syncedCount} orders synced`);
            } catch (err: any) {
                console.error(`Error syncing sheet ${monthKey}:`, err);
                results.push(`${monthKey}: Failed (${err.message})`);
            }
        }

        return {
            success: true,
            message: `✓ Đồng bộ thành công! ${results.join(' | ')}`
        };

    } catch (error: any) {
        console.error("Google Sheet Sync Error:", error);
        return { success: false, message: error.message };
    }
};
