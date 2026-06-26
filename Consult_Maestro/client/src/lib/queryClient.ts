import { QueryClient, QueryFunction } from "@tanstack/react-query";

const ACTIVE_TENANT_STORAGE_KEY = "arcadia.activeTenantId";

export function getActiveTenantId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveTenantId(tenantId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (tenantId) {
      window.localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, tenantId);
    } else {
      window.localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
    }
  } catch {
    /* noop */
  }
}

function buildHeaders(hasJsonBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (hasJsonBody) headers["Content-Type"] = "application/json";
  const tenantId = getActiveTenantId();
  if (tenantId) headers["x-tenant-id"] = tenantId;
  return headers;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export function parseApiError(err: unknown): {
  status: number | null;
  message: string;
  body: any;
} {
  const raw = (err as any)?.message ?? String(err);
  const m = String(raw).match(/^(\d+):\s*([\s\S]*)$/);
  if (!m) return { status: null, message: raw, body: null };
  const status = Number(m[1]);
  try {
    const body = JSON.parse(m[2]);
    return { status, message: body?.message ?? m[2], body };
  } catch {
    return { status, message: m[2], body: null };
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: buildHeaders(data !== undefined),
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: buildHeaders(false),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
