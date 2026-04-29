import { isServer, QueryClient } from "@tanstack/react-query";

// Factory for a new QueryClient instance with shared defaults.
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Keep data fresh for five minutes before refetching.
        staleTime: 1000 * 60 * 5, // 5 minutes
        //cacheTime: 1000 * 60 * 60, // 1 hour
        // Disable refetch on tab focus to avoid noisy wallet/network refetches.
        refetchOnWindowFocus: false,
      },
    },
  });
}

// Browser singleton prevents recreating QueryClient every render.
let browserQueryClient: QueryClient | null = null;
export function getQueryClient() {
  // On server, always return a new instance per request render cycle.
  if (isServer) {
    return makeQueryClient();
  }

  // In browser, lazily initialize once and reuse.
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
