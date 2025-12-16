import React from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
} from '@dnd-kit/sortable';

import { SortableItem } from './SortableItem';

interface DraggableGridProps {
    items: string[];
    onReorder: (newOrder: string[]) => void;
    renderItem: (id: string) => React.ReactNode;
    wrapperClassName?: string;
}

export const DraggableGrid: React.FC<DraggableGridProps> = ({
    items,
    onReorder,
    renderItem,
    wrapperClassName = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
}) => {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = items.indexOf(active.id as string);
            const newIndex = items.indexOf(over.id as string);

            if (oldIndex !== -1 && newIndex !== -1) {
                onReorder(arrayMove(items, oldIndex, newIndex));
            }
        }
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
        >
            <SortableContext items={items} strategy={rectSortingStrategy}>
                <div className={wrapperClassName}>
                    {items.map((id) => (
                        <SortableItem key={id} id={id}>
                            {renderItem(id)}
                        </SortableItem>
                    ))}
                </div>
            </SortableContext>
        </DndContext>
    );
};
