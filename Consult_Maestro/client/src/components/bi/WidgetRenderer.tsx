import { useWidgetData } from "./useWidgetData";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MigrationMonitorWidget } from "./MigrationMonitorWidget";
import { DataQualityPanelWidget } from "./DataQualityPanelWidget";
import {
  BarChart, Bar, LineChart, Line, RadarChart, Radar,
  AreaChart, Area, PieChart, Pie, Cell, ComposedChart,
  RadialBarChart, RadialBar, ScatterChart, Scatter,
  PolarGrid, PolarAngleAxis, ResponsiveContainer,
  XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { Pencil } from "lucide-react";
import type { WidgetConfig } from "@shared/schema";

const DEFAULT_COLORS = ["#5B4FD4", "#1D9E75", "#BA7517", "#D85A30", "#185FA5"];

interface WidgetRendererProps {
  widget: WidgetConfig;
  isEditMode?: boolean;
  onRemove?: (id: string) => void;
  onEdit?: (widget: WidgetConfig) => void;
  publicToken?: string;
}

/**
 * Top-level dispatcher. Each branch returns a different component, so
 * React mounts/unmounts cleanly and hooks are always called in a stable
 * order **inside** each child component (no conditional hook calls).
 */
export function WidgetRenderer(props: WidgetRendererProps) {
  const { widget } = props;
  if (widget.type === "migration_monitor") {
    return (
      <MigrationMonitorWidget
        widget={widget}
        isEditMode={props.isEditMode}
        onRemove={props.onRemove}
        onEdit={props.onEdit}
      />
    );
  }
  if (widget.type === "data_quality_panel") {
    return (
      <DataQualityPanelWidget
        widget={widget}
        isEditMode={props.isEditMode}
        onRemove={props.onRemove}
        onEdit={props.onEdit}
      />
    );
  }
  return <StandardWidget {...props} />;
}

function StandardWidget({
  widget, isEditMode, onRemove, onEdit, publicToken,
}: WidgetRendererProps) {
  const resolved = useWidgetData(widget, publicToken);
  const { data, isLoading, sourceType } = resolved;
  const colors = widget.options?.colors || DEFAULT_COLORS;
  const color = widget.options?.color || DEFAULT_COLORS[0];

  const xKey = sourceType === "sql_agent"
    ? (resolved.xAxisColumn || (Array.isArray(data) && data[0] ? Object.keys(data[0])[0] : "name"))
    : "name";

  const yKeys: string[] = sourceType === "sql_agent"
    ? (resolved.yAxisColumns?.length ? resolved.yAxisColumns : ["value"])
    : (resolved.metricKeys && resolved.metricKeys.length > 1
        ? resolved.metricKeys
        : ["value"]);

  return (
    <Card className="h-full relative group overflow-hidden" data-testid={`widget-${widget.id}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <span data-testid={`text-widget-title-${widget.id}`}>{widget.title}</span>
          {isEditMode && (
            <div className="ml-auto flex items-center gap-1 shrink-0">
              {onEdit && (
                <button
                  onClick={() => onEdit(widget)}
                  className="opacity-60 hover:opacity-100 text-muted-foreground"
                  data-testid={`button-edit-widget-${widget.id}`}
                  title="Editar widget"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={() => onRemove?.(widget.id)}
                className="opacity-60 hover:opacity-100 text-destructive text-xs"
                data-testid={`button-remove-widget-${widget.id}`}
              >
                ✕
              </button>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {isLoading && <Skeleton className="h-[140px] w-full" />}

        {!isLoading && Array.isArray(data) && data.length === 0 && (
          <div className="text-xs text-muted-foreground py-6 text-center">
            Sem dados ainda.
          </div>
        )}

        {!isLoading && Array.isArray(data) && data.length > 0 && (
          <>
            {widget.type === "kpi_card" && (
              <div className="space-y-1">
                {data.slice(0, 6).map((item: any, i: number) => (
                  <div
                    key={`${item[xKey] ?? i}`}
                    className="flex justify-between py-1 border-b last:border-0"
                  >
                    <span className="text-sm text-muted-foreground">{item[xKey]}</span>
                    <span className="text-lg font-bold" style={{ color }}>
                      {widget.options?.valuePrefix}
                      {item[yKeys[0]]}
                      {widget.options?.valueSuffix}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {widget.type === "bar_chart" && (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data}>
                  <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  {yKeys.length > 1 && <Legend />}
                  {yKeys.map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      fill={colors[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}

            {widget.type === "line_chart" && (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={data}>
                  <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  {yKeys.length > 1 && <Legend />}
                  {yKeys.map((k, i) => (
                    <Line
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stroke={colors[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                      dot={false}
                      strokeWidth={2}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}

            {widget.type === "radar_chart" && (
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={data}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey={xKey} tick={{ fontSize: 10 }} />
                  <Radar dataKey={yKeys[0]} fill={color} fillOpacity={0.4} stroke={color} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            )}

            {widget.type === "area_chart" && (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={data}>
                  <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  {yKeys.length > 1 && <Legend />}
                  {yKeys.map((k, i) => (
                    <Area
                      key={k} type="monotone" dataKey={k}
                      stroke={colors[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                      fill={colors[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                      fillOpacity={0.3}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}

            {(widget.type === "pie_chart" || widget.type === "donut_chart") && (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey={yKeys[0]}
                    nameKey={xKey}
                    cx="50%" cy="50%"
                    innerRadius={widget.type === "donut_chart" ? 45 : 0}
                    outerRadius={75}
                    label={(e: any) => e[xKey]}
                  >
                    {data.map((_: any, i: number) => (
                      <Cell key={i} fill={colors[i % colors.length] || DEFAULT_COLORS[i % DEFAULT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}

            {widget.type === "funnel_chart" && (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  layout="vertical"
                  data={[...data].sort((a: any, b: any) => (Number(b[yKeys[0]]) || 0) - (Number(a[yKeys[0]]) || 0))}
                  margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey={xKey} tick={{ fontSize: 11 }} width={90} />
                  <Tooltip />
                  <Bar dataKey={yKeys[0]} radius={[0, 4, 4, 0]}>
                    {data.map((_: any, i: number) => (
                      <Cell key={i} fill={colors[i % colors.length] || DEFAULT_COLORS[i % DEFAULT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {widget.type === "big_number" && (
              <div className="flex flex-col items-center justify-center h-[140px]">
                <div className="text-4xl font-bold" style={{ color }} data-testid={`big-number-${widget.id}`}>
                  {widget.options?.valuePrefix}
                  {(() => {
                    const v = data.reduce((s: number, r: any) => s + (Number(r[yKeys[0]]) || 0), 0);
                    return Number.isInteger(v) ? v.toLocaleString("pt-BR") : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
                  })()}
                  {widget.options?.valueSuffix}
                </div>
                <div className="text-xs text-muted-foreground mt-2">{data.length} {data.length === 1 ? "registro" : "registros"}</div>
              </div>
            )}

            {widget.type === "gauge_chart" && (() => {
              const v = data.reduce((s: number, r: any) => s + (Number(r[yKeys[0]]) || 0), 0);
              const max = Math.max(v, 100);
              const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
              return (
                <ResponsiveContainer width="100%" height={180}>
                  <RadialBarChart
                    innerRadius="65%" outerRadius="95%"
                    data={[{ name: "value", value: pct, fill: color }]}
                    startAngle={180} endAngle={0}
                  >
                    <RadialBar dataKey="value" cornerRadius={6} background />
                    <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" fontSize="22" fontWeight="bold" fill={color}>
                      {widget.options?.valuePrefix}{Number.isInteger(v) ? v : v.toFixed(2)}{widget.options?.valueSuffix}
                    </text>
                  </RadialBarChart>
                </ResponsiveContainer>
              );
            })()}

            {widget.type === "waterfall_chart" && (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data}>
                  <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey={yKeys[0]} radius={[4, 4, 0, 0]}>
                    {data.map((r: any, i: number) => (
                      <Cell key={i} fill={(Number(r[yKeys[0]]) || 0) >= 0 ? "#1D9E75" : "#D85A30"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {widget.type === "mixed_timeseries" && (
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={data}>
                  <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  {yKeys.length > 1 && <Legend />}
                  <Bar dataKey={yKeys[0]} fill={colors[0] || DEFAULT_COLORS[0]} radius={[4, 4, 0, 0]} />
                  {yKeys[1] && (
                    <Line type="monotone" dataKey={yKeys[1]} stroke={colors[1] || DEFAULT_COLORS[1]} strokeWidth={2} dot={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}

            {widget.type === "data_table" && (
              <div className="overflow-auto max-h-[180px] text-xs">
                <table className="w-full" data-testid={`table-${widget.id}`}>
                  <thead className="sticky top-0 bg-card border-b">
                    <tr>
                      {Object.keys(data[0] || {}).map((k) => (
                        <th key={k} className="text-left py-1.5 px-2 font-medium text-muted-foreground">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.slice(0, 50).map((row: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        {Object.keys(data[0] || {}).map((k) => (
                          <td key={k} className="py-1 px-2">{String(row[k] ?? "—")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {widget.type === "scatter_plot" && (
              <ResponsiveContainer width="100%" height={180}>
                <ScatterChart>
                  <XAxis type="category" dataKey={xKey} tick={{ fontSize: 11 }} />
                  <YAxis type="number" dataKey={yKeys[0]} tick={{ fontSize: 11 }} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                  <Scatter data={data} fill={color} />
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </>
        )}

        {!isLoading && isEditMode && (
          <div className="absolute bottom-2 left-3 text-[9px] text-muted-foreground/60">
            {sourceType === "sql_agent" ? "⚡ SQL"
              : sourceType === "connector" ? "🔌 Conector"
              : sourceType === "semantic" ? "🧬 Semantic"
              : "📊 Interno"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
