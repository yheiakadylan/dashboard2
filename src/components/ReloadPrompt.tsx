import React from 'react';
import { RefreshCw, X, ArrowUpCircle } from 'lucide-react';
import { applyUpdate } from '../services/pwaUpdateService';

interface ReloadPromptProps {
    isOpen: boolean;
    onClose: () => void;
}

const ReloadPrompt: React.FC<ReloadPromptProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    const handleUpdate = async () => {
        try {
            await applyUpdate();
            onClose();
        } catch (error) {
            console.error('Failed to apply update:', error);
            // Fallback to reload if skipWaiting fails
            window.location.reload();
        }
    };

    return (
        <div className="fixed bottom-4 right-4 z-[9999] animate-fade-in-up">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4 max-w-sm w-full">
                <div className="flex items-start gap-4">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-full flex-shrink-0">
                        <ArrowUpCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                            New Update Available
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            A new version of the application is available. Refresh to get the latest features.
                        </p>

                        <div className="flex gap-2">
                            <button
                                onClick={handleUpdate}
                                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded flex items-center justify-center gap-2 transition-colors"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Refresh Now
                            </button>
                            <button
                                onClick={onClose}
                                className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium rounded transition-colors"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReloadPrompt;
