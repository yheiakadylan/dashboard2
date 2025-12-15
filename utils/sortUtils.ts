export type SortDirection = 'asc' | 'desc' | null;

export const compareValues = (a: any, b: any, direction: SortDirection): number => {
    if (direction === null) return 0;

    let valA = a;
    let valB = b;

    // Extract value from complex objects if necessary
    // Note: The caller might need to handle deeply nested extractions, 
    // but for the DataTable use case, we handle the common shapes here 
    // or expect pre-processed values? 
    // To match the existing DataTable logic strictly:
    if (valA && typeof valA === 'object') {
        if ('type' in valA && valA.type === 'button') valA = valA.label;
        else if ('type' in valA && valA.type === 'image') valA = valA.alt;
        else if ('type' in valA && valA.type === 'action_group') valA = '';
        else if ('type' in valA && valA.type === 'value_with_unit') valA = valA.value;
    }
    if (valB && typeof valB === 'object') {
        if ('type' in valB && valB.type === 'button') valB = valB.label;
        else if ('type' in valB && valB.type === 'image') valB = valB.alt;
        else if ('type' in valB && valB.type === 'action_group') valB = '';
        else if ('type' in valB && valB.type === 'value_with_unit') valB = valB.value;
    }

    const isNumericA = typeof valA === 'number';
    const isNumericB = typeof valB === 'number';

    const isValANull = valA === null || valA === undefined;
    const isValBNull = valB === null || valB === undefined;

    if (isValANull && isValBNull) return 0;
    if (isValANull) return direction === 'asc' ? 1 : -1;
    if (isValBNull) return direction === 'asc' ? -1 : 1;

    if (isNumericA && isNumericB) {
        return direction === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    }

    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();

    if (strA < strB) return direction === 'asc' ? -1 : 1;
    if (strA > strB) return direction === 'asc' ? 1 : -1;
    return 0;
};
