import React, { useState, useEffect } from 'react';
import { getHighResImageUrl } from '../utils/imageUtils';

interface ImagePreviewModalProps {
    imageUrl: string | null;
    productName?: string;
    onClose: () => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ imageUrl, productName, onClose }) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [highResUrl, setHighResUrl] = useState<string>('');

    // Preload high-res image when modal opens
    useEffect(() => {
        if (!imageUrl) return;

        setImageLoaded(false);
        const url = getHighResImageUrl(imageUrl) || imageUrl;
        setHighResUrl(url);

        // Preload image
        const img = new Image();
        img.src = url;
        img.onload = () => setImageLoaded(true);
        img.onerror = () => setImageLoaded(true); // Still show even if error
    }, [imageUrl]);

    // Lock body scroll when modal is open (important for iOS PWA)
    useEffect(() => {
        if (!imageUrl) return;

        // Save original overflow
        const originalOverflow = document.body.style.overflow;
        const originalPosition = document.body.style.position;

        // Lock scroll
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';

        return () => {
            // Restore original overflow
            document.body.style.overflow = originalOverflow;
            document.body.style.position = originalPosition;
            document.body.style.width = '';
        };
    }, [imageUrl]);

    if (!imageUrl) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-modal-backdrop cursor-pointer"
            style={{
                // iOS PWA safe area support
                paddingTop: 'max(1rem, env(safe-area-inset-top))',
                paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
                paddingLeft: 'max(1rem, env(safe-area-inset-left))',
                paddingRight: 'max(1rem, env(safe-area-inset-right))',
            }}
            onClick={onClose}
            title="Click anywhere to close"
        >
            <div
                className="relative max-w-5xl max-h-[95vh] bg-white dark:bg-gray-800 p-2 rounded-lg shadow-2xl animate-modal-scale"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Loading Spinner */}
                {!imageLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-800 rounded-lg z-10">
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Loading image...</p>
                        </div>
                    </div>
                )}

                {/* High-res Image */}
                {highResUrl && (
                    <img
                        src={highResUrl}
                        alt={productName || 'Product'}
                        className={`max-w-full w-full object-contain rounded transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'
                            }`}
                        style={{
                            // Use dvh (dynamic viewport height) for better iOS handling
                            maxHeight: 'calc(100dvh - max(8rem, env(safe-area-inset-top) + env(safe-area-inset-bottom) + 6rem))',
                        }}
                    />
                )}

                {/* Close Button - Always visible */}
                <button
                    onClick={onClose}
                    className="absolute top-0 right-0 -mt-3 -mr-3 bg-red-500 text-white rounded-full p-2 hover:bg-red-600 active:bg-red-700 shadow-lg transition-colors z-20"
                    title="Close preview"
                    style={{
                        // Ensure button is visible on iOS with notch
                        top: 'max(-0.75rem, calc(env(safe-area-inset-top) - 0.75rem))',
                    }}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Product Name - If provided */}
                {productName && (
                    <div
                        className={`absolute bottom-0 left-0 right-0 p-3 bg-white/90 dark:bg-black/80 backdrop-blur-sm rounded-b-lg transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'
                            }`}
                    >
                        <p
                            className="text-center text-gray-900 dark:text-white font-semibold text-base truncate"
                            title={productName}
                        >
                            {productName}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(ImagePreviewModal);
