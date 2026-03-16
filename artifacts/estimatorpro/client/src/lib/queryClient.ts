import { QueryClient, QueryFunction } from "@tanstack/react-query";

// ── Silent token refresh ────────────────────────────────────────────────────

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

/**
 * Decode JWT exp without verifying signature (client-side only).
 */
function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null; // convert to ms
  } catch {
    return null;
  }
}

/**
 * Call the server refresh endpoint using the HTTP-only cookie.
 * Returns the new access token or null if refresh failed.
 */
async function doSilentRefresh(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}), // body triggers the endpoint; cookie carries the refresh token
    });
    if (!res.ok) return null;
    const data = await res.json();
    const newToken: string | undefined = data.token || data.accessToken;
    if (newToken) {
      localStorage.setItem('auth_token', newToken);
      scheduleTokenRefresh(newToken);
      return newToken;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Schedule a proactive token refresh 10 minutes before the token expires.
 * Call this once after login and after each refresh.
 */
export function scheduleTokenRefresh(token: string) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const expiry = getTokenExpiry(token);
  if (!expiry) return;
  const msUntilExpiry = expiry - Date.now();
  const refreshAt = Math.max(msUntilExpiry - 10 * 60 * 1000, 30_000); // 10 min before expiry, min 30s
  refreshTimer = setTimeout(async () => {
    await doSilentRefresh();
  }, refreshAt);
}

/**
 * If a refresh is already in progress, return that same promise.
 * Otherwise start a new refresh. This prevents thundering-herd on 401.
 */
function ensureRefresh(): Promise<string | null> {
  if (!isRefreshing) {
    isRefreshing = true;
    refreshPromise = doSilentRefresh().finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });
  }
  return refreshPromise!;
}

// ── Auth helpers ────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const h: Record<string, string> = {};
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// ── apiRequest (mutations etc.) ─────────────────────────────────────────────

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const isFormData = data instanceof FormData;
  const headers: Record<string, string> = { ...authHeaders() };
  if (data && !isFormData) headers['Content-Type'] = 'application/json';

  const doFetch = (tok?: string) =>
    fetch(url, {
      method,
      headers: tok ? { ...headers, Authorization: `Bearer ${tok}` } : headers,
      body: isFormData ? (data as FormData) : data ? JSON.stringify(data) : undefined,
      credentials: 'include',
    });

  let res = await doFetch();

  // On 401/403 try a silent refresh once, then retry
  if (res.status === 401 || res.status === 403) {
    const newToken = await ensureRefresh();
    if (newToken) {
      res = await doFetch(newToken);
    } else {
      // Refresh failed — redirect to login
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
      throw new Error('Session expired. Please log in again.');
    }
  }

  await throwIfResNotOk(res);
  return res;
}

// ── Query function ──────────────────────────────────────────────────────────

type UnauthorizedBehavior = 'returnNull' | 'throw';

export const getQueryFn: <T>(_options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers: Record<string, string> = { ...authHeaders() };

    const doFetch = (tok?: string) =>
      fetch(queryKey.join('/') as string, {
        headers: tok ? { ...headers, Authorization: `Bearer ${tok}` } : headers,
        credentials: 'include',
      });

    let res = await doFetch();

    // Silent refresh on 401/403
    if (res.status === 401 || res.status === 403) {
      if (unauthorizedBehavior === 'returnNull') return null as any;
      const newToken = await ensureRefresh();
      if (newToken) {
        res = await doFetch(newToken);
      } else {
        localStorage.removeItem('auth_token');
        window.location.href = '/login';
        throw new Error('Session expired. Please log in again.');
      }
    }

    await throwIfResNotOk(res);
    return await res.json() as any;
  };

// ── QueryClient ─────────────────────────────────────────────────────────────

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: 'throw' }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// ── Bootstrap: schedule refresh for existing token on page load ─────────────
const _existingToken = localStorage.getItem('auth_token');
if (_existingToken) scheduleTokenRefresh(_existingToken);
