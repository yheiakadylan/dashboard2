import React, { useState, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { useDashboard } from '../../../contexts/DashboardContext';
import { Record } from '../../../types';
import { getSimilarity } from '../../../utils/stringUtils';
import { FileUp, CheckCircle, AlertCircle, ArrowRight, Loader, Square, CheckSquare } from 'lucide-react';
import { updateRecordsInFirebase } from '../../../services/firebaseService';

interface ImportedRow {
    id: string; // generated local ID
    raw: any;
    // Data to Update
    ffCode: string; // Fulfillment Code from provider (e.g. IP-12345)
    cost: number;
    date: string; // Fulfillment Date

    // Data for Matching
    zip: string;
    name: string;
    address: string;
    product: string; // Product Name or SKU from Provider
    qty: number;

    // Global
    provider: string; // e.g. "InPrnt"
}

interface MatchResult {
    rowId: string;
    recordId: string | null;
    score: number;
    matchType: 'exact' | 'high_confidence' | 'ambiguous' | 'none';
    candidates: { record: Record; score: number; reasons: string[] }[];
    selected: boolean;
    hasExistingCostWarning: boolean;
}

const normalizeStr = (str: string) => {
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/gi, '')
        .trim();
};

const extractAddressNumber = (addr: string) => {
    return addr.match(/\d+/)?.[0] || '';
};

const ManualCostImporter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { records, teamId, setRecords } = useDashboard();
    const [step, setStep] = useState<'upload' | 'mapping' | 'review'>('upload');
    const [importedRows, setImportedRows] = useState<ImportedRow[]>([]);
    const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [columnMapping, setColumnMapping] = useState<{ [key: string]: string }>({});
    const [headers, setHeaders] = useState<string[]>([]);
    const [providerName, setProviderName] = useState('Unknown Fulfillment');

    // Review Filter State
    const [filterTab, setFilterTab] = useState<'all' | 'matched' | 'warnings' | 'unmatched'>('all');

    // --- 1. File Upload & parsing ---
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            await parseFile(e.target.files[0]);
        }
    };

    const parseFile = async (file: File) => {
        setIsProcessing(true);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(arrayBuffer);
            const worksheet = workbook.worksheets[0];

            const fileHeaders: string[] = [];
            const rows: any[] = [];

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) {
                    row.eachCell((cell, colNumber) => {
                        fileHeaders[colNumber] = String(cell.value).trim();
                    });
                } else {
                    const rowData: any = {};
                    row.eachCell((cell, colNumber) => {
                        if (fileHeaders[colNumber]) {
                            let val = cell.value;
                            if (typeof val === 'object' && val !== null && 'text' in val) {
                                val = (val as any).text;
                            } else if (typeof val === 'object' && val !== null && 'result' in val) {
                                val = (val as any).result;
                            }
                            rowData[fileHeaders[colNumber]] = val;
                        }
                    });
                    rows.push(rowData);
                }
            });

            setHeaders(fileHeaders.filter(h => h));

            const mapping: any = {};
            const lower = (s: string) => s.toLowerCase();
            fileHeaders.forEach(h => {
                const lh = lower(h);
                // Matching Fields
                if (lh.includes('zip') || lh.includes('postal')) mapping.zip = h;
                else if ((lh.includes('name') && !lh.includes('product')) || lh.includes('recipient')) mapping.name = h;
                else if (lh.includes('address') || lh.includes('street')) mapping.address = h;
                else if (lh.includes('qty') || lh.includes('quantity')) mapping.qty = h;
                else if (lh.includes('sku') || lh.includes('product') || lh.includes('item')) mapping.product = h;

                // Fields to Import
                else if (lh.includes('fulfillment code') || lh.includes('tracking') || lh.includes('code')) mapping.ffCode = h;
                else if (lh.includes('cost') || lh.includes('amount') || lh.includes('total')) mapping.cost = h;
                else if (lh.includes('date') || lh.includes('created') || lh.includes('fulfill')) mapping.date = h;
            });

            setColumnMapping(mapping);
            setImportedRows(rows.map((r, i) => ({ id: `row-${i}`, raw: r } as ImportedRow)));
            setStep('mapping');
        } catch (error) {
            console.error("Parse error:", error);
            alert("Failed to parse file. Please ensure it's a valid Excel/CSV file.");
        } finally {
            setIsProcessing(false);
        }
    };

    // --- 2. Normalize Data ---
    const applyMapping = () => {
        const normalized: ImportedRow[] = importedRows.map(row => {
            const raw = row.raw;

            // Safe Date Parsing
            let dateStr = new Date().toISOString();
            try {
                const val = raw[columnMapping.date];
                if (val) {
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) {
                        dateStr = d.toISOString();
                    }
                }
            } catch (e) {
                console.warn("Date parse error", e);
            }

            return {
                id: row.id,
                raw,
                ffCode: String(raw[columnMapping.ffCode] || ''),
                date: dateStr,
                zip: String(raw[columnMapping.zip] || '').replace(/\D/g, '').slice(0, 5),
                name: String(raw[columnMapping.name] || ''),
                address: String(raw[columnMapping.address] || ''),
                product: String(raw[columnMapping.product] || ''),
                qty: parseInt(raw[columnMapping.qty] || '1'),
                cost: parseFloat(String(raw[columnMapping.cost]).replace(/[^0-9.]/g, '') || '0'),
                provider: providerName,
            };
        });
        setImportedRows(normalized);
        runMatching(normalized);
    };

    // --- 3. Matching Logic ---
    const runMatching = (rows: ImportedRow[]) => {
        setIsProcessing(true);

        const sortedRows = [...rows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const systemOrders = records.filter(r => r.kind === 'order');

        const results: MatchResult[] = [];
        const usedRecordIds = new Set<string>();

        const getDaysDiff = (d1: Date, d2: Date) => {
            const diffTime = Math.abs(d2.getTime() - d1.getTime());
            return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        };

        sortedRows.forEach(row => {
            const rowDate = new Date(row.date);
            const rowNormName = normalizeStr(row.name);
            const rowAddrNum = extractAddressNumber(row.address);

            // 1. FILTER: Zip + Date
            let candidates = systemOrders.filter(o => {
                if (usedRecordIds.has(o.id!)) return false;

                const oZip = o.details?.shippingAddress?.zip?.replace(/\D/g, '').slice(0, 5);
                // Strict Zip Filter
                if (oZip !== row.zip) return false;

                const oDate = new Date(o.dt_local);
                // Order must be before/on fulfill date
                if (oDate > rowDate) return false;
                // Max buffer 15 days
                const invalidWindow = getDaysDiff(oDate, rowDate) > 15;
                if (invalidWindow) return false;

                return true;
            });

            // 2. SCORING
            const scoredCandidates = candidates.map(record => {
                let score = 0;
                const reasons: string[] = [];

                // Name match (40)
                const recName = record.details?.shippingAddress?.name || '';
                const recNormName = normalizeStr(recName);
                if (recNormName === rowNormName) {
                    score += 40; reasons.push('Name');
                } else if (recNormName.includes(rowNormName) || rowNormName.includes(recNormName)) {
                    score += 35; reasons.push('Name(Partial)');
                } else {
                    const sim = getSimilarity(rowNormName, recNormName);
                    if (sim > 0.8) { score += 30; reasons.push('Name(Fuzzy)'); }
                }

                // Address Number match (20)
                const recAddrNum = extractAddressNumber(record.details?.shippingAddress?.address1 || '');
                if (rowAddrNum && recAddrNum && rowAddrNum === recAddrNum) {
                    score += 20; reasons.push('Addr #');
                }

                // Product/SKU match (30)
                // Search: Does System Product Name or Item Name/SKU contain the File Product String?
                const rowProd = row.product.toLowerCase().trim();
                const sysItems = record.details?.items || [];
                const recordText = [
                    record.product_name,
                    ...sysItems.map(i => i.name),
                    ...sysItems.map(i => i.sku),
                    ...sysItems.map(i => i.variant)
                ].join(' ').toLowerCase();

                if (rowProd && recordText.includes(rowProd)) {
                    score += 30; reasons.push('Product');
                }

                // Qty match (10)
                const sysQty = sysItems.reduce((sum, item) => sum + item.quantity, 0) || 0;
                if (sysQty === row.qty) { score += 10; reasons.push('Qty'); }

                return { record, score, reasons };
            });

            // 3. FIFO Sort
            // Priority: Score > Date Difference
            scoredCandidates.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return new Date(a.record.dt_local).getTime() - new Date(b.record.dt_local).getTime();
            });

            const best = scoredCandidates[0];
            let matchType: MatchResult['matchType'] = 'none';
            let chosen: string | undefined = undefined;
            let hasWarning = false;

            if (best) {
                if (best.score >= 80) matchType = 'exact';
                else if (best.score >= 50) matchType = 'high_confidence';
                else if (best.score >= 30) matchType = 'ambiguous';

                // Threshold to auto-select
                if (best.score >= 40) {
                    chosen = best.record.id;
                    usedRecordIds.add(best.record.id!);
                    if (best.record.cost_total && best.record.cost_total > 0) {
                        // Only warn if cost is DIFFERENT (allow exact re-match to be safe)
                        if (Math.abs(best.record.cost_total - row.cost) > 0.01) {
                            hasWarning = true;
                        }
                    }
                }
            }

            results.push({
                rowId: row.id,
                recordId: chosen || null,
                score: best?.score || 0,
                matchType,
                candidates: scoredCandidates.slice(0, 3),
                selected: !!chosen && !hasWarning, // Do not auto-select if warning exists
                hasExistingCostWarning: hasWarning
            });
        });

        setMatchResults(results);
        setStep('review');
        setIsProcessing(false);
    };

    const handleApply = async () => {
        const toUpdate = matchResults
            .filter(r => r.selected && r.recordId)
            .map(r => {
                const row = importedRows.find(ir => ir.id === r.rowId)!;
                return {
                    id: r.recordId!,
                    cost_total: row.cost,
                    ff_code: row.ffCode,
                    fulfill_provider: row.provider,
                    fulfill_date: row.date,
                };
            });

        if (toUpdate.length === 0) {
            alert("No selected orders to update.");
            return;
        }

        if (!confirm(`Update costs for ${toUpdate.length} orders?`)) return;

        setIsProcessing(true);
        try {
            await updateRecordsInFirebase(teamId, toUpdate);

            // Immediate optimistic update
            setRecords(prevRecords => prevRecords.map(r => {
                const update = toUpdate.find(u => u.id === r.id);
                if (update) {
                    return {
                        ...r,
                        cost_total: update.cost_total,
                        ff_code: update.ff_code,
                        fulfill_provider: update.fulfill_provider,
                        fulfill_date: update.fulfill_date
                    };
                }
                return r;
            }));

            alert("Successfully updated costs!");
            onClose();
        } catch (e) {
            console.error(e);
            alert("Failed to update records.");
        } finally {
            setIsProcessing(false);
        }
    };

    // Review Actions
    const toggleSelect = (rowId: string) => {
        setMatchResults(prev => prev.map(r => r.rowId === rowId ? { ...r, selected: !r.selected } : r));
    };

    const toggleAll = (select: boolean) => {
        setMatchResults(prev => prev.map(r => {
            if (!r.recordId) return { ...r, selected: false };
            const isVisible =
                filterTab === 'all' ? true :
                    filterTab === 'matched' ? (r.recordId && !r.hasExistingCostWarning) :
                        filterTab === 'warnings' ? r.hasExistingCostWarning :
                            (!r.recordId);

            if (isVisible) return { ...r, selected: select };
            return r;
        }));
    };

    const filteredResults = useMemo(() => {
        return matchResults.filter(r => {
            if (filterTab === 'all') return true;
            if (filterTab === 'unmatched') return !r.recordId;
            if (filterTab === 'warnings') return r.hasExistingCostWarning;
            if (filterTab === 'matched') return r.recordId && !r.hasExistingCostWarning;
            return true;
        });
    }, [matchResults, filterTab]);

    // --- UI ---

    if (step === 'upload') {
        return (
            <div className="p-6">
                <h2 className="text-xl font-bold mb-4">Import Fulfillment Costs</h2>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-10 flex flex-col items-center justify-center text-center hover:bg-gray-50 transition relative">
                    <FileUp className="w-12 h-12 text-gray-400 mb-3" />
                    <p className="text-gray-600 mb-2 font-medium">Click to upload Excel/CSV file</p>
                    <p className="text-xs text-gray-400">Supported formats: .xlsx, .csv</p>
                    <input type="file" onChange={handleFileUpload} accept=".xlsx, .xls, .csv" className="absolute opacity-0 w-full h-full cursor-pointer inset-0" />
                </div>
                {isProcessing && <p className="text-center mt-4 text-blue-600">Reading file...</p>}
            </div>
        );
    }

    if (step === 'mapping') {
        return (
            <div className="p-6 h-full flex flex-col">
                <h2 className="text-xl font-bold mb-4">Map Columns</h2>
                <div className="mb-4">
                    <label className="block text-sm font-medium mb-1">Provider Name (required)</label>
                    <input value={providerName} onChange={e => setProviderName(e.target.value)} className="w-full border rounded px-3 py-2" placeholder="e.g. InPrnt, CustomCat" />
                </div>
                {/* Simplified Mapping UI */}
                <div className="grid grid-cols-2 gap-4 overflow-y-auto flex-1">
                    {['ffCode', 'date', 'cost', 'zip', 'name', 'address', 'product', 'qty'].map(field => (
                        <div key={field} className="border p-3 rounded">
                            <label className="block text-sm font-medium capitalize mb-2">{
                                field === 'ffCode' ? 'Fulfillment Code' :
                                    field === 'product' ? 'Product Name/SKU' :
                                        field
                            }</label>
                            <select
                                className="w-full border rounded px-2 py-1 text-sm bg-white"
                                value={columnMapping[field] || ''}
                                onChange={e => setColumnMapping(prev => ({ ...prev, [field]: e.target.value }))}
                            >
                                <option value="">-- Select Column --</option>
                                {headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </div>
                    ))}
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={() => setStep('upload')} className="px-4 py-2 text-gray-600">Back</button>
                    <button onClick={applyMapping} className="px-4 py-2 bg-blue-600 text-white rounded font-medium flex items-center gap-2">
                        Run Matching <ArrowRight size={16} />
                    </button>
                </div>
            </div>
        )
    }

    // Review Step
    const selectedCount = matchResults.filter(r => r.selected).length;

    return (
        <div className="flex flex-col h-full bg-gray-50/50">
            {/* --- Header Toolbar --- */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-30 shadow-sm">
                <div>
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <CheckCircle className="text-blue-600" size={20} />
                        Review Matches
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">Select matches to apply updates. Warnings indicate existing data conflicts.</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        {[
                            { id: 'all', label: 'All', count: matchResults.length, color: 'text-gray-600' },
                            { id: 'matched', label: 'Matched', count: matchResults.filter(r => r.recordId && !r.hasExistingCostWarning).length, color: 'text-green-600' },
                            { id: 'warnings', label: 'Warnings', count: matchResults.filter(r => r.hasExistingCostWarning).length, color: 'text-amber-600' },
                            { id: 'unmatched', label: 'Unmatched', count: matchResults.filter(r => !r.recordId).length, color: 'text-gray-400' },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setFilterTab(tab.id as any)}
                                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${filterTab === tab.id
                                    ? 'bg-white text-blue-600 shadow-sm ring-1 ring-gray-200'
                                    : `${tab.color} hover:bg-gray-200/50`
                                    }`}
                            >
                                {tab.label} <span className="ml-1 opacity-70 bg-gray-200 px-1 rounded-full text-[10px]">{tab.count}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* --- Action Bar --- */}
            <div className="px-6 py-3 bg-white/50 backdrop-blur-sm border-b border-gray-200 flex justify-between items-center z-20">
                <div className="text-sm">
                    <span className="font-medium text-gray-900">{selectedCount}</span> orders selected
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-xs">
                        <button onClick={() => toggleAll(true)} className="text-blue-600 hover:text-blue-700 font-medium hover:underline">Select All</button>
                        <span className="text-gray-300">|</span>
                        <button onClick={() => toggleAll(false)} className="text-gray-500 hover:text-gray-700 hover:underline">Deselect All</button>
                    </div>
                    <button
                        onClick={handleApply}
                        disabled={selectedCount === 0 || isProcessing}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:shadow-none text-sm font-semibold"
                    >
                        {isProcessing ? <Loader className="animate-spin w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                        Apply Update
                    </button>
                </div>
            </div>

            {/* --- Table --- */}
            <div className="flex-1 overflow-auto p-4 md:p-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden ring-1 ring-black/5">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-50/80 text-gray-500 text-xs uppercase font-semibold tracking-wider sticky top-0 z-10 backdrop-blur-md">
                            <tr>
                                <th className="p-4 w-12 text-center border-b">
                                    <div className="sr-only">Select</div>
                                </th>
                                <th className="p-4 border-b w-1/3">Import Data (Source)</th>
                                <th className="p-4 border-b w-1/3">System Match (Target)</th>
                                <th className="p-4 border-b">Changes Preview</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredResults.map((res) => {
                                const row = importedRows.find(r => r.id === res.rowId)!;
                                const matchedRec = res.recordId ? res.candidates.find(c => c.record.id === res.recordId)?.record : null;
                                const isWarning = res.hasExistingCostWarning;
                                const activeClass = res.selected ? 'bg-blue-50/30' : 'hover:bg-gray-50';
                                const warningClass = isWarning ? 'bg-amber-50/40' : '';

                                return (
                                    <tr key={res.rowId} className={`transition-colors duration-150 group ${activeClass} ${warningClass}`}>
                                        {/* Checkbox */}
                                        <td className="p-4 text-center">
                                            <button
                                                onClick={() => toggleSelect(res.rowId)}
                                                className={`transition-all rounded-md p-1 ${res.selected ? 'text-blue-600' : 'text-gray-300 hover:text-gray-400'}`}
                                            >
                                                {res.selected ? <CheckSquare size={20} /> : <Square size={20} />}
                                            </button>
                                        </td>

                                        {/* Import Data */}
                                        <td className="p-4 align-top">
                                            <div className="flex flex-col gap-1">
                                                <span className="font-semibold text-gray-900 text-sm">{row.name}</span>
                                                <div className="text-xs text-gray-500 font-mono">{row.zip} • {row.date.split('T')[0]}</div>
                                                <div className="text-xs text-gray-600 italic truncate max-w-xs" title={row.product}>{row.product}</div>
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-800">
                                                        Qty: {row.qty}
                                                    </span>
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">
                                                        ${row.cost}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* System Match */}
                                        <td className="p-4 align-top border-l border-gray-50">
                                            {matchedRec ? (
                                                <div className="relative">
                                                    {/* Status Badge */}
                                                    {isWarning ? (
                                                        <span className="absolute -top-3 -right-2 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200 shadow-sm flex items-center gap-1">
                                                            <AlertCircle size={10} /> Cost Exists
                                                        </span>
                                                    ) : (
                                                        <span className="absolute -top-3 -right-2 px-1.5 py-0.5 rounded-md bg-green-100 text-green-700 text-[10px] font-bold border border-green-200 shadow-sm flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            Match
                                                        </span>
                                                    )}

                                                    <div className="font-medium text-blue-600 text-sm hover:underline cursor-pointer" title="View Order">{matchedRec.order_id}</div>
                                                    <div className="text-xs text-gray-500 mt-0.5">{matchedRec.details?.customerName || 'Unknown Name'}</div>

                                                    {/* Badge List for Reasons */}
                                                    <div className="flex flex-wrap gap-1 mt-2">
                                                        {res.candidates[0].reasons.map(r => (
                                                            <span key={r} className={`px-1.5 py-0.5 rounded text-[10px] border ${r.includes('Name') ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                                                r.includes('Zip') ? 'bg-indigo-50 text-indigo-700 border-indigo-100' :
                                                                    'bg-gray-50 text-gray-600 border-gray-100'
                                                                }`}>
                                                                {r}
                                                            </span>
                                                        ))}
                                                        <span className="text-[10px] text-gray-400 px-1 pt-1 opacity-70">
                                                            {Math.round(res.score)}%
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="h-full flex items-center justify-center p-4 border-2 border-dashed border-gray-100 rounded-lg">
                                                    <span className="text-xs text-gray-400 italic">No Match Found</span>
                                                </div>
                                            )}
                                        </td>

                                        {/* Changes Preview */}
                                        <td className="p-4 align-top border-l border-gray-50 bg-gray-50/30">
                                            {matchedRec && res.selected ? (
                                                <div className="space-y-2 text-xs">
                                                    {/* Provider Change */}
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-gray-500">Provider</span>
                                                        <div className="flex items-center gap-1.5">
                                                            {matchedRec.fulfill_provider && matchedRec.fulfill_provider !== row.provider ? (
                                                                <>
                                                                    <span className="text-gray-400 line-through decoration-red-400 decoration-2">{matchedRec.fulfill_provider}</span>
                                                                    <ArrowRight size={10} className="text-gray-400" />
                                                                    <span className="font-semibold text-blue-700">{row.provider}</span>
                                                                </>
                                                            ) : (
                                                                <span className="font-medium text-gray-700">{row.provider}</span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Cost Change */}
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-gray-500">Cost</span>
                                                        <div className="flex items-center gap-1.5">
                                                            {matchedRec.cost_total && Math.abs(matchedRec.cost_total - row.cost) > 0.01 ? (
                                                                <>
                                                                    <span className="text-gray-400 line-through text-[10px]">${matchedRec.cost_total}</span>
                                                                    <ArrowRight size={10} className="text-gray-400" />
                                                                    <span className="font-bold text-green-700 decoration-green-200 underline decoration-2">${row.cost}</span>
                                                                </>
                                                            ) : (
                                                                <span className="font-semibold text-gray-900">${row.cost}</span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Date Change */}
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-gray-500">Date</span>
                                                        <div className="flex items-center gap-1.5 text-right">
                                                            {matchedRec.fulfill_date && matchedRec.fulfill_date !== row.date ? (
                                                                <>
                                                                    <span className="text-gray-400 text-[10px]">{matchedRec.fulfill_date.slice(5, 10)}</span>
                                                                    <ArrowRight size={10} className="text-gray-400" />
                                                                </>
                                                            ) : null}
                                                            <span className="font-mono text-gray-700">{row.date.split('T')[0].slice(5, 10)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-gray-400 italic text-xs h-full">
                                                    <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                                                    No selection
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {filteredResults.length === 0 && (
                        <div className="p-12 flex flex-col items-center justify-center text-gray-400">
                            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                                <AlertCircle size={24} className="opacity-20" />
                            </div>
                            <p>No matches found in this filter.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default React.memo(ManualCostImporter);
