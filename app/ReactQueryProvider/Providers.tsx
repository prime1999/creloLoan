"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "./getQueryClients";

// Client-only wrapper that provides a shared QueryClient to the app tree.
export default function Providers({ children }: { children: React.ReactNode }) {
  // Returns request-scoped client on server and singleton client in browser.
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
