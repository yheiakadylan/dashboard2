import React, { useState, useEffect } from 'react';
import { X, Tag, FileText, CheckCircle2, AlertCircle } from 'lucide-react';

interface CategoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (category: { code: string, name: string }) => Promise<void>;
    isLoading?: boolean;
}

const CategoryModal: React.FC<CategoryModalProps> = ({ isOpen, onClose, onSave, isLoading }) => {
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setCode('');
            setName('');
            setError('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!code.trim()) {
            setError('Please enter a category code');
            return;
        }
        if (!name.trim()) {
            setError('Please enter a category name');
            return;
        }

        try {
            await onSave({ code: code.toUpperCase().trim(), name: name.trim() });
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to save category');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
            <div
                className="bg-white dark:bg-gray-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="relative h-32 bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center p-6">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                    <div className="text-center">
                        <div className="w-12 h-12 bg-white/20 rounded-xl backdrop-blur-md flex items-center justify-center mx-auto mb-3">
                            <Tag className="text-white" size={24} />
                        </div>
                        <h3 className="text-xl font-bold text-white">Create New Category</h3>
                    </div>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm border border-red-100 dark:border-red-900/30 animate-in slide-in-from-top-1">
                            <AlertCircle size={16} />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5 ml-1">
                            <Tag size={12} />
                            Category Code
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. MUG-11OZ"
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-900 dark:text-white"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            disabled={isLoading}
                            autoFocus
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5 ml-1">
                            <FileText size={12} />
                            Category Name
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. White Mug 11oz"
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-900 dark:text-white"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={isLoading}
                        />
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            disabled={isLoading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-[2] px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <span>Save Category</span>
                                    <CheckCircle2 size={18} className="group-hover:scale-110 transition-transform" />
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CategoryModal;
