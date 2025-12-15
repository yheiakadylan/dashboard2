// utils/imageUtils.ts
// Utility functions for converting product images to high resolution

/**
 * Convert eBay image URLs to higher resolution (800px)
 */
export const convertEbayImageToHighRes = (url: string): string => {
    if (!url || !url.includes('ebay')) return url;

    // Check if it's an eBay render service URL
    if (url.includes('imageser/v1/image/render')) {
        // Replace imgWidth, imgHeight, and length parameters from 276 to 800
        return url
            .replace(/(imgWidth=)\d+/g, '$1800')
            .replace(/(imgHeight=)\d+/g, '$1800')
            .replace(/(length=)\d+/g, '$1800');
    }

    return url;
};

/**
 * Convert product image to high resolution based on platform
 * @param image - Original image URL
 * @returns High resolution image URL
 */
export const getHighResImageUrl = (image: string | null | undefined): string | null => {
    if (!image) return null;

    // Etsy: Replace common small sizes (il_XXxXX) with fullxfull
    if (image.includes('il_') && image.includes('x')) {
        return image.replace(/il_\d+x\w+/, 'il_fullxfull');
    }

    // eBay: Convert to 800px
    if (image.includes('ebay')) {
        return convertEbayImageToHighRes(image);
    }

    // Return original if not Etsy or eBay
    return image;
};
