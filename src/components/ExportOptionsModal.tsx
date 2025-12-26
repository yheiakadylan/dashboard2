import React, { useState } from 'react';

interface ExportOptionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onExport: (includeImages: boolean) => void;
}

const ExportOptionsModal: React.FC<ExportOptionsModalProps> = ({ isOpen, onClose, onExport }) => {
    const [selectedOption, setSelectedOption] = useState<'images' | 'links'>('links');

    if (!isOpen) return null;

    const handleExport = () => {
        onExport(selectedOption === 'images');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Export Options</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Choose how to export your data</p>
                </div>

                {/* Body */}
                <div className="px-6 py-6 space-y-4">
                    {/* Option 1: Links Only */}
                    <label
                        className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${selectedOption === 'links'
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                    >
                        <input
                            type="radio"
                            name="exportOption"
                            value="links"
                            checked={selectedOption === 'links'}
                            onChange={() => setSelectedOption('links')}
                            className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <div className="ml-3 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-gray-900 dark:text-white">Links Only</span>
                                <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                                    Recommended
                                </span>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                Include image URLs only. Much faster export and smaller file size.
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-500">
                                <span className="flex items-center gap-1">
                                    <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    Fast export
                                </span>
                                <span className="flex items-center gap-1">
                                    <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                    </svg>
                                    Small file
                                </span>
                            </div>
                        </div>
                    </label>

                    {/* Option 2: Include Images */}
                    <label
                        className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${selectedOption === 'images'
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                    >
                        <input
                            type="radio"
                            name="exportOption"
                            value="images"
                            checked={selectedOption === 'images'}
                            onChange={() => setSelectedOption('images')}
                            className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <div className="ml-3 flex-1">
                            <span className="font-semibold text-gray-900 dark:text-white">Include Images</span>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                Embed all images in Excel. Slower export and larger file size.
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-500">
                                <span className="flex items-center gap-1">
                                    <svg className="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Slower export
                                </span>
                                <span className="flex items-center gap-1">
                                    <svg className="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                    </svg>
                                    Large file
                                </span>
                            </div>
                        </div>
                    </label>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 dark:hover:bg-gray-500 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleExport}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Export
                    </button>
                </div>
            </div>
        </div>
    );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(ExportOptionsModal);
