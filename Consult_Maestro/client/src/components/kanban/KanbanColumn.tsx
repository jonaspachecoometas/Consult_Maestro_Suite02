import { type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";

export interface KanbanColumnDef {
  id: string;
  title: string;
  description?: string;
  color?: string;
}

interface KanbanColumnProps {
  column: KanbanColumnDef;
  count: number;
  children: ReactNode;
  emptyText?: string;
}

export function KanbanColumn({ column, count, children, emptyText = "Vazia" }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border bg-muted/30 min-w-[280px] flex-1 ${
        isOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      }`}
      data-testid={`column-${column.id}`}
    >
      <div className="p-3 border-b">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${column.color ?? "bg-slate-500"}`} />
          <h3 className="text-sm font-semibold" data-testid={`text-column-title-${column.id}`}>
            {column.title}
          </h3>
          <Badge variant="secondary" className="ml-auto text-xs" data-testid={`badge-count-${column.id}`}>
            {count}
          </Badge>
        </div>
        {column.description && (
          <p className="text-[11px] text-muted-foreground mt-1">{column.description}</p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px]">
        {count === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">{emptyText}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
