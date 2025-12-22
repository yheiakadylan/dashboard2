import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { ProcessedData, TableData, KpiData } from '../types';

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

// Cache for image buffers to avoid redundant fetches/processing
const imageBufferCache = new Map<string, ArrayBuffer>();

// Helper to fetch image as buffer (using cache)
const fetchImage = async (url: string): Promise<ArrayBuffer | null> => {
    if (imageBufferCache.has(url)) return imageBufferCache.get(url)!;

    try {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        // Resize to 150px for Excel optimization
        const optimizedBlob = await resizeAndCompressImage(blob, 150);
        const buffer = await optimizedBlob.arrayBuffer();

        imageBufferCache.set(url, buffer);
        return buffer;
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

// Helper to clean row data for Excel text text
const cleanCellData = (cell: any): string | number | null => {
    if (cell === null || cell === undefined) return 0;
    if (typeof cell === 'string' && (cell === '---' || cell === '--' || cell.trim() === '')) return 0;
    if (typeof cell === 'object') {
        if (cell.type === 'value_with_unit') {
            // Check if display value is '---' or empty
            const displayVal = cell.display || '';
            if (displayVal === '---' || displayVal === '--' || displayVal.trim() === '') return 0;
            return decodeHTMLEntities(displayVal);
        }
        if (cell.type === 'image') {
            // Return the image URL so it appears as a clickable link in Excel
            return cell.src || '';
        }
        if (cell.type === 'button') return decodeHTMLEntities(cell.label || '');
        if (cell.type === 'action_group') return '';
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
    // 1. Map required headers to indices in original data
    // We try to find the best match in originalData.headers
    const headerMapping: { [target: string]: number } = {};

    originalData.headers.forEach((h, index) => {
        const lowerH = h.toLowerCase();
        if (lowerH.includes('order id') || lowerH === 'id') headerMapping['Order ID'] = index;
        else if (lowerH.includes('image') || lowerH === 'img') headerMapping['Image'] = index;
        else if (lowerH.includes('product') || lowerH.includes('item')) headerMapping['Product Name'] = index;
        else if (lowerH.includes('variant') || lowerH.includes('sku')) headerMapping['Variants'] = index;
        else if (lowerH.includes('revenue') || lowerH.includes('amount') || lowerH.includes('total')) headerMapping['Revenue'] = index;
        else if (lowerH.includes('currency')) headerMapping['Currency'] = index;
        else if (lowerH.includes('cost')) headerMapping['Cost'] = index;
        else if (lowerH.includes('ff code') || lowerH.includes('fulfillment')) headerMapping['FF Code'] = index;
        else if (lowerH.includes('case')) headerMapping['Case'] = index;
        else if (lowerH.includes('help')) headerMapping['Help'] = index;
        else if (lowerH.includes('account') || lowerH.includes('shop')) headerMapping['Account'] = index;
        else if (lowerH.includes('date') || lowerH.includes('time')) headerMapping['Datetime'] = index;
        else if (lowerH.includes('source') || lowerH.includes('platform')) headerMapping['Source'] = index;
    });

    // 2. Construct new rows
    const newRows = originalData.rows.map(row => {
        return REQUIRED_ORDER_HEADERS.map(header => {
            const index = headerMapping[header];
            if (index !== undefined && index >= 0) {
                return row[index];
            }
            return ''; // Default empty if not found
        });
    });

    return {
        headers: REQUIRED_ORDER_HEADERS,
        rows: newRows
    };
};

const remapTableDataForSupport = (originalData: TableData, type: 'Case' | 'Help'): TableData => {
    // Original headers from dataProcessing:
    // Case: ["Order Number", "Message", "Source", "Account", "DateTime"]
    // Help: ["Order Number", "Help Kind", "Source", "Account", "DateTime"]

    const headerMapping: { [target: string]: number } = {};

    originalData.headers.forEach((h, index) => {
        const lowerH = h.toLowerCase();
        if (lowerH.includes('order')) headerMapping['Order Number'] = index;
        else if (lowerH.includes('message') || lowerH.includes('kind')) headerMapping['Message/Kind'] = index;
        else if (lowerH.includes('source')) headerMapping['Source'] = index;
        else if (lowerH.includes('account')) headerMapping['Account'] = index;
        else if (lowerH.includes('date') || lowerH.includes('time')) headerMapping['Datetime'] = index;
    });

    const newRows = originalData.rows.map(row => {
        return [
            row[headerMapping['Order Number']] || 'N/A',
            type, // Static 'Type' column
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
            fgColor: { argb: 'FF4F81BD' } // Blue header
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
            width = 15; // Set width for image column
        } else if (header.includes('name') || header.includes('title') || header.includes('email') || header.includes('product')) {
            width = 40;
        } else if (header.includes('variant') || header.includes('id') || header.includes('code') || header.includes('link')) {
            width = 30;
        } else if (header.includes('date') || header.includes('time')) {
            width = 20;
        } else if (header.includes('case') || header.includes('help')) {
            width = 40; // Message fields often long
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
    onProgress?: (current: number, total: number) => void
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
        const cleanRow = row.map(cell => cleanCellData(cell));
        currentRow.values = cleanRow;
        currentRow.height = (includeImages && imageColIndex !== -1) ? 75 : 25;
        currentRow.alignment = { vertical: 'middle', horizontal: 'left' };
    });

    // 2. Process Images in Batches (Parallel Fetch -> Sequential Add)
    if (includeImages && imageColIndex !== -1) {
        // Extract all URLs first
        const imageUrls = tableData.rows.map(row => {
            const cellData = row[imageColIndex];
            if (cellData && typeof cellData === 'object' && 'type' in cellData && cellData.type === 'image' && cellData.src) {
                return cellData.src.startsWith('http') ? cellData.src : null;
            } else if (typeof cellData === 'string' && cellData.startsWith('http')) {
                return cellData;
            }
            return null;
        });

        const CHUNK_SIZE = 20; // Concurrency limit

        for (let i = 0; i < imageUrls.length; i += CHUNK_SIZE) {
            const chunk = imageUrls.slice(i, i + CHUNK_SIZE);
            const chunkStartIndex = i;

            // FETCH PHASE (Parallel)
            // We fetch the buffers but don't add to sheet yet
            const buffers = await Promise.all(
                chunk.map(url => url ? fetchImage(url) : Promise.resolve(null))
            );

            // ADD PHASE (Sequential)
            // ExcelJS is safer when adding images sequentially
            buffers.forEach((buffer, idxInChunk) => {
                const globalIdx = chunkStartIndex + idxInChunk;

                if (buffer) {
                    const imageId = sheet.workbook.addImage({
                        buffer: buffer,
                        extension: 'png',
                    });

                    sheet.addImage(imageId, {
                        tl: { col: imageColIndex, row: startRow + globalIdx } as any,
                        br: { col: imageColIndex + 1, row: startRow + globalIdx + 1 } as any,
                        editAs: 'oneCell'
                    });
                }

                // Progress update
                if (onProgress) {
                    onProgress(1, -1);
                }
            });
        }
    }

    // Auto widths
    setColumnWidths(sheet, tableData.headers, imageColIndex, includeImages);

    return {
        nextRow: startRow + 1 + tableData.rows.length
    };
};

const addKpiSection = (sheet: ExcelJS.Worksheet, startRow: number, kpiData: KpiData): number => {
    let currentCol = 1;
    let currentRow = startRow;
    const cardsPerRow = 5; // 5 cards per row
    const cardWidth = 2; // Each card takes 2 columns
    const cardHeight = 5; // Each card takes 5 rows (taller)
    let cardCount = 0;

    // Vibrant icon colors for each KPI type
    const iconColors: { [key: string]: string } = {
        'Total Orders': 'FFDBEAFE', // Light Blue
        'Shops': 'FFFED7AA', // Light Orange
        'Revenue': 'FFD1FAE5', // Light Green
        'Funds': 'FFF3E8FF', // Light Purple
        'Cost': 'FFFECACA' // Light Red
    };

    const iconBorderColors: { [key: string]: string } = {
        'Total Orders': 'FF3B82F6', // Blue
        'Shops': 'FFF97316', // Orange
        'Revenue': 'FF10B981', // Green
        'Funds': 'FFA855F7', // Purple
        'Cost': 'FFEF4444' // Red
    };

    Object.entries(kpiData).forEach(([key, value]) => {
        // Calculate column position (wrap every 5 cards)
        if (cardCount > 0 && cardCount % cardsPerRow === 0) {
            currentRow += cardHeight + 1; // Move to next row with spacing
            currentCol = 1;
        }

        const startCol = currentCol;
        const endCol = currentCol + cardWidth - 1;
        const iconColor = iconColors[key] || 'FF6B7280'; // Default gray

        if (typeof value === 'object' && 'value' in value) {
            // Simple KPI (Total Orders, Shops)
            const title = key.toUpperCase();

            // Row 1: Header (merged)
            sheet.mergeCells(currentRow, startCol, currentRow, endCol);
            const headerCell = sheet.getCell(currentRow, startCol);
            headerCell.value = title;
            headerCell.font = { size: 13, color: { argb: 'FF1F2937' }, bold: true };
            headerCell.alignment = { horizontal: 'left', vertical: 'middle' };
            headerCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: iconColors[key] || 'FFF3F4F6' }
            };
            sheet.getRow(currentRow).height = 25;

            // Row 2: Value (merged)
            sheet.mergeCells(currentRow + 1, startCol, currentRow + 1, endCol);
            const valueCell = sheet.getCell(currentRow + 1, startCol);

            // Extract numeric value (remove $ and commas)
            const numericValue = typeof (value as any).value === 'string'
                ? parseFloat(((value as any).value as string).replace(/[$,]/g, '')) || (value as any).value
                : (value as any).value;

            valueCell.value = numericValue;
            valueCell.font = { size: 24, bold: true };
            valueCell.alignment = { horizontal: 'left', vertical: 'middle' };
            valueCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: iconColors[key] || 'FFF3F4F6' }
            };
            sheet.getRow(currentRow + 1).height = 35;

            // Row 3-5: Comparison indicator if exists (merged)
            if ((value as any).direction) {
                sheet.mergeCells(currentRow + 2, startCol, currentRow + 4, endCol);
                const compCell = sheet.getCell(currentRow + 2, startCol);
                const arrow = (value as any).direction === 'up' ? '▲' : (value as any).direction === 'down' ? '▼' : '━';
                const percentage = typeof (value as any).change === 'number' ? `${(value as any).change.toFixed(1)}%` : '';
                compCell.value = `${arrow} ${percentage}`;
                compCell.font = {
                    size: 12,
                    color: { argb: (value as any).direction === 'up' ? 'FFEF4444' : (value as any).direction === 'down' ? 'FFEF4444' : 'FF6B7280' },
                    bold: true
                };
                compCell.alignment = { horizontal: 'left', vertical: 'middle' };
                compCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: iconColors[key] || 'FFF3F4F6' }
                };
            } else {
                sheet.mergeCells(currentRow + 2, startCol, currentRow + 4, endCol);
                const emptyCell = sheet.getCell(currentRow + 2, startCol);
                emptyCell.value = '';
                emptyCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: iconColors[key] || 'FFF3F4F6' }
                };
            }

            // Add border to card outline only
            for (let r = currentRow; r <= currentRow + cardHeight - 1; r++) {
                for (let c = startCol; c <= endCol; c++) {
                    const cell = sheet.getCell(r, c);
                    const isTop = r === currentRow;
                    const isBottom = r === currentRow + cardHeight - 1;
                    const isLeft = c === startCol;
                    const isRight = c === endCol;

                    cell.border = {
                        top: isTop ? { style: 'medium', color: { argb: 'FF000000' } } : undefined,
                        left: isLeft ? { style: 'medium', color: { argb: 'FF000000' } } : undefined,
                        bottom: isBottom ? { style: 'medium', color: { argb: 'FF000000' } } : undefined,
                        right: isRight ? { style: 'medium', color: { argb: 'FF000000' } } : undefined
                    };
                }
            }

        } else {
            // Nested KPI (Revenue, Funds, Cost with multiple currencies)
            const title = key.toUpperCase();

            // Row 1: Header (merged)
            sheet.mergeCells(currentRow, startCol, currentRow, endCol);
            const headerCell = sheet.getCell(currentRow, startCol);
            headerCell.value = title;
            headerCell.font = { size: 13, color: { argb: 'FF1F2937' }, bold: true };
            headerCell.alignment = { horizontal: 'left', vertical: 'middle' };
            headerCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: iconColors[key] || 'FFF3F4F6' }
            };
            sheet.getRow(currentRow).height = 22;

            // Rows 2-5: Currency values
            let rowIndex = currentRow + 1;
            Object.entries(value).forEach(([curr, subVal], index) => {
                if (rowIndex > currentRow + 4) return; // Max 4 currencies per card

                // Merge columns for each currency row
                sheet.mergeCells(rowIndex, startCol, rowIndex, startCol);
                sheet.mergeCells(rowIndex, startCol + 1, rowIndex, endCol);

                // Currency label
                const currCell = sheet.getCell(rowIndex, startCol);
                currCell.value = curr;
                currCell.font = { size: 9, color: { argb: 'FF6B7280' }, bold: true };
                currCell.alignment = { horizontal: 'left', vertical: 'middle' };
                currCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: iconColors[key] || 'FFF3F4F6' }
                };
                sheet.getRow(rowIndex).height = 20;

                // Value
                const valCell = sheet.getCell(rowIndex, startCol + 1);

                // Extract numeric value (remove $ and commas)
                const numericValue = typeof (subVal as any).value === 'string'
                    ? parseFloat(((subVal as any).value as string).replace(/[$,]/g, '')) || (subVal as any).value
                    : (subVal as any).value;

                valCell.value = numericValue;
                valCell.font = { size: 14, bold: true };
                valCell.alignment = { horizontal: 'right', vertical: 'middle' };
                valCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: iconColors[key] || 'FFF3F4F6' }
                };
                valCell.numFmt = '#,##0.00'; // Number format

                // Comparison indicator if available
                if ((subVal as any).direction) {
                    const arrow = (subVal as any).direction === 'up' ? '▲' : (subVal as any).direction === 'down' ? '▼' : '━';
                    const percentage = typeof (subVal as any).change === 'number' ? `${(subVal as any).change.toFixed(1)}%` : '';
                    valCell.value = `${numericValue}`;
                    valCell.note = `${arrow} ${percentage}`;
                }

                rowIndex++;
            });

            // Fill remaining rows if less than 4 currencies
            while (rowIndex <= currentRow + 4) {
                sheet.mergeCells(rowIndex, startCol, rowIndex, endCol);
                const emptyCell = sheet.getCell(rowIndex, startCol);
                emptyCell.value = '';
                emptyCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: iconColors[key] || 'FFF3F4F6' }
                };
                rowIndex++;
            }

            // Add border to card outline only
            for (let r = currentRow; r <= currentRow + cardHeight - 1; r++) {
                for (let c = startCol; c <= endCol; c++) {
                    const cell = sheet.getCell(r, c);
                    const isTop = r === currentRow;
                    const isBottom = r === currentRow + cardHeight - 1;
                    const isLeft = c === startCol;
                    const isRight = c === endCol;

                    cell.border = {
                        top: isTop ? { style: 'medium', color: { argb: 'FF000000' } } : undefined,
                        left: isLeft ? { style: 'medium', color: { argb: 'FF000000' } } : undefined,
                        bottom: isBottom ? { style: 'medium', color: { argb: 'FF000000' } } : undefined,
                        right: isRight ? { style: 'medium', color: { argb: 'FF000000' } } : undefined
                    };
                }
            }
        }

        currentCol += cardWidth; // Move to next card position (no spacing)
        cardCount++;
    });

    // Set column widths for card layout
    const totalColumns = cardsPerRow * cardWidth;
    for (let i = 1; i <= totalColumns; i++) {
        sheet.getColumn(i).width = 18; // All card columns same width
    }

    // Store total columns for use by tables below
    (sheet as any)._kpiTotalColumns = totalColumns;

    return currentRow + cardHeight + 2; // Return next available row with extra spacing
};


// --- Sheet Builders ---

const addOverviewSheet = async (workbook: ExcelJS.Workbook, processedData: ProcessedData) => {
    const sheet = workbook.addWorksheet('Overview');
    let currentRow = 1;

    // 1. KPIs
    if (processedData.summary?.kpis) {
        currentRow = addKpiSection(sheet, currentRow, processedData.summary.kpis);
    }
    currentRow += 1; // Spacer

    // 2. Daily Breakdown
    if (processedData.overview?.table) {
        // Add Title (merged across KPI width)
        const kpiTotalColumns = (sheet as any)._kpiTotalColumns || 20;
        sheet.mergeCells(currentRow, 1, currentRow, kpiTotalColumns);
        const titleCell = sheet.getCell(currentRow, 1);
        titleCell.value = 'Daily Breakdown';
        titleCell.font = { bold: true, size: 14 };
        titleCell.alignment = { horizontal: 'left' };
        currentRow += 1;

        // Remove "Details" column before export
        const detailsIndex = processedData.overview.table.headers.findIndex(h =>
            h.toLowerCase() === 'details' || h.toLowerCase().includes('detail')
        );
        const filteredTable = detailsIndex !== -1 ? {
            headers: processedData.overview.table.headers.filter((_, i) => i !== detailsIndex),
            rows: processedData.overview.table.rows.map(row => row.filter((_, i) => i !== detailsIndex))
        } : processedData.overview.table;

        const result = await addTableToSheet(sheet, currentRow, filteredTable, false);
        currentRow = result.nextRow;
    }
    currentRow += 2; // Spacer

    // 3. Shop Summary
    if (processedData.summary?.table) {
        // Add Title (merged across KPI width)
        const kpiTotalColumns = (sheet as any)._kpiTotalColumns || 20;
        sheet.mergeCells(currentRow, 1, currentRow, kpiTotalColumns);
        const titleCell = sheet.getCell(currentRow, 1);
        titleCell.value = 'Shop Summary';
        titleCell.font = { bold: true, size: 14 };
        titleCell.alignment = { horizontal: 'left' };
        currentRow += 1;

        // Add header row with merged cells (each header takes 2 columns)
        const headerRow = sheet.getRow(currentRow);
        processedData.summary.table.headers.forEach((header, colIndex) => {
            const startCol = colIndex * 2 + 1;
            const endCol = startCol + 1;
            sheet.mergeCells(currentRow, startCol, currentRow, endCol);
            const cell = sheet.getCell(currentRow, startCol);
            cell.value = header;
        });
        styleHeaderRow(headerRow);

        // Add data rows with merged cells (each cell takes 2 columns)
        processedData.summary.table.rows.forEach((row, rIndex) => {
            const currentDataRow = sheet.getRow(currentRow + 1 + rIndex);
            row.forEach((cell, colIndex) => {
                const startCol = colIndex * 2 + 1;
                const endCol = startCol + 1;
                sheet.mergeCells(currentRow + 1 + rIndex, startCol, currentRow + 1 + rIndex, endCol);
                const mergedCell = sheet.getCell(currentRow + 1 + rIndex, startCol);
                mergedCell.value = cleanCellData(cell);
            });
            currentDataRow.height = 25;
            currentDataRow.alignment = { vertical: 'middle', horizontal: 'left' };
        });

        currentRow = currentRow + 1 + processedData.summary.table.rows.length;
    }
};

const addStandardSheet = async (workbook: ExcelJS.Workbook, sheetName: string, tableData: TableData, includeImages: boolean, onProgress?: (current: number, total: number) => void) => {
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    // This will now wait for image processing inside
    await addTableToSheet(sheet, 1, tableData, includeImages, onProgress);
};

export const exportDashboardToExcel = async (processedData: ProcessedData, filename: string, includeImages: boolean = true, onProgress?: (progress: ExportProgress) => void) => {
    const workbook = new ExcelJS.Workbook();
    // Clear cache at start of new export to avoid memory leaks
    imageBufferCache.clear();
    let totalImages = 0;
    let downloadedImages = 0;

    // Helper to count images in table
    const countImages = (tableData: TableData): number => {
        const imageColIndex = tableData.headers.findIndex(h => h.toLowerCase().includes('image') || h.toLowerCase() === 'img' || h === 'Image Link');
        if (imageColIndex === -1) return 0;
        return tableData.rows.filter(row => {
            const cellData = row[imageColIndex];
            if (cellData && typeof cellData === 'object' && 'type' in cellData && cellData.type === 'image' && cellData.src) {
                return cellData.src.startsWith('http');
            }
            return typeof cellData === 'string' && cellData.startsWith('http');
        }).length;
    };

    // Stage 1: Collecting images (skip if not including images)
    if (includeImages && onProgress) {
        onProgress({ stage: 'collecting', stageLabel: 'Collecting images...', current: 0, total: 100, percentage: 0 });
    }

    // Count total images (only if including images)
    if (includeImages) {
        if (processedData.orders) {
            totalImages += countImages(remapTableDataForOrders(processedData.orders));
        }
        if (processedData.products) {
            totalImages += countImages(processedData.products);
        }
    }

    // Progress callback for image downloads
    // Note: Since we run in parallel, we need to handle concurrency for valid update
    // But basic increments are fine.

    const imageProgressCallback = (increment: number, total: number) => {
        downloadedImages += increment;
        if (onProgress && totalImages > 0) {
            const percentage = Math.round((downloadedImages / totalImages) * 100);
            onProgress({
                stage: 'downloading',
                stageLabel: 'Downloading...',
                current: downloadedImages,
                total: totalImages,
                percentage
            });
        }
    };

    // Stage 2: Start downloading (skip if not including images)
    if (onProgress && includeImages && totalImages > 0) {
        onProgress({ stage: 'downloading', stageLabel: 'Downloading...', current: 0, total: totalImages, percentage: 0 });
    }

    // 1. Overview (KPI, Daily, Shop Summary)
    await addOverviewSheet(workbook, processedData);

    // Prepare sheet promises for parallel execution
    const sheetPromises: Promise<void>[] = [];

    // 2. OrderList (Specific Columns)
    if (processedData.orders) {
        const remappedOrders = remapTableDataForOrders(processedData.orders);
        sheetPromises.push(addStandardSheet(workbook, 'OrderList', remappedOrders, includeImages, includeImages ? imageProgressCallback : undefined));
    }

    // 3. Product
    if (processedData.products) {
        sheetPromises.push(addStandardSheet(workbook, 'Product', processedData.products, includeImages, includeImages ? imageProgressCallback : undefined));
    }

    // 4. Support (Combined Case & Help)
    const supportRows: any[] = [];

    if (processedData.cases) {
        const remappedCases = remapTableDataForSupport(processedData.cases, 'Case');
        supportRows.push(...remappedCases.rows);
    }

    if (processedData.help) {
        const remappedHelp = remapTableDataForSupport(processedData.help, 'Help');
        supportRows.push(...remappedHelp.rows);
    }

    if (supportRows.length > 0) {
        // Sort by Date (Last column usually)
        // Assuming datetime is last index from remapping: REQUIRED_SUPPORT_HEADERS index 5
        const dateIndex = 5;
        supportRows.sort((a, b) => new Date(b[dateIndex]).getTime() - new Date(a[dateIndex]).getTime());

        const supportTableData = {
            headers: REQUIRED_SUPPORT_HEADERS,
            rows: supportRows
        };
        sheetPromises.push(addStandardSheet(workbook, 'Support', supportTableData, false));
    }

    // 6. Fulfill
    if (processedData.fulfill?.table) {
        sheetPromises.push(addStandardSheet(workbook, 'Fulfill', processedData.fulfill.table, false));
    }

    // Run sheet generation in parallel
    await Promise.all(sheetPromises);

    // Stage 3: Generating workbook
    if (onProgress) {
        onProgress({ stage: 'generating', stageLabel: 'Generating Excel file...', current: 0, total: 100, percentage: 100 });
    }

    // Generate
    const buffer = await workbook.xlsx.writeBuffer();

    // Stage 4: Saving file
    if (onProgress) {
        onProgress({ stage: 'saving', stageLabel: 'Saving file...', current: 0, total: 100, percentage: 100 });
    }

    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, filename);
};
