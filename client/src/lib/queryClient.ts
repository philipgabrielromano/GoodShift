import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Redirect to login when session is invalid (e.g., after server restart)
function handleUnauthorized() {
  // Only redirect if not already on login page
  if (!window.location.pathname.includes('/login')) {
    console.log('[Auth] Session expired or invalid, redirecting to login...');
    // Clear any stale session data
    window.location.href = '/login';
  }
}

async function throwIfResNotOk(res: Response, redirectOnUnauthorized: boolean = true) {
  if (!res.ok) {
    // Handle 401 Unauthorized - session expired or invalid
    if (res.status === 401 && redirectOnUnauthorized) {
      handleUnauthorized();
      // Throw a specific error so callers know what happened
      throw new Error('Session expired. Please log in again.');
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch("/api/auth/csrf-token", { credentials: "include" });
  if (res.ok) {
    const data = await res.json();
    csrfToken = data.csrfToken;
    return csrfToken!;
  }
  return "";
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const upperMethod = method.toUpperCase();
  if (upperMethod !== "GET" && upperMethod !== "HEAD" && upperMethod !== "OPTIONS") {
    const token = await getCsrfToken();
    if (token) {
      headers["CSRF-Token"] = token;
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.status === 403) {
    const text = await res.text();
    if (text.includes("csrf")) {
      csrfToken = null;
      const retryToken = await getCsrfToken();
      const retryHeaders: Record<string, string> = { ...headers };
      if (retryToken) {
        retryHeaders["CSRF-Token"] = retryToken;
      }
      const retryRes = await fetch(url, {
        method,
        headers: retryHeaders,
        body: data ? JSON.stringify(data) : undefined,
        credentials: "include",
      });
      await throwIfResNotOk(retryRes);
      return retryRes;
    }
    throw new Error(`${res.status}: ${text}`);
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw" | "redirect";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    // For "returnNull" behavior (used by auth status checks), just return null on 401
    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }
    
    // For "redirect" behavior, redirect to login on 401 (used by most data queries)
    // This handles stale sessions after server restarts
    if (unauthorizedBehavior === "redirect" && res.status === 401) {
      handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }

    // For "throw" behavior, let throwIfResNotOk handle it (which now also redirects)
    await throwIfResNotOk(res, unauthorizedBehavior !== "returnNull");
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Use "redirect" to automatically send users to login when session expires
      queryFn: getQueryFn({ on401: "redirect" }),
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
