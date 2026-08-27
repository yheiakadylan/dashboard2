import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { ProcessedData, TableData, KpiData, TopProduct } from '../types';

export interface ExportProgress {
    stage: 'collecting' | 'downloading' | 'generating' | 'saving';
    stageLabel: string;
    current: number;
    total: number;
    percentage: number;
}

// Helper to resize and compress image for Excel export
const resizeAndCompressImage = async (blob: Blob, maxSize: number = 75): Promise<Blob> => {
    // Try using OffscreenCanvas and createImageBitmap (Modern browsers)
    if (typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
        try {
            const bitmap = await createImageBitmap(blob);

            // Calculate dimensions
            let width = bitmap.width;
            let height = bitmap.height;

            if (width > height) {
                if (width > maxSize) {
                    height = (height * maxSize) / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width = (width * maxSize) / height;
                    height = maxSize;
                }
            }

            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');

            if (ctx) {
                ctx.drawImage(bitmap, 0, 0, width, height);
                // Clean up bitmap
                bitmap.close();

                return await canvas.convertToBlob({
                    type: 'image/jpeg',
                    quality: 0.8
                });
            }
        } catch (e) {
            console.warn('OffscreenCanvas optimization failed, falling back to standard canvas', e);
        }
    }

    // Fallback to standard Image/Canvas
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            URL.revokeObjectURL(url);

            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height = (height * maxSize) / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width = (width * maxSize) / height;
                    height = maxSize;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                    (compressedBlob) => {
                        resolve(compressedBlob || blob);
                    },
                    'image/jpeg',
                    0.8 // 80% quality
                );
            } else {
                resolve(blob);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(blob);
        };

        img.src = url;
    });
};

type ExcelImagePayload = {
    buffer: ArrayBuffer;
    extension: 'jpeg' | 'png' | 'gif';
};

// Cache for image buffers to avoid redundant fetches/processing
const imageBufferCache = new Map<string, ExcelImagePayload>();

const getExcelImageExtension = (mimeType: string): ExcelImagePayload['extension'] => {
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('gif')) return 'gif';
    return 'jpeg';
};

// Helper to fetch image as buffer (using cache)
const fetchImage = async (url: string): Promise<ExcelImagePayload | null> => {
    if (imageBufferCache.has(url)) return imageBufferCache.get(url)!;

    try {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        // Resize to 150px for Excel optimization
        const optimizedBlob = await resizeAndCompressImage(blob, 150);
        const imagePayload: ExcelImagePayload = {
            buffer: await optimizedBlob.arrayBuffer(),
            extension: getExcelImageExtension(optimizedBlob.type)
        };

        imageBufferCache.set(url, imagePayload);
        return imagePayload;
    } catch (error) {
        // Silent fail for export to continue
        return null;
    }
};

// Helper to decode HTML entities
const decodeHTMLEntities = (text: string): string => {
    return text
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
};

const splitSkuParts = (sku: string | undefined | null): [string, string, string] => {
    const cleanSku = String(sku || '').trim();
    if (!cleanSku) return ['', '', ''];

    const [productType = '', staffCode = '', ...restParts] = cleanSku.split('-');
    return [productType.trim(), staffCode.trim(), restParts.join('-').trim()];
};

const roundMoney = (value: number | undefined | null): number => {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
};

const getUniqueSheetName = (rawName: string, usedNames: Set<string>) => {
    const baseName = (rawName.replace(/[:\\/?*[\]]/g, '').slice(0, 31) || 'Sheet').trim() || 'Sheet';
    let sheetName = baseName;
    let suffix = 1;

    while (usedNames.has(sheetName.toLowerCase())) {
        const suffixText = ` ${suffix}`;
        sheetName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
        suffix++;
    }

    usedNames.add(sheetName.toLowerCase());
    return sheetName;
};

const quoteSheetNameForFormula = (sheetName: string) => `'${sheetName.replace(/'/g, "''")}'`;

const isTextLikeColumn = (header?: string) => {
    const normalized = String(header || '').toLowerCase();
    return [
        'sku',
        'name',
        'product',
        'shop',
        'account',
        'variant',
        'source',
        'order',
        'image',
        'currency',
        'curren',
        'ff code',
        'category',
        'date',
        'time',
        'case',
        'help',
        'provider',
        'fulfillment',
    ].some(token => normalized.includes(token));
};

// Helper to clean row data for Excel text
const cleanCellData = (cell: any, useUsdMode: boolean = false, exchangeRates: { [key: string]: number } | null = null, returnSplit: boolean = false, header?: string): any => {
    if (cell === null || cell === undefined) return isTextLikeColumn(header) ? '' : 0;
    if (typeof cell === 'string' && (cell === '---' || cell === '--' || cell.trim() === '')) {
        return isTextLikeColumn(header) ? '' : 0;
    }
    if (typeof cell === 'object') {
        if (cell.type === 'value_with_unit') {
            if (useUsdMode && cell.value !== undefined) {
                const val = typeof cell.value === 'number' ? cell.value : parseFloat(cell.value) || 0;
                return returnSplit ? { main: val, sub: '' } : val;
            }
            const displayVal = cell.display || '';
            const finalVal = (displayVal === '---' || displayVal === '--' || displayVal.trim() === '') ? 0 : decodeHTMLEntities(displayVal);
            return returnSplit ? { main: finalVal, sub: '' } : finalVal;
        }
        if (cell.type === 'image') {
            return cell.src || '';
        }
        if (String(cell.type || '').startsWith('editable_')) return cell.value ?? '';
        if (cell.type === 'button') return decodeHTMLEntities(cell.label || '');
        if (cell.type === 'text_with_subtitle') {
            let totalMain: number | string = 0;
            let totalSub: number | string = 0;

            if (useUsdMode && cell.mainAmountMap && exchangeRates) {
                let m = 0;
                Object.entries(cell.mainAmountMap).forEach(([cur, val]: [string, any]) => {
                    const rate = cur === 'USD' ? 1 : (exchangeRates[cur] || 1);
                    m += (val || 0) * rate;
                });
                totalMain = m;

                if (cell.subtitleAmountMap) {
                    let s = 0;
                    Object.entries(cell.subtitleAmountMap).forEach(([cur, val]: [string, any]) => {
                        const rate = cur === 'USD' ? 1 : (exchangeRates[cur] || 1);
                        s += (val || 0) * rate;
                    });
                    totalSub = s;
                }
            } else {
                totalMain = decodeHTMLEntities(cell.main || '');
                totalSub = decodeHTMLEntities(cell.subtitle || '').replace(/^Refund:\s*/i, '').replace(/[↩\s]/g, '');
            }

            if (returnSplit) {
                return { main: totalMain, sub: totalSub };
            }

            const mainStr = typeof totalMain === 'number' ? `$${totalMain.toFixed(2)}` : totalMain;
            const subStr = totalSub ? (typeof totalSub === 'number' ? `(Refund: $${totalSub.toFixed(2)})` : `(Refund: ${totalSub})`) : '';
            return subStr ? `${mainStr} ${subStr}` : mainStr;
        }

        // Fallback for other objects
        return JSON.stringify(cell);
    }
    // Decode HTML entities for regular strings
    if (typeof cell === 'string') {
        return decodeHTMLEntities(cell);
    }
    return cell;
};

// --- Custom Mapping for Order List ---
const REQUIRED_ORDER_HEADERS = [
    'Order ID', 'Image', 'Product Name', 'Variants', 'Revenue', 'Currency', 'Cost', 'FF Code', 'Case', 'Help', 'Account', 'Datetime', 'Source'
];

const REQUIRED_SUPPORT_HEADERS = [
    'Order Number', 'Type', 'Message/Kind', 'Account', 'Datetime'
];

const remapTableDataForOrders = (originalData: TableData): TableData => {
    const headerMapping: { [target: string]: number } = {};

    originalData.headers.forEach((h, index) => {
        const lowerH = h.toLowerCase();
        if (lowerH.includes('order id') || lowerH === 'id') headerMapping['Order ID'] = index;
        else if (lowerH.includes('image') || lowerH === 'img') headerMapping['Image'] = index;
        else if (lowerH.includes('product') || lowerH.includes('item')) headerMapping['Product Name'] = index;
        else if (lowerH.includes('variant') || lowerH.includes('sku')) headerMapping['Variants'] = index;
        else if (lowerH.includes('revenue') || lowerH.includes('amount') || lowerH.includes('total')) headerMapping['Revenue'] = index;
        else if (lowerH.includes('currency') || lowerH.includes('curren')) headerMapping['Currency'] = index;
        else if (lowerH.includes('cost')) headerMapping['Cost'] = index;
        else if (lowerH.includes('ff code') || lowerH.includes('fulfillment')) headerMapping['FF Code'] = index;
        else if (lowerH.includes('case')) headerMapping['Case'] = index;
        else if (lowerH.includes('help')) headerMapping['Help'] = index;
        else if (lowerH.includes('account') || lowerH.includes('shop')) headerMapping['Account'] = index;
        else if (lowerH.includes('date') || lowerH.includes('time')) headerMapping['Datetime'] = index;
        else if (lowerH.includes('source') || lowerH.includes('platform')) headerMapping['Source'] = index;
    });

    const newRows = originalData.rows.map(row => {
        const remapped = REQUIRED_ORDER_HEADERS.map(header => {
            const index = headerMapping[header];
            if (index !== undefined && index >= 0) {
                return row[index];
            }
            return '';
        });
        // Append refund flag (boolean at the very end of dataProcessing row)
        // Correct index is 16 for orders in current dataProcessing.ts (it's the last element)
        remapped.push(row[row.length - 1]); 
        return remapped;
    });

    return {
        headers: REQUIRED_ORDER_HEADERS,
        rows: newRows
    };
};

const remapTableDataForSupport = (originalData: TableData, type: 'Case' | 'Help'): TableData => {
    const headerMapping: { [target: string]: number } = {};

    originalData.headers.forEach((h, index) => {
        const lowerH = h.toLowerCase();
        if (lowerH.includes('order')) headerMapping['Order Number'] = index;
        else if (lowerH.includes('message') || lowerH.includes('kind')) headerMapping['Message/Kind'] = index;
        else if (lowerH.includes('account')) headerMapping['Account'] = index;
        else if (lowerH.includes('date') || lowerH.includes('time')) headerMapping['Datetime'] = index;
    });

    const newRows = originalData.rows.map(row => {
        return [
            row[headerMapping['Order Number']] || 'N/A',
            type,
            row[headerMapping['Message/Kind']] || '',
            row[headerMapping['Account']] || '',
            row[headerMapping['Datetime']] || ''
        ];
    });

    return {
        headers: REQUIRED_SUPPORT_HEADERS,
        rows: newRows
    };
};

// --- Common Style Helper ---
const styleHeaderRow = (row: ExcelJS.Row) => {
    row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F81BD' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    row.height = 30;
};

const setColumnWidths = (sheet: ExcelJS.Worksheet, headers: string[], imageColIndex: number = -1, includeImages: boolean = false) => {
    sheet.columns.forEach((column, index) => {
        let width = 20;
        const header = headers[index]?.toString().toLowerCase() || '';

        if (includeImages && index === imageColIndex) {
            width = 15;
        } else if (header.includes('name') || header.includes('title') || header.includes('email') || header.includes('product')) {
            width = 40;
        } else if (header.includes('variant') || header.includes('id') || header.includes('code') || header.includes('link')) {
            width = 30;
        } else if (header.includes('date') || header.includes('time')) {
            width = 20;
        } else if (header.includes('case') || header.includes('help')) {
            width = 40;
        } else if (header.length < 10) {
            width = 15;
        }

        column.width = width;
    });
};

const addTableToSheet = async (
    sheet: ExcelJS.Worksheet,
    startRow: number,
    tableData: TableData,
    includeImages: boolean,
    useUsdMode: boolean = false,
    exchangeRates: { [key: string]: number } | null = null,
    onProgress?: (current: number, total: number) => void,
    isOrderList: boolean = false
): Promise<{ nextRow: number }> => {
    // Headers
    const headerRow = sheet.getRow(startRow);
    headerRow.values = tableData.headers;
    styleHeaderRow(headerRow);

    const imageColIndex = tableData.headers.findIndex(h =>
        h.toLowerCase().includes('image') || h.toLowerCase() === 'img' || h === 'Image Link'
    );

    // 1. Fill Text Data First (Fast synchronous op)
    tableData.rows.forEach((row, rIndex) => {
        const currentRow = sheet.getRow(startRow + 1 + rIndex);
        
        // Trimming rows to match header length (+1 if it carries a hidden flag)
        const isRefunded = isOrderList && row[row.length - 1] === true;
        
        const trimmedRow = row.slice(0, tableData.headers.length);
        const cleanRow = trimmedRow.map((cell, cellIndex) => cleanCellData(cell, useUsdMode, exchangeRates, false, tableData.headers[cellIndex]));
        currentRow.values = cleanRow;
        currentRow.height = (includeImages && imageColIndex !== -1) ? 75 : 25;
        currentRow.alignment = { vertical: 'middle', horizontal: 'left' };

        if (isRefunded) {
            currentRow.eachCell((cell) => {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFCCCC' } // Light Red highlight for refunds
                };
                cell.font = { color: { argb: 'FF990000' } };
            });
        }
    });

    // 2. Process Images in Batches (Parallel Fetch -> Sequential Add)
    if (includeImages && imageColIndex !== -1) {
        const imageUrls = tableData.rows.map(row => {
            const cellData = row[imageColIndex];
            if (cellData && typeof cellData === 'object' && 'type' in cellData && cellData.type === 'image' && cellData.src) {
                return cellData.src.startsWith('http') ? cellData.src : null;
            } else if (typeof cellData === 'string' && cellData.startsWith('http')) {
                return cellData;
            }
            return null;
        });

        const CHUNK_SIZE = 20;

        for (let i = 0; i < imageUrls.length; i += CHUNK_SIZE) {
            const chunk = imageUrls.slice(i, i + CHUNK_SIZE);
            const chunkStartIndex = i;
            const images = await Promise.all(
                chunk.map(url => url ? fetchImage(url) : Promise.resolve(null))
            );

            images.forEach((image, idxInChunk) => {
                const globalIdx = chunkStartIndex + idxInChunk;
                if (image) {
                    const imageId = sheet.workbook.addImage({
                        buffer: image.buffer,
                        extension: image.extension,
                    });
                    sheet.addImage(imageId, {
                        tl: { col: imageColIndex, row: startRow + globalIdx } as any,
                        br: { col: imageColIndex + 1, row: startRow + globalIdx + 1 } as any,
                        editAs: 'oneCell'
                    });
                }
                if (onProgress) onProgress(1, -1);
            });
        }
    }

    setColumnWidths(sheet, tableData.headers, imageColIndex, includeImages);

    return {
        nextRow: startRow + 1 + tableData.rows.length
    };
};

const addKpiSection = (sheet: ExcelJS.Worksheet, startRow: number, kpiData: KpiData, useUsdMode: boolean = false, exchangeRates: { [key: string]: number } | null = null): number => {
    let currentCol = 1;
    let currentRow = startRow;
    const cardsPerRow = 5;
    const cardWidth = 2;
    const cardHeight = 5;
    let cardCount = 0;

    const iconColors: { [key: string]: string } = {
        'Total Orders': 'FFDBEAFE',
        'Shops': 'FFFED7AA',
        'Revenue': 'FFD1FAE5',
        'Funds': 'FFF3E8FF',
        'Cost': 'FFFECACA',
        'Earn': 'FFCFFAFE'
    };

    const getKpiUsdValue = (data: { [currency: string]: any }): number => {
        let total = 0;
        Object.entries(data).forEach(([cur, valObj]) => {
            const val = typeof valObj.value === 'string' ? parseFloat(valObj.value.replace(/[$,]/g, '')) || 0 : (valObj.value || 0);
            const rate = cur === 'USD' ? 1 : (exchangeRates?.[cur] || 1);
            total += val * rate;
        });
        return total;
    };

    Object.entries(kpiData).forEach(([key, value]) => {
        if (cardCount > 0 && cardCount % cardsPerRow === 0) {
            currentRow += cardHeight + 1;
            currentCol = 1;
        }

        const startCol = currentCol;
        const endCol = currentCol + cardWidth - 1;

        if (typeof value === 'object' && 'value' in value) {
            const title = key.toUpperCase();
            sheet.mergeCells(currentRow, startCol, currentRow, endCol);
            const headerCell = sheet.getCell(currentRow, startCol);
            headerCell.value = title;
            headerCell.font = { size: 13, color: { argb: 'FF1F2937' }, bold: true };
            headerCell.alignment = { horizontal: 'left', vertical: 'middle' };
            headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: iconColors[key] || 'FFF3F4F6' } };
            sheet.getRow(currentRow).height = 25;

            sheet.mergeCells(currentRow + 1, startCol, currentRow + 1, endCol);
            const valueCell = sheet.getCell(currentRow + 1, startCol);
            const numericValue = typeof (value as any).value === 'string'
                ? parseFloat(((value as any).value as string).replace(/[$,]/g, '')) || (value as any).value
                : (value as any).value;
            valueCell.value = numericValue;
            valueCell.font = { size: 24, bold: true };
            valueCell.alignment = { horizontal: 'left', vertical: 'middle' };
            valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: iconColors[key] || 'FFF3F4F6' } };
            sheet.getRow(currentRow + 1).height = 35;

            // Show Refunds instead of Percentage if available
            sheet.mergeCells(currentRow + 2, startCol, currentRow + 4, endCol);
            const compCell = sheet.getCell(currentRow + 2, startCol);
            
            if (key === 'Total Orders' && (value as any).refundInfo) {
                compCell.value = (value as any).refundInfo;
                compCell.font = { size: 12, color: { argb: 'FFEF4444' }, bold: true, italic: true };
            } else if ((value as any).direction) {
                const arrow = (value as any).direction === 'up' ? '▲' : (value as any).direction === 'down' ? '▼' : '━';
                const percentage = typeof (value as any).change === 'number' && isFinite((value as any).change) 
                    ? `${(value as any).change.toFixed(1)}%` 
                    : 'N/A';
                compCell.value = `${arrow} ${percentage}`;
                compCell.font = { size: 12, color: { argb: 'FFEF4444' }, bold: true };
            } else {
                compCell.value = '';
            }
            compCell.alignment = { horizontal: 'left', vertical: 'middle' };
            compCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: iconColors[key] || 'FFF3F4F6' } };

            for (let r = currentRow; r <= currentRow + cardHeight - 1; r++) {
                for (let c = startCol; c <= endCol; c++) {
                    const cell = sheet.getCell(r, c);
                    cell.border = {
                        top: r === currentRow ? { style: 'medium' } : undefined,
                        left: c === startCol ? { style: 'medium' } : undefined,
                        bottom: r === currentRow + cardHeight - 1 ? { style: 'medium' } : undefined,
                        right: c === endCol ? { style: 'medium' } : undefined
                    };
                }
            }
        } else {
            const title = key.toUpperCase();
            sheet.mergeCells(currentRow, startCol, currentRow, endCol);
            const headerCell = sheet.getCell(currentRow, startCol);
            headerCell.value = title;
            headerCell.font = { size: 13, color: { argb: 'FF1F2937' }, bold: true };
            headerCell.alignment = { horizontal: 'left', vertical: 'middle' };
            headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: iconColors[key] || 'FFF3F4F6' } };
            sheet.getRow(currentRow).height = 22;

            let rowIndex = currentRow + 1;
            if (useUsdMode) {
                const usdTotal = getKpiUsdValue(value);
                sheet.mergeCells(rowIndex, startCol, rowIndex + 3, endCol);
                const valCell = sheet.getCell(rowIndex, startCol);
                valCell.value = usdTotal;
                valCell.font = { size: 24, bold: true };
                valCell.alignment = { horizontal: 'center', vertical: 'middle' };
                valCell.numFmt = '"$"#,##0.00';
                valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: iconColors[key] || 'FFF3F4F6' } };
                rowIndex = currentRow + 5;
            } else {
                Object.entries(value).forEach(([curr, subVal]) => {
                    if (rowIndex > currentRow + 4) return;
                    sheet.mergeCells(rowIndex, startCol, rowIndex, startCol);
                    sheet.mergeCells(rowIndex, startCol + 1, rowIndex, endCol);
                    const currCell = sheet.getCell(rowIndex, startCol);
                    currCell.value = curr;
                    currCell.font = { size: 9, bold: true };
                    currCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: iconColors[key] || 'FFF3F4F6' } };
                    const valCell = sheet.getCell(rowIndex, startCol + 1);
                    const numericValue = typeof (subVal as any).value === 'string'
                        ? parseFloat(((subVal as any).value as string).replace(/[$,]/g, '')) || (subVal as any).value
                        : (subVal as any).value;
                    valCell.value = numericValue;
                    valCell.font = { size: 14, bold: true };
                    valCell.numFmt = '#,##0.00';
                    valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: iconColors[key] || 'FFF3F4F6' } };
                    rowIndex++;
                });
                while (rowIndex <= currentRow + 4) {
                    sheet.mergeCells(rowIndex, startCol, rowIndex, endCol);
                    const emptyCell = sheet.getCell(rowIndex, startCol);
                    emptyCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: iconColors[key] || 'FFF3F4F6' } };
                    rowIndex++;
                }
            }

            for (let r = currentRow; r <= currentRow + cardHeight - 1; r++) {
                for (let c = startCol; c <= endCol; c++) {
                    const cell = sheet.getCell(r, c);
                    cell.border = {
                        top: r === currentRow ? { style: 'medium' } : undefined,
                        left: c === startCol ? { style: 'medium' } : undefined,
                        bottom: r === currentRow + cardHeight - 1 ? { style: 'medium' } : undefined,
                        right: c === endCol ? { style: 'medium' } : undefined
                    };
                }
            }
        }
        currentCol += cardWidth;
        cardCount++;
    });

    const totalColumns = cardsPerRow * cardWidth;
    for (let i = 1; i <= totalColumns; i++) sheet.getColumn(i).width = 18;
    (sheet as any)._kpiTotalColumns = totalColumns;

    return currentRow + cardHeight + 2;
};

const addOverviewSheet = async (workbook: ExcelJS.Workbook, processedData: ProcessedData, useUsdMode: boolean = false, exchangeRates: { [key: string]: number } | null = null) => {
    const sheet = workbook.addWorksheet('Overview');
    let currentRow = 1;
    if (processedData.summary?.kpis) currentRow = addKpiSection(sheet, currentRow, processedData.summary.kpis, useUsdMode, exchangeRates);
    currentRow += 1;

    if (processedData.overview?.table) {
        const kpiTotalColumns = (sheet as any)._kpiTotalColumns || 20;
        sheet.mergeCells(currentRow, 1, currentRow, kpiTotalColumns);
        const titleCell = sheet.getCell(currentRow, 1);
        titleCell.value = 'Daily Breakdown';
        titleCell.font = { bold: true, size: 14 };
        currentRow += 1;

        const detailsIndex = processedData.overview.table.headers.findIndex(h => h.toLowerCase().includes('detail'));
        const filteredTable = detailsIndex !== -1 ? {
            headers: processedData.overview.table.headers.filter((_, i) => i !== detailsIndex),
            rows: processedData.overview.table.rows.map(row => row.filter((_, i) => i !== detailsIndex))
        } : processedData.overview.table;

        const result = await addTableToSheet(sheet, currentRow, filteredTable, false, useUsdMode, exchangeRates);
        currentRow = result.nextRow;
    }
    currentRow += 2;

    if (processedData.summary?.table) {
        const kpiTotalColumns = (sheet as any)._kpiTotalColumns || 20;
        sheet.mergeCells(currentRow, 1, currentRow, kpiTotalColumns);
        const titleCell = sheet.getCell(currentRow, 1);
        titleCell.value = 'Shop Summary';
        titleCell.font = { bold: true, size: 14 };
        currentRow += 1;

        const headerRow = sheet.getRow(currentRow);
        processedData.summary.table.headers.forEach((header, colIndex) => {
            const sc = colIndex * 2 + 1;
            // Headers still merged for consistency or split if you prefer
            sheet.mergeCells(currentRow, sc, currentRow, sc + 1);
            sheet.getCell(currentRow, sc).value = header;
            sheet.getCell(currentRow, sc).alignment = { horizontal: 'center' };
        });
        styleHeaderRow(headerRow);

        processedData.summary.table.rows.forEach((row, rIndex) => {
            const cr = currentRow + 1 + rIndex;
            row.forEach((cell, ci) => {
                const sc = ci * 2 + 1;
                // SPLIT DATA: Main in Left cell, Refund in Right cell
                const data = cleanCellData(cell, useUsdMode, exchangeRates, true);
                
                if (typeof data === 'object' && data !== null && 'main' in data) {
                    const mainCell = sheet.getCell(cr, sc);
                    const subCell = sheet.getCell(cr, sc + 1);
                    
                    mainCell.value = data.main;
                    subCell.value = data.sub || '';
                    
                    if (data.sub) {
                        subCell.font = { color: { argb: 'FF990000' }, bold: true };
                        subCell.alignment = { horizontal: 'center' };
                    }
                    
                    if (typeof data.main === 'number' && useUsdMode && ci > 1) {
                        mainCell.numFmt = '"$"#,##0.00';
                    }
                    if (typeof data.sub === 'number' && useUsdMode && ci > 1) {
                        subCell.numFmt = '"$"#,##0.00';
                    }
                } else {
                    // Regular fallback
                    sheet.mergeCells(cr, sc, cr, sc + 1);
                    sheet.getCell(cr, sc).value = data;
                }
            });
            sheet.getRow(cr).height = 25;
            sheet.getRow(cr).alignment = { vertical: 'middle' };
        });
        currentRow += 1 + processedData.summary.table.rows.length;
    }
};

const addStandardSheet = async (workbook: ExcelJS.Workbook, sheetName: string, tableData: TableData, includeImages: boolean, useUsdMode: boolean = false, exchangeRates: { [key: string]: number } | null = null, onProgress?: (current: number, total: number) => void, isOrderList: boolean = false) => {
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    await addTableToSheet(sheet, 1, tableData, includeImages, useUsdMode, exchangeRates, onProgress, isOrderList);
};

export const exportDashboardToExcel = async (
    processedData: ProcessedData,
    filename: string,
    includeImages: boolean = true,
    useUsdMode: boolean = false,
    exchangeRates: { [key: string]: number } | null = null,
    onProgress?: (progress: ExportProgress) => void
) => {
    const workbook = new ExcelJS.Workbook();
    imageBufferCache.clear();
    let totalImages = 0;
    let downloadedImages = 0;

    const countImages = (tableData: TableData): number => {
        const imageColIndex = tableData.headers.findIndex(h => h.toLowerCase().includes('image') || h.toLowerCase() === 'img' || h === 'Image Link');
        if (imageColIndex === -1) return 0;
        return tableData.rows.filter(row => {
            const cellData = row[imageColIndex];
            if (cellData && typeof cellData === 'object' && 'type' in cellData && cellData.type === 'image' && cellData.src) return cellData.src.startsWith('http');
            return typeof cellData === 'string' && cellData.startsWith('http');
        }).length;
    };

    if (includeImages) {
        if (processedData.orders) totalImages += countImages(remapTableDataForOrders(processedData.orders));
        if (processedData.products) totalImages += countImages(processedData.products);
    }

    const imageProgressCallback = (increment: number) => {
        downloadedImages += increment;
        if (onProgress && totalImages > 0) {
            onProgress({ stage: 'downloading', stageLabel: 'Downloading...', current: downloadedImages, total: totalImages, percentage: Math.round((downloadedImages / totalImages) * 100) });
        }
    };

    if (onProgress && includeImages && totalImages > 0) onProgress({ stage: 'downloading', stageLabel: 'Downloading...', current: 0, total: totalImages, percentage: 0 });

    await addOverviewSheet(workbook, processedData, useUsdMode, exchangeRates);
    const sheetPromises: Promise<void>[] = [];

    if (processedData.orders) sheetPromises.push(addStandardSheet(workbook, 'OrderList', remapTableDataForOrders(processedData.orders), includeImages, useUsdMode, exchangeRates, includeImages ? imageProgressCallback : undefined, true));
    if (processedData.products) sheetPromises.push(addStandardSheet(workbook, 'Product', processedData.products, includeImages, useUsdMode, exchangeRates, includeImages ? imageProgressCallback : undefined));

    const supportRows: any[] = [];
    if (processedData.cases) supportRows.push(...remapTableDataForSupport(processedData.cases, 'Case').rows);
    if (processedData.help) supportRows.push(...remapTableDataForSupport(processedData.help, 'Help').rows);
    if (supportRows.length > 0) {
        // Find Datetime column (usually last index from remapTableDataForSupport)
        const dtIdx = REQUIRED_SUPPORT_HEADERS.indexOf('Datetime');
        supportRows.sort((a, b) => new Date(b[dtIdx]).getTime() - new Date(a[dtIdx]).getTime());
        sheetPromises.push(addStandardSheet(workbook, 'Support', { headers: REQUIRED_SUPPORT_HEADERS, rows: supportRows }, false, useUsdMode, exchangeRates));
    }

    if (processedData.fulfill?.table) sheetPromises.push(addStandardSheet(workbook, 'Fulfill', processedData.fulfill.table, false, useUsdMode, exchangeRates));

    await Promise.all(sheetPromises);
    if (onProgress) onProgress({ stage: 'generating', stageLabel: 'Generating Excel file...', current: 0, total: 100, percentage: 100 });
    const buffer = await workbook.xlsx.writeBuffer();
    if (onProgress) onProgress({ stage: 'saving', stageLabel: 'Saving file...', current: 0, total: 100, percentage: 100 });
    saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
};

export const exportTopProductsToExcel = async (
    summaryData: TopProduct[],
    sheetData: { [key: string]: TopProduct[] },
    filename: string,
    summaryTitle: string = 'Summary'
) => {
    const workbook = new ExcelJS.Workbook();
    workbook.calcProperties.fullCalcOnLoad = true;
    const usedSheetNames = new Set<string>();
    const exportRowForProduct = (product: TopProduct) => {
        const [productType, staffCode, remainingSku] = splitSkuParts(product.sku);
        return [
            productType,
            staffCode,
            remainingSku,
            product.name,
            product.quantity,
            roundMoney(product.revenue),
            product.currency || 'USD',
            product.shop || ''
        ];
    };
    
    // Add Summary Sheet
    const summarySheet = workbook.addWorksheet(getUniqueSheetName(summaryTitle, usedSheetNames));
    const headers = ['Product Type', 'Staff Code', 'SKU', 'Product Name', 'Quantity Sold', 'Revenue', 'Currency', 'Shop'];
    const formulaSourceRows = summaryData.map(exportRowForProduct);
    
    const headerRow = summarySheet.addRow(headers);
    styleHeaderRow(headerRow);
    
    formulaSourceRows.forEach(row => {
        summarySheet.addRow(row);
    });
    
    setColumnWidths(summarySheet, headers);
    summarySheet.getColumn(2).numFmt = '@';
    summarySheet.getColumn(6).numFmt = '#,##0.00';
    
    // Add Detail Sheets
    Object.entries(sheetData).forEach(([sheetName, items]) => {
        const safeName = getUniqueSheetName(sheetName, usedSheetNames);
        const sheet = workbook.addWorksheet(safeName);
        
        const detailHeaderRow = sheet.addRow(headers);
        styleHeaderRow(detailHeaderRow);

        items.forEach(p => {
            const row = exportRowForProduct(p);
            sheet.addRow(row);
        });
        
        setColumnWidths(sheet, headers);
        sheet.getColumn(2).numFmt = '@';
        sheet.getColumn(6).numFmt = '#,##0.00';
    });

    const formulaSourceSheetName = summarySheet.name;
    const staffQuantityResults = new Map<string, number>();
    const staffRevenueResults = new Map<string, number>();

    formulaSourceRows.forEach(row => {
        const staffCode = String(row[1] || '').trim();
        if (!staffCode) return;
        staffQuantityResults.set(staffCode, (staffQuantityResults.get(staffCode) || 0) + Number(row[4] || 0));
        staffRevenueResults.set(staffCode, roundMoney((staffRevenueResults.get(staffCode) || 0) + Number(row[5] || 0)));
    });

    if (staffQuantityResults.size > 0) {
        const staffSheet = workbook.addWorksheet(getUniqueSheetName('Staff Summary', usedSheetNames));
        const staffHeaders = ['Staff Code', 'Quantity Sold', 'Revenue'];
        styleHeaderRow(staffSheet.addRow(staffHeaders));
        const sourceSheetRef = quoteSheetNameForFormula(formulaSourceSheetName);
        const lastSummaryRow = Math.max(2, formulaSourceRows.length + 1);
        const staffCodeRange = `${sourceSheetRef}!$B$2:$B$${lastSummaryRow}`;
        const quantityRange = `${sourceSheetRef}!$E$2:$E$${lastSummaryRow}`;
        const revenueRange = `${sourceSheetRef}!$F$2:$F$${lastSummaryRow}`;

        Array.from(staffQuantityResults.keys()).sort().forEach((staffCode, index) => {
            const rowNumber = index + 2;
            staffSheet.addRow([
                staffCode,
                {
                    formula: `SUMPRODUCT(--(TRIM(${staffCodeRange})=TRIM($A${rowNumber})),${quantityRange})`,
                    result: staffQuantityResults.get(staffCode) || 0
                },
                {
                    formula: `SUMPRODUCT(--(TRIM(${staffCodeRange})=TRIM($A${rowNumber})),${revenueRange})`,
                    result: staffRevenueResults.get(staffCode) || 0
                }
            ]);
        });

        staffSheet.getColumn(1).width = 18;
        staffSheet.getColumn(1).numFmt = '@';
        staffSheet.getColumn(2).width = 18;
        staffSheet.getColumn(3).width = 18;
        staffSheet.getColumn(3).numFmt = '#,##0.00';
    }
    
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
};

/**
 * Exports the Inventory Mapping table as a 2-sheet Excel file.
 * Sheet 1: "By Product"  — one row per product+variant combination
 * Sheet 2: "By Variant"  — aggregated rows grouped by variant type
 */
export const exportInventoryToExcel = async (
    productsData: TableData,
    variantsData: TableData,
    includeImages: boolean = true,
    useUsdMode: boolean = false,
    exchangeRates: { [key: string]: number } | null = null,
    filename: string = 'products_export.xlsx'
): Promise<void> => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VIK Dashboard';
    workbook.created = new Date();

    // Use shared logic for consistent high-quality export
    const pPromise = addStandardSheet(workbook, 'By Product', productsData, includeImages, useUsdMode, exchangeRates);
    const vPromise = addStandardSheet(workbook, 'By Variant', variantsData, false, useUsdMode, exchangeRates);
    
    await Promise.all([pPromise, vPromise]);

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
};
