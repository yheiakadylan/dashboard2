import React from 'react';
import { useCrawler } from '../../contexts/CrawlerContext';

const CrawlerProgressBar: React.FC = () => {
    const { isCrawling, progress } = useCrawler();

    if (!isCrawling) return null;

    return (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg shadow-sm">
            <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-900">
                    Processing: {progress.current} / {progress.total} shops
                </span>
                <span className="text-sm text-blue-700 font-bold">
                    {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%
                </span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2.5 mb-2 overflow-hidden">
                <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                />
            </div>
            <p className="text-sm text-blue-800 font-mono animate-pulse">{progress.status}</p>
        </div>
    );
};

export default React.memo(CrawlerProgressBar);
