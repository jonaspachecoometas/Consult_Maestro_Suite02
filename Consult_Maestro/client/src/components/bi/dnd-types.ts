import type { WidgetType } from "@shared/schema";

export const DND_TYPE = {
  CATALOG_ITEM: "catalog_item",
  WIDGET: "widget",
  WIDGET_COMBINE: "widget_combine",
} as const;

export const DEFAULT_GRID_POS: Record<WidgetType, { w: number; h: number }> = {
  kpi_card:    { w: 4, h: 3 },
  bar_chart:   { w: 6, h: 4 },
  line_chart:  { w: 6, h: 4 },
  radar_chart: { w: 4, h: 4 },
  migration_monitor:   { w: 12, h: 5 },
  data_quality_panel:  { w: 12, h: 5 },
};

export const GRID_COLUMNS = 12;
export const GRID_ROW_HEIGHT_PX = 80;

export interface CatalogDragData {
  type: typeof DND_TYPE.CATALOG_ITEM;
  metricKey: string;
  defaultWidget: WidgetType;
  defaultTitle: string;
}
