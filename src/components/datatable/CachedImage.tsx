import React, { useState, useEffect, useRef } from 'react';
import { getOptimizedImageUrl } from '../../utils/imageUtils';

// Global cache for loaded images to prevent flickering on virtualized list scroll
const imageCache = new Set<string>();

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src: string;
}

const CachedImage: React.FC<CachedImageProps> = ({ src: rawSrc, className, ...props }) => {
    // Optimize URL immediately. Default to 400px width which is good for tables/grids
    const src = getOptimizedImageUrl(rawSrc, 400);

    const [isLoaded, setIsLoaded] = useState(src ? imageCache.has(src) : false);
    const [isInView, setIsInView] = useState(false);
    const imgRef = useRef<HTMLDivElement>(null);

    // Intersection Observer for lazy loading
    useEffect(() => {
        if (!imgRef.current || !src) return;

        // If already in cache, load immediately
        if (imageCache.has(src)) {
            setIsInView(true);
            setIsLoaded(true);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setIsInView(true);
                        observer.disconnect(); // Stop observing once visible
                    }
                });
            },
            {
                rootMargin: '50px', // Load 50px before entering viewport
                threshold: 0.01
            }
        );

        observer.observe(imgRef.current);

        return () => {
            observer.disconnect();
        };
    }, [src]);

    return (
        <div ref={imgRef} className={`relative overflow-hidden ${className}`} style={{ width: props.width, height: props.height }}>
            {!isLoaded && (
                <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-pulse" />
            )}
            {isInView && (
                <img
                    src={src}
                    className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
                    onLoad={() => {
                        if (src) imageCache.add(src);
                        setIsLoaded(true);
                    }}
                    loading="lazy"
                    decoding="async"
                    {...props}
                />
            )}
        </div>
    );
};

export default React.memo(CachedImage);
