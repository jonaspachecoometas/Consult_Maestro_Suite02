import { useQueries, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { WidgetConfig, DataSourceRef } from "@shared/schema";
import { useDashboardFilter } from "./DashboardFilterContext";

function resolveDataSource(widget: WidgetConfig): DataSourceRef {
  if (widget.dataSource) return widget.dataSource;
  if (widget.sqlQueryId) {
    return { type: "sql_agent", sqlQueryId: widget.sqlQueryId };
  }
  return {
    type: "internal",
    metricKey: widget.metricKey || "projects_by_status",
    metricKeys: widget.metricKeys,
  };
}

type Row = Record<string, any>;

interface ResolvedData {
  data: Row[] | null;
  isLoading: boolean;
  sourceType: "internal" | "sql_agent" | "connector" | "semantic";
  xAxisColumn?: string;
  yAxisColumns?: string[];
  metricKeys?: string[];
}

export function useWidgetData(widget: WidgetConfig, publicToken?: string): ResolvedData {
  const ds = resolveDataSource(widget);
  const filterCtx = useDashboardFilter();
  const qs = !widget.ignoreGlobalFilters && filterCtx ? filterCtx.qs : "";

  // Always call all hooks unconditionally; gate by `enabled`.
  const internalKeys =
    ds.type === "internal" ? (ds.metricKeys?.length ? ds.metricKeys : [ds.metricKey]) : [];

  const internalQueries = useQueries({
    queries: internalKeys.map((key) => ({
      queryKey: publicToken
        ? ["/api/bi/public", publicToken, "metrics", key, qs, filterCtx?.publicPassword || ""]
        : ["/api/bi", key, qs],
      queryFn: async () => {
        const url = publicToken
          ? `/api/bi/public/${publicToken}/metrics/${key}${qs}`
          : `/api/bi/${key}${qs}`;
        const headers: Record<string, string> = {};
        if (publicToken && filterCtx?.publicPassword) {
          headers["x-share-password"] = filterCtx.publicPassword;
        }
        const res = await fetch(url, { credentials: "include", headers });
        if (!res.ok) throw new Error(`${res.status}`);
        return await res.json();
      },
      enabled: ds.type === "internal" && !!key,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const sqlQueryId = ds.type === "sql_agent" ? ds.sqlQueryId : null;
  const sqlQuery = useQuery({
    queryKey: ["/api/sql", sqlQueryId, "data"],
    enabled: !!sqlQueryId && !publicToken,
    staleTime: 5 * 60 * 1000,
  });

  const connectorId = ds.type === "connector" ? (ds.connectorId || (ds as any).dataSourceId) : null;
  const connectorQuery = useQuery<{ rows: Row[]; columns: string[] }>({
    queryKey: ["/api/datasources", connectorId, "data"],
    enabled: !!connectorId && !publicToken,
    staleTime: 60 * 1000,
  });

  // Phase 3 — Semantic Layer data source.
  const semanticMetricId = ds.type === "semantic" ? ds.metricId : null;
  const semanticSources = ds.type === "semantic" ? (ds.sources || []) : [];
  const semanticQuery = useQuery<{ rows: Row[] }>({
    queryKey: ["/api/bi/semantic/run", semanticMetricId, semanticSources, qs],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/bi/semantic/run", {
        metricId: semanticMetricId,
        sources: semanticSources,
        filters: qs ? Object.fromEntries(new URLSearchParams(qs.replace(/^\?/, ""))) : {},
      });
      return await res.json();
    },
    enabled: !!semanticMetricId && !publicToken,
    staleTime: 60 * 1000,
  });

  if (ds.type === "internal") {
    const isLoading = internalQueries.some((q) => q.isLoading);
    if (internalKeys.length <= 1) {
      return {
        data: (internalQueries[0]?.data as Row[]) || [],
        isLoading,
        sourceType: "internal",
        metricKeys: internalKeys,
      };
    }
    const merged = new Map<string, Row>();
    internalKeys.forEach((key, i) => {
      const rows = (internalQueries[i]?.data as Row[]) || [];
      for (const r of rows) {
        const k = String(r.name);
        const existing = merged.get(k) || { name: k };
        existing[key] = r.value;
        merged.set(k, existing);
      }
    });
    return {
      data: Array.from(merged.values()),
      isLoading,
      sourceType: "internal",
      metricKeys: internalKeys,
      yAxisColumns: internalKeys,
    };
  }

  if (ds.type === "sql_agent") {
    return {
      data: (sqlQuery.data as Row[]) || [],
      isLoading: sqlQuery.isLoading,
      sourceType: "sql_agent",
      xAxisColumn: ds.xAxisColumn,
      yAxisColumns: ds.yAxisColumns,
    };
  }

  if (ds.type === "semantic") {
    return {
      data: semanticQuery.data?.rows || [],
      isLoading: semanticQuery.isLoading,
      sourceType: "semantic",
    };
  }

  return {
    data: connectorQuery.data?.rows || [],
    isLoading: connectorQuery.isLoading,
    sourceType: "connector",
    xAxisColumn: (ds as any).xAxisColumn,
    yAxisColumns: (ds as any).yAxisColumns,
  };
}
