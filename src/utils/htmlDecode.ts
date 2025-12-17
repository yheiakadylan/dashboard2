// Helper to decode HTML entities
export const decodeHTMLEntities = (text: string | null | undefined): string => {
    if (!text) return '';
    if (typeof text !== 'string') return String(text);

    return text
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
};
