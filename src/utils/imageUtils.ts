export const getOptimizedImageUrl = (url: string, targetWidth: number = 400): string => {
    if (!url) return '';
    if (!url.includes('ebayimg.com') && !url.includes('svcs.ebay.com')) return url;

    try {
        // Handle "svcs.ebay.com" pattern (Image Service)
        // Optimization: Extract the underlying 'imageUrl' to bypass the heavy proxy
        if (url.includes('svcs.ebay.com')) {
            try {
                // Simple regex to extract imageUrl param (handles encoded URLs too)
                const match = url.match(/[?&]imageUrl=([^&]+)/);
                if (match && match[1]) {
                    const nestedUrl = decodeURIComponent(match[1]);
                    // Recursively optimize the extracted Ebay URL (e.g., i.ebayimg.com...)
                    return getOptimizedImageUrl(nestedUrl, targetWidth);
                }
            } catch (e) {
                // Ignore parsing errors, fall through to fallback
            }

            // Fallback: Check if already has query params and append if missing
            const separator = url.includes('?') ? '&' : '?';
            const extraParams = `width=${targetWidth}&fmt=jpg`;
            if (!url.includes('width=') && !url.includes('fmt=')) {
                return `${url}${separator}${extraParams}`;
            }
            return url;
        }

        // Handle "s-l{size}" pattern (Modern)
        // Use 800px for consistency with preview (perfect cache match)
        const modernPattern = /(s-l)(\d+)(\.[a-zA-Z]+)?/i;
        if (modernPattern.test(url)) {
            // Always use 800px for cache consistency, force .jpg extension
            return url.replace(modernPattern, '$1800.jpg');
        }

        // Handle "$_{id}.JPG" pattern (Legacy)
        // $_12.JPG is ~800px, $_35.JPG is 300px, $_57.JPG is full resolution
        // Using $_12 for consistent 800px across all sizes
        const legacyPattern = /\$_\d+(\.[a-zA-Z]+)?$/;
        if (legacyPattern.test(url)) {
            // Always use $_12 (~800px) for consistency with preview
            return url.replace(legacyPattern, '$_12.JPG');
        }

        return url;
    } catch (e) {
        console.warn('Failed to optimize Ebay URL:', e);
        return url;
    }
};

/**
 * Attempts to get the highest resolution version of an image URL.
 * - Ebay: Converts to 800px (s-l800 or $_12) for perfect cache match with thumbnails
 * - Etsy: Converts thumbnail sizes (il_75x75, il_170x135, etc.) to il_fullxfull
 * Used for zoom/preview features.
 */
export const getHighResImageUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined;

    // Etsy images: Convert thumbnail sizes to full resolution
    // Etsy URLs pattern: il_{size}.{listing_id}_{hash}.jpg
    // Sizes: il_75x75, il_170x135, il_340x270, il_fullxfull
    if (url.includes('etsystatic.com')) {
        // Convert any thumbnail size to fullxfull
        // Pattern matches: il_75x75, il_170x135, il_340x270, etc.
        return url.replace(/il_\d+x\d+/g, 'il_fullxfull');
    }

    // eBay svcs.ebay.com image service: Extract nested imageUrl for better caching
    // This matches the behavior in getOptimizedImageUrl to ensure preview uses same URL as table
    if (url.includes('svcs.ebay.com')) {
        try {
            // Extract the nested imageUrl parameter
            const match = url.match(/[?&]imageUrl=([^&]+)/);
            if (match && match[1]) {
                const nestedUrl = decodeURIComponent(match[1]);
                // Recursively process the extracted eBay image URL
                return getHighResImageUrl(nestedUrl);
            }
        } catch (e) {
            // Fallback: Update parameters if extraction fails
            return url
                .replace(/imgWidth=\d+/g, 'imgWidth=800')
                .replace(/imgHeight=\d+/g, 'imgHeight=800')
                .replace(/length=\d+/g, 'length=800');
        }
    }

    // eBay images only (i.ebayimg.com)
    if (!url.includes('ebayimg.com')) {
        return url;
    }

    try {
        // Handle "s-l{size}" pattern - replace with s-l800 (matches table cache)
        const modernPattern = /(s-l)(\d+)(\.[a-zA-Z]+)?/i;
        if (modernPattern.test(url)) {
            return url.replace(modernPattern, '$1800$3');
        }

        // Handle legacy "$_{id}.JPG" pattern - replace with $_12.JPG (~800px, matches table cache)
        const legacyPattern = /(\$_\d+)(\.[a-zA-Z]+)?$/;
        if (legacyPattern.test(url)) {
            return url.replace(legacyPattern, '$_12.JPG');
        }

        return url;
    } catch (e) {
        return url;
    }
};
