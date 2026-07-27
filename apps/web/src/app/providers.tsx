"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { pruneStaleApiCaches } from "../lib/api";
import { queryRetryDelay, shouldRetryQuery } from "../lib/query-policy";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            networkMode: "offlineFirst",
            refetchOnReconnect: "always",
            retry: shouldRetryQuery,
            retryDelay: queryRetryDelay,
          },
          mutations: {
            networkMode: "online",
            retry: false,
          },
        },
      }),
  );

  useEffect(() => {
    pruneStaleApiCaches();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          // Update the worker in the background. Reloading on controllerchange
          // interrupts navigation and resets the active app tab on iOS.
          void registration.update();
        })
        .catch(() => undefined);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
