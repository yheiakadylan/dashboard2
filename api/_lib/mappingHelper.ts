import { getDb } from './firebaseAdminHelper.js';

interface ProductMapping {
    name: string;
    variant: string;
    category_code: string;
}

/**
 * Normalizes name and variant for consistent matching
 */
function normalize(str: string | undefined): string {
    if (!str) return '';
    return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Applies existing product mappings to a list of records
 */
export async function applyCategoryMappings(teamId: string, records: any[]): Promise<any[]> {
    if (!records || records.length === 0) return records;

    try {
        const db = getDb();
        const mappingsRef = db.collection('user').doc(teamId).collection('product_mappings');
        const mappingsSnapshot = await mappingsRef.get();

        if (mappingsSnapshot.empty) {
            return records;
        }

        const mappings: ProductMapping[] = [];
        mappingsSnapshot.forEach(doc => {
            const data = doc.data();
            mappings.push({
                name: normalize(data.name),
                variant: normalize(data.variant),
                category_code: data.category_code
            });
        });

        // Create a map for faster lookup
        const mappingMap = new Map<string, string>();
        mappings.forEach(m => {
            mappingMap.set(`${m.name}|${m.variant}`, m.category_code);
        });

        const updatedRecords = records.map(record => {
            if (record.kind !== 'order' || !record.details || !record.details.items) {
                return record;
            }

            let recordCategoryCode = record.category_code;

            const updatedItems = record.details.items.map((item: any) => {
                const key = `${normalize(item.name)}|${normalize(item.variant)}`;
                const category_code = mappingMap.get(key);

                if (category_code) {
                    // If the record doesn't have a category code yet, take the first one found
                    if (!recordCategoryCode) recordCategoryCode = category_code;
                    return { ...item, category_code };
                }
                return item;
            });

            return {
                ...record,
                category_code: recordCategoryCode,
                details: {
                    ...record.details,
                    items: updatedItems
                }
            };
        });

        return updatedRecords;
    } catch (error) {
        console.error('[Mapping Helper] Error applying mappings:', error);
        return records; // Return original on error
    }
}
