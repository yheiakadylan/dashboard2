import React, { useState, useEffect } from 'react';

// Global cache for loaded images to prevent flickering on virtualized list scroll
const imageCache = new Set<string>();

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src: string;
}

const CachedImage: React.FC<CachedImageProps> = ({ src, className, ...props }) => {
    const [isLoaded, setIsLoaded] = useState(src ? imageCache.has(src) : false);

    useEffect(() => {
        if (src && imageCache.has(src)) {
            setIsLoaded(true);
        }
    }, [src]);

    return (
        <div className={`relative overflow-hidden ${className}`} style={{ width: props.width, height: props.height }}>
            {!isLoaded && (
                <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse" />
            )}
            <img
                src={src}
                className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
                onLoad={() => {
                    if (src) imageCache.add(src);
                    setIsLoaded(true);
                }}
                loading="eager"
                decoding="async"
                {...props}
            />
        </div>
    );
};

export default CachedImage;
