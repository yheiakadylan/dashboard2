import React from 'react';
import { ExportProgress } from '../utils/excelExport';

interface ExportProgressBarProps {
    progress: ExportProgress | null;
}

const ExportProgressBar: React.FC<ExportProgressBarProps> = ({ progress }) => {
    if (!progress) return null;

    const isComplete = progress.percentage === 100;

    return (
        <div className="w-full max-w-xs min-w-[200px] mb-1">
            <div className="flex justify-between items-end mb-1">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate max-w-[70%]">
                    {progress.stageLabel}
                </span>
                <span className={`text-xs font-bold ${isComplete ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>
                    {isComplete ? (
                        <span className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                            100%
                        </span>
                    ) : (
                        `${progress.percentage}%`
                    )}
                </span>
            </div>

            <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden relative">
                <div
                    className={`h-full rounded-full transition-all duration-500 ease-out flex items-center justify-end relative overflow-hidden ${isComplete
                            ? 'bg-green-500'
                            : 'bg-gradient-to-r from-blue-500 to-indigo-600'
                        }`}
                    style={{ width: `${progress.percentage}%` }}
                >
                    {/* Shimmer Effect */}
                    {!isComplete && (
                        <div className="absolute top-0 left-0 bottom-0 right-0 w-full h-full -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/30 to-transparent transform" style={{
                            animation: 'shimmer 2s infinite linear'
                        }}></div>
                    )}

                    {/* CSS for Shimmer Animation manually injected style for this component since we can't edit global css easily */}
                    <style>{`
                        @keyframes shimmer {
                            100% { transform: translateX(100%); }
                        }
                    `}</style>
                </div>
            </div>
        </div>
    );
};

export default ExportProgressBar;
