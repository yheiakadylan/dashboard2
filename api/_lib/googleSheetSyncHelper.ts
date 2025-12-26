// File: api/_lib/googleSheetSyncHelper.ts
/**
 * Server-side Google Sheets sync helper
 * Reusable sync logic for auto-sync API
 */

import { GOOGLE_SHEET_COLUMNS } from '../../src/config/sheetColumns.js';

const TIMEZONE_UTC7 = 'Etc/GMT+7'; // Fixed UTC-7 (no DST)

// Use shared column configuration
const COLUMNS = GOOGLE_SHEET_COLUMNS;

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

// Helper to safely format range with sheet name
const getRange = (sheetName: string, range: string) => {
    const safeName = sheetName.includes(' ') || /[^a-zA-Z0-9]/.test(sheetName)
        ? `'${sheetName}'`
        : sheetName;
    return `${safeName}!${range}`;
};

interface SheetInfo {
    title: string;
    sheetId: number;
}

/**
 * Main sync function
 */
export async function syncRecordsToGoogleSheet(
    spreadsheetId: string,
    records: any[],
    accessToken: string,
    accountLabelMap: Map<string, string>,
    timeZone: string = TIMEZONE_UTC7
): Promise<{ success: boolean; message: string; count: number }> {
    try {
        if (!records.length) {
            return { success: true, message: 'No records to sync.', count: 0 };
        }

        // Fetch Spreadsheet Metadata
        const metadataRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title,sheets.properties.sheetId`,
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

        // Group Records by Vietnamese Month
        const recordsByMonth = new Map<string, any[]>();
        records.forEach(r => {
            const key = getVietnameseMonthKey(r.dt_local);
            if (!recordsByMonth.has(key)) recordsByMonth.set(key, []);
            recordsByMonth.get(key)!.push(r);
        });

        let totalCount = 0;
        const results: string[] = [];

        // Process Each Month
        for (const [monthKey, groupRecords] of recordsByMonth) {
            if (monthKey === 'Unsorted') continue;

            // Find or Create Sheet
            let targetSheet = existingSheets.find(s => s.title === monthKey);

            if (!targetSheet) {
                const addSheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
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
                const syncedCount = await syncBatchToSpecificSheet(
                    spreadsheetId,
                    targetSheet,
                    groupRecords,
                    accessToken,
                    accountLabelMap
                );
                totalCount += syncedCount;
                results.push(`${monthKey}: ${syncedCount} orders synced`);
            } catch (err: any) {
                console.error(`Error syncing sheet ${monthKey}:`, err);
                results.push(`${monthKey}: Failed (${err.message})`);
            }
        }

        return {
            success: true,
            message: `✓ Đồng bộ thành công! ${results.join(' | ')}`,
            count: totalCount
        };

    } catch (error: any) {
        console.error("Google Sheet Sync Error:", error);
        return { success: false, message: error.message, count: 0 };
    }
}

/**
 * Sync batch to specific sheet with INSERT logic
 */
async function syncBatchToSpecificSheet(
    spreadsheetId: string,
    sheetInfo: SheetInfo,
    records: any[],
    accessToken: string,
    accountLabelMap: Map<string, string>
): Promise<number> {
    const { title: sheetName, sheetId: sheetIdNum } = sheetInfo;

    // Read existing data
    const readRange = getRange(sheetName, 'A:ZZ');
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${readRange}?valueRenderOption=FORMULA`;

    const res = await fetch(readUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data = await res.json();
    let allRows: any[][] = data.values || [];

    // Initialize headers if needed
    if (allRows.length === 0) {
        const writeHeaderRange = getRange(sheetName, `A1:${String.fromCharCode(65 + COLUMNS.length - 1)}1`);
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${writeHeaderRange}?valueInputOption=RAW`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: [COLUMNS] })
        });

        // Format headers and column widths for better readability
        const formattingRequests = [
            // Header formatting (blue background, white bold text)
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
            // Date & Time: base 120px + 5px = 125px
            {
                updateDimensionProperties: {
                    range: { sheetId: sheetIdNum, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, // Col F (Date & Time)
                    properties: { pixelSize: 125 },
                    fields: 'pixelSize'
                }
            },
            // Customer Info: 200px (double the default 100px)
            {
                updateDimensionProperties: {
                    range: { sheetId: sheetIdNum, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, // Col I (Customer Info)
                    properties: { pixelSize: 200 },
                    fields: 'pixelSize'
                }
            },
            // Variant: 150px (1.5x the default 100px)
            {
                updateDimensionProperties: {
                    range: { sheetId: sheetIdNum, dimension: 'COLUMNS', startIndex: 13, endIndex: 14 }, // Col N (Variant)
                    properties: { pixelSize: 150 },
                    fields: 'pixelSize'
                }
            }
        ];

        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requests: formattingRequests })
        });

        // Re-read to get headers
        const reReadRes = await fetch(readUrl, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const reReadData = await reReadRes.json();
        allRows = reReadData.values || [];
    }


    const currentHeaders = allRows[0] || [];
    const orderNumIndex = currentHeaders.findIndex(h => h === 'Order ID');

    if (orderNumIndex === -1) {
        throw new Error('Cannot find Order Number column');
    }

    // Filter: Only sync NEW orders
    const existingOrderNumbers = new Set<string>();
    for (let i = 1; i < allRows.length; i++) {
        const orderNum = String(allRows[i][orderNumIndex] || '').trim();
        if (orderNum) existingOrderNumbers.add(orderNum);
    }

    const newRecords = records.filter(r => {
        const orderId = String(r.order_id).trim();
        return !existingOrderNumbers.has(orderId);
    });

    if (newRecords.length === 0) {
        console.log(`[Sync] All orders already exist in ${sheetName}. Skipping.`);
        return 0;
    }

    // Build rows for new records and track merge ranges
    const finalRows: any[][] = [];
    const mergeRanges: Array<{ startRow: number; endRow: number; column: number }> = [];

    newRecords.forEach(record => {
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

        // Track start row for this order
        const orderStartRow = finalRows.length;

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
                if (h.includes('product url') || h === 'link') return '';
                // Mockup
                if (h.includes('mockup')) return mockup ? `=IMAGE("${mockup}"; 4; 200; 200)` : '';
                // Variant (File ff)
                if (h.includes('variant') || h.includes('file ff')) return variant;
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
                return '';
            });

            finalRows.push(row);
        });

        // If order has multiple items, mark cells to merge
        const itemCount = itemsToProcess.length;
        if (itemCount > 1) {
            const orderEndRow = finalRows.length - 1;
            // Columns to merge: Date&Time(5), OrderID(6), Customer(8), Revenue(9), BaseCost(10)
            [5, 6, 8, 9, 10].forEach(colIndex => {
                mergeRanges.push({
                    startRow: orderStartRow,
                    endRow: orderEndRow,
                    column: colIndex
                });
            });
        }
    });

    // Append new rows to sheet
    const startRowIndex = allRows.length;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${getRange(sheetName, `A${startRowIndex + 1}`)}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: finalRows })
    });

    // Merge cells for multi-item orders
    if (mergeRanges.length > 0) {
        const mergeRequests = mergeRanges.map(range => ({
            mergeCells: {
                range: {
                    sheetId: sheetIdNum,
                    startRowIndex: startRowIndex + range.startRow,
                    endRowIndex: startRowIndex + range.endRow + 1, // +1 because end is exclusive
                    startColumnIndex: range.column,
                    endColumnIndex: range.column + 1
                },
                mergeType: 'MERGE_ALL'
            }
        }));

        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requests: mergeRequests })
        });

        console.log(`[Sync] Merged ${mergeRanges.length} cell ranges for multi-item orders`);
    }

    console.log(`[Sync] Added ${finalRows.length} rows to ${sheetName}`);

    return newRecords.length;
}
