import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { DashboardFilter } from "@shared/schema";

interface FilterCtx {
  values: Omit<DashboardFilter, "enabledFilters">;
  enabledFilters: DashboardFilter["enabledFilters"];
  setValue: (key: keyof Omit<DashboardFilter, "enabledFilters">, v: string | undefined) => void;
  reset: () => void;
  qs: string;
  isPublic: boolean;
  publicPassword?: string;
}

const Ctx = createContext<FilterCtx | null>(null);

export function DashboardFilterProvider({
  children,
  enabledFilters = [],
  initial = {},
  isPublic = false,
  publicPassword,
}: {
  children: ReactNode;
  enabledFilters?: DashboardFilter["enabledFilters"];
  initial?: Omit<DashboardFilter, "enabledFilters">;
  isPublic?: boolean;
  publicPassword?: string;
}) {
  const [values, setValues] = useState<Omit<DashboardFilter, "enabledFilters">>(initial);

  const ctx: FilterCtx = useMemo(() => {
    const params = new URLSearchParams();
    if (enabledFilters.includes("daterange")) {
      if (values.startDate) params.set("startDate", values.startDate);
      if (values.endDate) params.set("endDate", values.endDate);
    }
    if (enabledFilters.includes("client") && values.clientId) params.set("clientId", values.clientId);
    if (enabledFilters.includes("project") && values.projectId) params.set("projectId", values.projectId);
    if (enabledFilters.includes("status") && values.status) params.set("status", values.status);
    const qs = params.toString();
    return {
      values,
      enabledFilters,
      setValue: (key, v) =>
        setValues((prev) => ({ ...prev, [key]: v && v.length ? v : undefined })),
      reset: () => setValues({}),
      qs: qs ? `?${qs}` : "",
      isPublic,
      publicPassword,
    };
  }, [values, enabledFilters, isPublic, publicPassword]);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useDashboardFilter() {
  return useContext(Ctx);
}
