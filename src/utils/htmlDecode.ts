// Helper to decode HTML entities
export const decodeHTMLEntities = (text: string | null | undefined): string => {
    if (!text) return '';
    if (typeof text !== 'string') return String(text);

    // Performance optimization: if there are no '&' characters, there are no entities to decode
    if (!text.includes('&')) return text;

    try {
        // Use DOMParser which is standard and extremely fast in modern browsers
        const doc = new DOMParser().parseFromString(text, 'text/html');
        return doc.documentElement.textContent || text;
    } catch (e) {
        // Fallback for any environment without DOMParser or if it fails
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&#x2F;/g, '/')
            .replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
            .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
};
