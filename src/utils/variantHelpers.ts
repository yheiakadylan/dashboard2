/**
 * Helper utilities for parsing, cleaning, and normalizing Etsy variant strings.
 * These are moved from dataProcessing.ts to keep the core processing logic clean.
 */

export function removeAccents(str: string): string {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Parses Etsy variant strings like "Size: 8x10, Stand: No" into an array of values.
 * Handles single or double variant patterns and filters out "Preview" junk.
 */
export function parseEtsyVariants(v: string): string[] {
    if (!v) return [];
    const clean = removeAccents(v).trim();
    const isJunk = (s: string) => {
        const lower = s.toLowerCase().trim();
        return lower === 'preview' || lower.includes('preview:');
    };
    
    const firstColon = clean.indexOf(':');
    const lastColon = clean.lastIndexOf(':');
    
    if (firstColon === -1) {
        return isJunk(clean) ? [] : [clean];
    }
    
    const results: string[] = [];
    
    // Exactly one variant (e.g. "Size: 8x10 Inches")
    if (firstColon === lastColon) {
        const label = clean.substring(0, firstColon);
        if (!isJunk(label)) {
            results.push(clean.substring(firstColon + 1).trim());
        }
        return results.filter(Boolean);
    }
    
    // Exactly two variants (Etsy structure: e.g. "Finish: Glossy, Size: 8x10")
    const label1 = clean.substring(0, firstColon);
    const val2 = clean.substring(lastColon + 1).trim();
    const mid = clean.substring(firstColon + 1, lastColon).trim();
    
    const words = mid.split(/\s+/);
    if (words.length <= 1) {
        if (!isJunk(label1)) results.push(mid);
        return results.filter(Boolean);
    }
    
    // Identify if Label 2 is multi-word
    const commonMultiWordPatterns = [
        'material and sizes?', 'hemming options?', 'hanging options?', 
        'display options?', 'hook and gift box(es)?', 'material & effects?',
        'stand options?', 'clip options?', 'base types?', 'clip styles?',
        'clip types?', 'stand selections?', 'gift wraps?', 'neck styles?', 
        'case styles?', 'frame styles?', 'and shapes?', 'backing options?',
        'light styles?', 'led colors?', 'clip types?'
    ];
    
    let labelWordCount = 1;
    for (const pattern of commonMultiWordPatterns) {
        const regex = new RegExp(pattern + '$', 'i');
        const match = mid.match(regex);
        if (match) {
            labelWordCount = match[0].trim().split(/\s+/).length;
            break;
        }
    }
    
    const val1 = words.slice(0, words.length - labelWordCount).join(' ').trim();
    const label2 = words.slice(words.length - labelWordCount).join(' ').trim();
    
    if (!isJunk(label1)) results.push(val1);
    if (!isJunk(label2)) results.push(val2);
    
    return results.filter(Boolean);
}

/**
 * Normalizes a variant string for consistent grouping keys (e.g. "8X10IN" -> "8X10")
 */
export function normalizeVariantForKey(v: string): string {
    if (!v) return 'NOVARIANT';
    const values = parseEtsyVariants(v);
    
    const cleanedValues = values.map(val => {
        let n = removeAccents(val).toLowerCase();
        // Standardize units for grouping
        n = n.replace(/\binches?|(?<=\d)in\b|["']/g, '');
        // Normalize decimals
        n = n.replace(/,/g, '.').replace(/5\.9\d*/g, '6').replace(/7\.8\d*/g, '8').replace(/3\.9\d*/g, '4');
        return n.toUpperCase().replace(/[^A-Z0-9\.]/g, '');
    }).filter(Boolean);
    
    cleanedValues.sort();
    return cleanedValues.join('|') || 'NOVARIANT';
}

/**
 * Formats variant strings for display, standardizing units and Title Case.
 */
export function formatVariantForDisplay(v: string): string {
    if (!v) return 'No Variant';
    const values = parseEtsyVariants(v);
    
    const displayValues = values.map(val => {
        let cleaned = val.trim();
        cleaned = cleaned.replace(/(\d+),(\d+)/g, '$1.$2');
        cleaned = cleaned.replace(/(\d*\.?\d+)\s*["']?\s*[xX]\s*(\d*\.?\d+)\s*["']?/, '$1x$2');
        cleaned = cleaned.replace(/5\.9\d*/g, '6').replace(/7\.8\d*/g, '8').replace(/3\.9\d*/g, '4');

        if (cleaned.toLowerCase().match(/^(no|without)\s*stand$/)) return 'No Stand';
        
        return cleaned.split(/\s+/).map(word => {
            const wordHasUnit = /(inches?|in|["']|'')+$/i.test(word);
            let w = word.replace(/(?<=\d)(inches?|in|["']|'')+$/i, '');
            
            if (w.toLowerCase().match(/^(inches?|in)$/)) return 'Inches';
            if (!w) return ''; 

            if (w.match(/\d+\.?\d*x\d+\.?\d*/i)) return w.toLowerCase() + ' Inches';
            if (wordHasUnit && w.match(/^\d+\.?\d*$/)) return w + ' Inches';
            if (w.toLowerCase().match(/^(xs|s|m|l|xl|xxl|2xl|3xl|4xl|5xl)$/)) return word.toUpperCase();
            
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).filter(Boolean).join(' ');
    }).filter(Boolean);
    
    displayValues.sort();
    let result = displayValues.join(' | ');
    return result.replace(/(Inches\s+)+Inches/g, 'Inches').replace(/\s+/g, ' ').trim() || 'No Variant';
}

/**
 * Aggregation helper to strip personalization text from variants.
 */
export function cleanVariantForAggregation(v: string): string {
    if (!v) return 'No Variant';
    const lowerV = v.toLowerCase();
    const markers = [
        'personalization:', 'personalization', 
        'personalisation:', 'personalisation',
        'personalised:', 'personalised', 
        'personalized:', 'personalized',
        'custom:', 'customization:', 'note to seller', 'text:'
    ];
    let firstIndex = -1;
    markers.forEach(marker => {
        const idx = lowerV.indexOf(marker);
        if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) firstIndex = idx;
    });
    if (firstIndex !== -1) {
        let cleaned = v.substring(0, firstIndex).trim();
        return cleaned.replace(/[,|\-|\||:|/|\\]\s*$/, '').trim() || 'No Variant';
    }
    return v.trim() || 'No Variant';
}
