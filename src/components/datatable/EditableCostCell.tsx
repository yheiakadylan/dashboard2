import React, { useState } from 'react';
import Spinner from '../Spinner';

interface EditableCostCellProps {
    value: number | null;
    recordId: string;
    isManual: boolean;
    onUpdateCost?: (recordId: string, newCost: number | null) => Promise<void>;
}

const EditableCostCell: React.FC<EditableCostCellProps> = ({ value, recordId, isManual, onUpdateCost }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value !== null ? String(value) : '');
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        if (!onUpdateCost) return;
        setIsSaving(true);
        try {
            const parsed = parseFloat(editValue);
            const newCost = isNaN(parsed) ? null : parsed;
            // Prevent save if not changed
            if (newCost === value && editValue !== '') {
                setIsEditing(false);
                return;
            }
            await onUpdateCost(recordId, newCost);
            setIsEditing(false);
        } catch {
            setIsEditing(true);
        } finally {
            setIsSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') {
            setIsEditing(false);
            setEditValue(value !== null ? String(value) : '');
        }
    };

    if (isEditing) {
        return (
            <div className="flex items-center gap-1 w-full relative" onClick={(event) => event.stopPropagation()}>
                <input
                    type="number"
                    step="0.01"
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    disabled={isSaving}
                    className="w-full px-1 py-0.5 text-sm border border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded dark:bg-gray-700 dark:border-gray-500 dark:text-white bg-white dark:bg-gray-800"
                />
                {isSaving && <Spinner size="xs" />}
            </div>
        );
    }

    return (
        <div 
            className="relative flex items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 rounded px-1 -ml-1 py-0.5 w-full h-full group pr-3"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={() => {
                setEditValue(value !== null ? String(value) : '');
                setIsEditing(true);
            }}
            title={isManual ? "Manual cost. Double click to edit." : "Double click to edit cost manually"}
        >
            <span className={`truncate ${isManual ? 'text-blue-600 dark:text-blue-400 font-medium' : ''}`}>
                {value === null || value === 0 
                    ? <span className="text-gray-300 dark:text-gray-600">--</span>
                    : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                }
            </span>
            {isManual && (
                <svg xmlns="http://www.w3.org/2000/svg" className="absolute top-0.5 right-0.5 h-3 w-3 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
            )}
            {!isManual && (
                <svg xmlns="http://www.w3.org/2000/svg" className="absolute top-0.5 right-0.5 h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
            )}
        </div>
    );
};

export default EditableCostCell;
