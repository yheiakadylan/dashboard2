import React, { useState, useEffect, useMemo } from 'react';
import { XMarkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { KpiReport, KpiIdea } from '../types';
import { getIdeaTags, addIdeaTags, saveKpiReport } from '../services/kpiService';
import { useNotification } from '../contexts/NotificationContext';
import Spinner from './Spinner';

interface KpiReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    teamId: string;
    userProfile: any; // Using any for now to avoid strict typing issues with user context
    onSuccess?: () => void;
}

const KpiReportModal: React.FC<KpiReportModalProps> = ({ isOpen, onClose, teamId, userProfile, onSuccess }) => {
    const { addNotification } = useNotification();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [customTypes, setCustomTypes] = useState<Record<number, boolean>>({});
    
    // Form State
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [name, setName] = useState(userProfile?.displayName || userProfile?.email?.split('@')[0] || '');
    const [ideas, setIdeas] = useState<KpiIdea[]>([{ type: '', count: 0 }]);
    const [mockup, setMockup] = useState<number | ''>('');
    const [listing, setListing] = useState<number | ''>('');
    const [fulfill, setFulfill] = useState<number | ''>('');
    const [revenue, setRevenue] = useState<number | ''>('');
    const [baseCost, setBaseCost] = useState<number | ''>('');
    const [note, setNote] = useState('');

    // Idea Tags State
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [isLoadingTags, setIsLoadingTags] = useState(false);

    useEffect(() => {
        if (isOpen && teamId) {
            setIsLoadingTags(true);
            getIdeaTags(teamId)
                .then(tags => setAvailableTags(tags))
                .catch(err => console.error("Failed to load idea tags", err))
                .finally(() => setIsLoadingTags(false));
            
            // Reset form completely on open
            setDate(new Date().toISOString().split('T')[0]);
            setName(userProfile?.displayName || userProfile?.email?.split('@')[0] || '');
            setIdeas([{ type: '', count: 0 }]);
            setMockup('');
            setListing('');
            setFulfill('');
            setRevenue('');
            setBaseCost('');
            setNote('');
            setCustomTypes({});
        }
    }, [isOpen, teamId, userProfile]);

    const handleAddIdea = () => setIdeas([...ideas, { type: '', count: 0 }]);
    
    const handleRemoveIdea = (index: number) => {
        const newIdeas = [...ideas];
        newIdeas.splice(index, 1);
        setIdeas(newIdeas.length > 0 ? newIdeas : [{ type: '', count: 0 }]);
    };

    const handleIdeaChange = (index: number, field: keyof KpiIdea, value: string | number) => {
        const newIdeas = [...ideas];
        newIdeas[index] = { ...newIdeas[index], [field]: value };
        
        // Auto-add new row if the last row is being modified and it's not completely empty anymore
        if (index === newIdeas.length - 1 && (newIdeas[index].type !== '' || newIdeas[index].count > 0)) {
            newIdeas.push({ type: '', count: 0 });
        }
        
        setIdeas(newIdeas);
    };

    // Computed Values
    const totalIdeas = useMemo(() => ideas.reduce((sum, idea) => sum + (Number(idea.count) || 0), 0), [ideas]);
    const numRevenue = Number(revenue) || 0;
    const numBaseCost = Number(baseCost) || 0;
    const grossProfit = numRevenue - numBaseCost;
    const profitMargin = numRevenue > 0 ? (grossProfit / numRevenue) * 100 : 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!teamId) return;

        setIsSubmitting(true);
        try {
            // Lọc bỏ những idea trống
            const validIdeas = ideas.filter(i => i.type.trim() !== '' && Number(i.count) > 0);
            
            // Lưu các tag mới
            const newTags = validIdeas.map(i => i.type.trim()).filter(t => !availableTags.includes(t) && !availableTags.includes(t.toLowerCase()));
            if (newTags.length > 0) {
                await addIdeaTags(teamId, newTags);
            }

            const normalizedName = name.trim().toLowerCase().replace(/\s+/g, '-');
            const docId = `report_${date}_${normalizedName}`;

            const report: Omit<KpiReport, 'id'> & { id: string } = {
                id: docId,
                date: new Date(date).toISOString(),
                timestamp: new Date(date).getTime(),
                sellerName: name.trim(),
                ideas: validIdeas.map(i => ({ type: i.type.trim(), count: Number(i.count) })),
                mockup: Number(mockup) || 0,
                listing: Number(listing) || 0,
                fulfill: Number(fulfill) || 0,
                revenue: numRevenue,
                baseCost: numBaseCost,
                grossProfit,
                profitMargin,
                note: note.trim()
            };

            await saveKpiReport(teamId, report);
            addNotification('Report saved successfully', 'success');
            
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error saving report:', error);
            addNotification('Failed to save report', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-scale-in">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Daily KPI Report</h2>
                    <button onClick={onClose} className="p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    <form id="kpi-form" onSubmit={handleSubmit} className="space-y-6">
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
                                <input 
                                    type="date" 
                                    required 
                                    value={date} 
                                    onChange={e => setDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Seller Name</label>
                                <input 
                                    type="text" 
                                    required 
                                    value={name} 
                                    onChange={e => setName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                            </div>
                        </div>

                        {/* IDEAS SECTION */}
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="font-semibold text-gray-800 dark:text-gray-200">Ideas (Total: {totalIdeas})</h3>
                                <button type="button" onClick={handleAddIdea} className="text-sm flex items-center text-blue-600 hover:text-blue-700 dark:text-blue-400">
                                    <PlusIcon className="w-4 h-4 mr-1" /> Add Idea
                                </button>
                            </div>
                            
                            {ideas.map((idea, idx) => (
                                <div key={idx} className="flex gap-2 mb-2 items-center">
                                    <div className="w-24">
                                        <input
                                            type="number"
                                            min="0"
                                            placeholder="Count"
                                            value={idea.count === 0 ? '' : idea.count}
                                            onChange={e => handleIdeaChange(idx, 'count', parseInt(e.target.value) || 0)}
                                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                        />
                                    </div>
                                    <div className="flex-1 relative">
                                        <div className="relative group">
                                            <input
                                                type="text"
                                                placeholder="Select or type new idea..."
                                                value={idea.type}
                                                onChange={e => handleIdeaChange(idx, 'type', e.target.value)}
                                                className="w-full px-3 py-2 pr-8 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 peer"
                                            />
                                            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                            </div>
                                            
                                            {/* Dropdown list (shows on focus of input) */}
                                            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg opacity-0 invisible peer-focus:opacity-100 peer-focus:visible hover:opacity-100 hover:visible transition-all max-h-48 overflow-y-auto">
                                                {availableTags
                                                    .filter(t => t.toLowerCase().includes(idea.type.toLowerCase()))
                                                    .map(t => (
                                                        <div 
                                                            key={t}
                                                            className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer"
                                                            onMouseDown={(e) => {
                                                                e.preventDefault(); // Prevent input blur
                                                                handleIdeaChange(idx, 'type', t);
                                                            }}
                                                        >
                                                            {t}
                                                        </div>
                                                ))}
                                                {idea.type && !availableTags.some(t => t.toLowerCase() === idea.type.toLowerCase()) && (
                                                    <div className="px-3 py-2 text-sm text-blue-600 dark:text-blue-400 font-medium italic border-t border-gray-100 dark:border-gray-600">
                                                        + Add "{idea.type}"
                                                    </div>
                                                )}
                                                {availableTags.length > 0 && availableTags.filter(t => t.toLowerCase().includes(idea.type.toLowerCase())).length === 0 && !idea.type && (
                                                    <div className="px-3 py-2 text-sm text-gray-500 italic">No matches</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={() => handleRemoveIdea(idx)}
                                        className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md"
                                        title="Remove row"
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* OTHER METRICS */}
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mockup</label>
                                <input type="number" min="0" required value={mockup} onChange={e => setMockup(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Listing</label>
                                <input type="number" min="0" required value={listing} onChange={e => setListing(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fulfill</label>
                                <input type="number" min="0" required value={fulfill} onChange={e => setFulfill(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                            </div>
                        </div>

                        {/* FINANCIALS */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Revenue ($)</label>
                                <input type="number" step="0.01" min="0" required value={revenue} onChange={e => setRevenue(e.target.value ? Number(e.target.value) : '')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Base Cost ($)</label>
                                <input type="number" step="0.01" min="0" required value={baseCost} onChange={e => setBaseCost(e.target.value ? Number(e.target.value) : '')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                            </div>
                        </div>

                        {/* READ ONLY COMPUTED */}
                        <div className="grid grid-cols-2 gap-4 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                            <div>
                                <span className="block text-sm text-gray-500 dark:text-gray-400">Gross Profit</span>
                                <span className={`text-lg font-bold ${grossProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    ${grossProfit.toFixed(2)}
                                </span>
                            </div>
                            <div>
                                <span className="block text-sm text-gray-500 dark:text-gray-400">Tỉ lệ LN</span>
                                <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                                    {profitMargin.toFixed(1)}%
                                </span>
                            </div>
                        </div>

                        {/* NOTE */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Note (Optional)</label>
                            <input 
                                type="text" 
                                value={note} 
                                onChange={e => setNote(e.target.value)}
                                placeholder="Add any additional notes here..."
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" 
                            />
                        </div>
                    </form>
                </div>

                <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-800/80 rounded-b-xl">
                    <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors">
                        Cancel
                    </button>
                    <button type="submit" form="kpi-form" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center shadow-md">
                        {isSubmitting ? <Spinner size="sm" color="text-white" /> : 'Save Report'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default KpiReportModal;
