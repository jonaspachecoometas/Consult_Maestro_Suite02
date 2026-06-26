import { type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";

interface KanbanCardProps {
  id: string;
  isDragging?: boolean;
  testId?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function KanbanCard({ id, isDragging, testId, onClick, children, className }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;
  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`cursor-grab active:cursor-grabbing hover-elevate ${isDragging ? "opacity-50" : ""} ${className ?? ""}`}
      data-testid={testId}
    >
      <CardContent className="p-3 space-y-2">{children}</CardContent>
    </Card>
  );
}
