import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { DND_TYPE, type CatalogDragData } from "./dnd-types";
import type { WidgetType } from "@shared/schema";

interface CatalogItemProps {
  metricKey: string;
  label: string;
  description?: string;
  defaultWidget: WidgetType;
}

export function CatalogItem({ metricKey, label, description, defaultWidget }: CatalogItemProps) {
  const data: CatalogDragData = {
    type: DND_TYPE.CATALOG_ITEM,
    metricKey,
    defaultWidget,
    defaultTitle: label,
  };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `catalog-${metricKey}`,
    data,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-start gap-2 p-2 rounded-md border bg-card hover:bg-accent cursor-grab active:cursor-grabbing transition-colors ${
        isDragging ? "opacity-40" : ""
      }`}
      data-testid={`catalog-item-${metricKey}`}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{label}</div>
        {description && (
          <div className="text-[11px] text-muted-foreground line-clamp-2">{description}</div>
        )}
      </div>
    </div>
  );
}
