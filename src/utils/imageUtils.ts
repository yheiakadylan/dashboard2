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
        // Regex looks for "s-l" followed by digits, and optionally an extension
        const modernPattern = /(s-l)(\d+)(\.[a-zA-Z]+)?/i;
        if (modernPattern.test(url)) {
            // Replace s-l{oldSize}.{ext} with s-l{targetWidth}.jpg
            // We force .jpg extension to avoid heavy PNGs
            return url.replace(modernPattern, `$1${targetWidth}.jpg`);
        }

        // Handle "$_{id}.JPG" pattern (Legacy)
        // $_57.JPG is standard. $_12.JPG is 500px. $_35.JPG is 300px.
        // If specific width < 400, use $_35 (300px), else $_12 (500px).
        // This is less flexible but covers old/different formats.
        const legacyPattern = /\$_\d+(\.[a-zA-Z]+)?$/;
        if (legacyPattern.test(url)) {
            // 12 is ~500px, 35 is ~300px. 57 is ~1600px/Full
            const sizeCode = targetWidth <= 300 ? '35' : '12';
            return url.replace(legacyPattern, `$_${sizeCode}.JPG`);
        }

        return url;
    } catch (e) {
        console.warn('Failed to optimize Ebay URL:', e);
        return url;
    }
};

/**
 * Attempts to get the highest resolution version of an image URL.
 * - Ebay: Converts to highest resolution (s-l1600 or $_57)
 * - Etsy: Returns unchanged (Etsy URLs are already optimized)
 * Used for zoom/preview features.
 */
export const getHighResImageUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined;

    // Etsy images: Return as-is
    // Etsy URLs like "il_fullxfull.xxx_9x95.jpg" are already optimized
    // DO NOT modify them as it will break the image
    if (url.includes('etsystatic.com')) {
        return url;
    }

    // eBay svcs.ebay.com image service: Update size parameters to 800px
    if (url.includes('svcs.ebay.com')) {
        try {
            // Replace imgWidth, imgHeight, and length parameters with 800
            let highResUrl = url
                .replace(/imgWidth=\d+/g, 'imgWidth=800')
                .replace(/imgHeight=\d+/g, 'imgHeight=800')
                .replace(/length=\d+/g, 'length=800');
            return highResUrl;
        } catch (e) {
            return url;
        }
    }

    // eBay images only (i.ebayimg.com)
    if (!url.includes('ebayimg.com')) {
        return url;
    }

    try {
        // Handle "s-l{size}" pattern - replace with s-l1600
        const modernPattern = /(s-l)(\d+)(\.[a-zA-Z]+)?/i;
        if (modernPattern.test(url)) {
            return url.replace(modernPattern, '$11600$3');
        }

        // Handle legacy "$_{id}.JPG" pattern - replace with $_57.JPG
        const legacyPattern = /(\$_\d+)(\.[a-zA-Z]+)?$/;
        if (legacyPattern.test(url)) {
            return url.replace(legacyPattern, '$_57.JPG');
        }

        return url;
    } catch (e) {
        return url;
    }
};
