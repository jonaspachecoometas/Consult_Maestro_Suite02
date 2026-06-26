import { useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useRef, useState, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { WidgetRenderer } from "./WidgetRenderer";
import { AgentPickerForBi } from "@/components/AgentPickerForBi";
import { DND_TYPE, GRID_COLUMNS, GRID_ROW_HEIGHT_PX } from "./dnd-types";
import type { WidgetConfig } from "@shared/schema";

interface SortableWidgetProps {
  widget: WidgetConfig;
  isEditMode: boolean;
  containerWidth: number;
  onRemove: (id: string) => void;
  onResize: (id: string, w: number, h: number) => void;
  onEdit?: (widget: WidgetConfig) => void;
  isSelected?: boolean;
  onSelect?: () => void;
  onAgentSelected?: (slug: string, name: string, widgetType?: string) => void;
}

export function SortableWidget({
  widget, isEditMode, containerWidth, onRemove, onResize, onEdit,
  isSelected, onSelect, onAgentSelected,
}: SortableWidgetProps) {
  const { attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging } =
    useSortable({
      id: widget.id,
      data: { type: DND_TYPE.WIDGET, widgetId: widget.id },
      disabled: !isEditMode,
    });

  // Drop zone for "combine series" — only on chart widgets.
  const canCombine = widget.type === "bar_chart" || widget.type === "line_chart";
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `combine-${widget.id}`,
    disabled: !isEditMode || !canCombine,
    data: { type: DND_TYPE.WIDGET_COMBINE, widgetId: widget.id },
  });

  const colWidth = containerWidth > 0 ? containerWidth / GRID_COLUMNS : 0;
  const widthPx = colWidth * widget.gridPos.w;
  const heightPx = GRID_ROW_HEIGHT_PX * widget.gridPos.h;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: widthPx > 0 ? `${widthPx}px` : `${(widget.gridPos.w / GRID_COLUMNS) * 100}%`,
    height: `${heightPx}px`,
    opacity: isDragging ? 0.5 : 1,
  };

  // Resize handle
  const [resizing, setResizing] = useState(false);
  const startRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      const dw = colWidth > 0 ? Math.round(dx / colWidth) : 0;
      const dh = Math.round(dy / GRID_ROW_HEIGHT_PX);
      const newW = Math.min(GRID_COLUMNS, Math.max(2, startRef.current.w + dw));
      const newH = Math.min(8, Math.max(2, startRef.current.h + dh));
      if (newW !== widget.gridPos.w || newH !== widget.gridPos.h) {
        onResize(widget.id, newW, newH);
      }
    };
    const onUp = () => {
      setResizing(false);
      startRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing, colWidth, widget.id, widget.gridPos.w, widget.gridPos.h, onResize]);

  return (
    <div
      ref={(el) => { setSortableRef(el); setDropRef(el); }}
      style={style}
      onClick={onSelect}
      className={`relative ${isOver ? "ring-2 ring-primary ring-offset-2 rounded-lg" : ""} ${isSelected ? "ring-2 ring-primary/60 rounded-lg" : ""}`}
      data-testid={`sortable-widget-${widget.id}`}
    >
      {isEditMode && (
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
          {onAgentSelected && (
            <div onClick={(e) => e.stopPropagation()}>
              <AgentPickerForBi
                compact
                activeWidgetType={widget.type}
                onAgentSelected={onAgentSelected}
              />
            </div>
          )}
          <div
            {...attributes}
            {...listeners}
            className="p-1 rounded hover:bg-accent cursor-grab active:cursor-grabbing opacity-50 hover:opacity-100"
            data-testid={`handle-drag-${widget.id}`}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </div>
        </div>
      )}
      <WidgetRenderer widget={widget} isEditMode={isEditMode} onRemove={onRemove} onEdit={onEdit} />
      {isEditMode && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            startRef.current = {
              x: e.clientX, y: e.clientY,
              w: widget.gridPos.w, h: widget.gridPos.h,
            };
            setResizing(true);
          }}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-muted-foreground/30 hover:bg-muted-foreground/60 rounded-tl"
          data-testid={`handle-resize-${widget.id}`}
        />
      )}
    </div>
  );
}
