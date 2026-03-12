import React, { useState, useEffect, useRef } from 'react';
import { X, Tag, FileText, Plus, Trash2, Save, AlertCircle } from 'lucide-react';
import { Category } from '../../types';
import { useNotification } from '../../contexts/NotificationContext';

interface CategoryManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    existingCategories: Category[];
    onSaveAll: (categories: { code: string, name: string, oldCode?: string }[]) => Promise<void>;
    isLoading?: boolean;
}

const CategoryManagementModal: React.FC<CategoryManagementModalProps> = ({
    isOpen,
    onClose,
    existingCategories,
    onSaveAll,
    isLoading
}) => {
    const [localCategories, setLocalCategories] = useState<{ id?: string, code: string, name: string, isNew?: boolean }[]>([]);
    const { addNotification } = useNotification();
    const endOfListRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            setLocalCategories(existingCategories.map(c => ({ ...c, originalCode: c.code })));
        }
    }, [isOpen, existingCategories]);

    if (!isOpen) return null;

    const addRow = () => {
        setLocalCategories([...localCategories, { code: '', name: '', isNew: true }]);
        setTimeout(() => {
            endOfListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 50);
    };

    const removeRow = (index: number) => {
        setLocalCategories(localCategories.filter((_, i) => i !== index));
    };

    const updateRow = (index: number, field: 'code' | 'name', value: string) => {
        const next = [...localCategories];
        next[index] = { ...next[index], [field]: value };
        setLocalCategories(next);
    };

    const handleSave = async () => {
        // Validation
        const invalid = localCategories.some(c => !c.name.trim());
        if (invalid) {
            addNotification('All category names must be filled', 'error');
            return;
        }

        // Check for duplicate names
        const names = localCategories.map(c => c.name.toLowerCase().trim());
        if (new Set(names).size !== names.length) {
            addNotification('Duplicate category names found', 'error');
            return;
        }

        try {
            await onSaveAll(localCategories.map(c => ({
                code: c.name.toUpperCase().replace(/\s+/g, '_').trim(),
                name: c.name.trim(),
                oldCode: (c as any).originalCode
            })));
            onClose();
        } catch (err: any) {
            addNotification(err.message || 'Failed to save categories', 'error');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[100] p-4 animate-modal-backdrop" onClick={onClose}>
            <div
                className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] border border-gray-200 dark:border-gray-700 animate-modal-scale"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Manage Categories</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Configure product categories for statistics</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body - Scrollable List */}
                <div className="flex-1 overflow-y-auto p-5">
                    <div className="space-y-2">
                        {localCategories.length === 0 ? (
                            <div className="text-center py-12 text-gray-400">
                                <Tag size={40} className="mx-auto mb-3 opacity-20" />
                                <p className="text-sm">No categories defined yet.</p>
                            </div>
                        ) : (
                            localCategories.map((cat, idx) => (
                                <div key={idx} className="flex gap-3 items-center animate-in fade-in duration-200">
                                    <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Category Name</label>
                                            <input
                                                type="text"
                                                className="w-full bg-transparent font-semibold text-sm text-gray-900 dark:text-white outline-none"
                                                placeholder="Enter category name (e.g. Mug, T-Shirt...)"
                                                value={cat.name}
                                                onChange={(e) => updateRow(idx, 'name', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeRow(idx)}
                                        className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                        title="Remove"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))
                        )}
                        <div ref={endOfListRef} />
                    </div>
                </div>

                <div className="flex-shrink-0 p-5 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
                    <button
                        onClick={addRow}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                    >
                        <Plus size={18} />
                        <span>Add Category</span>
                    </button>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            disabled={isLoading}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50 transition-all"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Save size={16} />
                                    <span>Save Changes</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CategoryManagementModal;
