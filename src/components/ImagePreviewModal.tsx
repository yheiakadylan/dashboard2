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
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-black/90 backdrop-blur-sm animate-modal-backdrop"
            onClick={onClose}
        >
            {/* Wrapper for Image + Caption + Close Button */}
            <div
                className="relative flex flex-col items-center bg-transparent w-auto h-auto max-w-[95vw] max-h-[95vh] rounded-lg shadow-2xl overflow-visible animate-modal-scale"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Loading Spinner */}
                {!imageLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                        <div className="bg-black/50 p-4 rounded-full backdrop-blur-md">
                            <div className="w-8 h-8 border-2 border-white/80 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    </div>
                )}

                {/* Main Image Container */}
                <div className="relative overflow-hidden rounded-lg bg-black/20 shadow-2xl ring-1 ring-white/10">
                    {highResUrl && (
                        <img
                            src={highResUrl}
                            alt={productName || 'Product'}
                            className={`block w-auto h-auto object-contain transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                            style={{
                                maxWidth: 'min(90vw, 1200px)',
                                maxHeight: '70vh' /* Reduced height as requested */
                            }}
                        />
                    )}
                </div>

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute -top-3 -right-3 md:-top-4 md:-right-4 bg-white text-gray-900 rounded-full p-2 hover:bg-gray-200 shadow-xl border border-gray-200 z-50 transform hover:scale-110 active:scale-95 transition-all"
                    title="Close preview"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5 md:h-6 md:w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Product Name Caption */}
                {productName && (
                    <div className="mt-4 px-6 py-2.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10 shadow-2xl max-w-[80vw]">
                        <p className="text-center text-white font-medium text-sm md:text-base truncate">
                            {productName}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(ImagePreviewModal);
