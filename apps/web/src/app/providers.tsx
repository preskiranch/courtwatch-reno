"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { pruneStaleApiCaches } from "../lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchInterval: 60_000,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    pruneStaleApiCaches();
    if ("caches" in window) {
      void window.caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) =>
                  key.startsWith("courtwatch-reno-") ||
                  key.startsWith("courtwatch-aau-"),
              )
              .map((key) => window.caches.delete(key)),
          ),
        )
        .catch(() => undefined);
    }
    if ("serviceWorker" in navigator) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          void registration.update();
          registration.waiting?.postMessage({ type: "SKIP_WAITING" });
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                worker.postMessage({ type: "SKIP_WAITING" });
              }
            });
          });
        })
        .catch(() => undefined);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
