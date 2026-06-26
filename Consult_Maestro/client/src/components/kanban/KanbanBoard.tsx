import { useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Skeleton } from "@/components/ui/skeleton";
import { KanbanColumn, type KanbanColumnDef } from "./KanbanColumn";

export type KanbanItem = { id: string };

interface KanbanBoardProps<T extends KanbanItem> {
  columns: KanbanColumnDef[];
  items: T[];
  getColumnId: (item: T) => string;
  renderCard: (item: T, opts: { isDragging?: boolean }) => ReactNode;
  onMove?: (item: T, fromColumnId: string, toColumnId: string) => void;
  isLoading?: boolean;
  emptyText?: string;
}

export function KanbanBoard<T extends KanbanItem>({
  columns,
  items,
  getColumnId,
  renderCard,
  onMove,
  isLoading,
  emptyText = "Nenhum item",
}: KanbanBoardProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const grouped = columns.reduce<Record<string, T[]>>((acc, col) => {
    acc[col.id] = [];
    return acc;
  }, {});
  for (const it of items) {
    const col = getColumnId(it);
    if (grouped[col]) grouped[col].push(it);
    else if (grouped[columns[0]?.id]) grouped[columns[0].id].push(it);
  }

  if (isLoading) {
    return (
      <div className="flex gap-4 h-full overflow-x-auto" data-testid="kanban-loading">
        {columns.map((c) => (
          <div key={c.id} className="min-w-[280px] flex-1 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const activeItem = activeId ? items.find((i) => i.id === activeId) ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={(e: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = e;
        if (!over || !onMove) return;
        const item = items.find((i) => i.id === active.id);
        if (!item) return;
        const fromCol = getColumnId(item);
        const toCol = String(over.id);
        if (fromCol === toCol) return;
        onMove(item, fromCol, toCol);
      }}
    >
      <div className="flex gap-4 h-full overflow-x-auto pb-2" data-testid="kanban-board">
        {columns.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            count={grouped[col.id]?.length ?? 0}
            emptyText={emptyText}
          >
            {(grouped[col.id] ?? []).map((item) => renderCard(item, { isDragging: false }))}
          </KanbanColumn>
        ))}
      </div>
      <DragOverlay>{activeItem ? renderCard(activeItem, { isDragging: true }) : null}</DragOverlay>
    </DndContext>
  );
}
