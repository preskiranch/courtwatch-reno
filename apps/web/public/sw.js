const CACHE_NAME = "courtwatch-aau-v69";
const APP_SHELL = [
  "/install",
  "/support",
  "/privacy",
  "/terms",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/share/courtwatch-reno-qr.jpg",
  "/bezel/courtwatch-side-bezel.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== CACHE_NAME &&
                (key.startsWith("courtwatch-reno-") ||
                  key.startsWith("courtwatch-aau-")),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(
        () =>
          new Response(
            "Court Watch AAU is temporarily offline. Reconnect and refresh for the latest tournament data.",
            {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
              status: 503,
            },
          ),
      ),
    );
    return;
  }

  if (request.url.includes("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.url.includes("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      }),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/")),
      ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Court Watch AAU",
    body: "A watched tournament item changed.",
    url: "/",
  };
  try {
    payload = event.data ? event.data.json() : payload;
  } catch {
    payload = {
      ...payload,
      body: event.data ? event.data.text() : payload.body,
    };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon.svg",
      badge: "/icons/icon.svg",
      data: { url: payload.url || "/" },
      silent: false,
      timestamp: Date.now(),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(self.clients.openWindow(url));
});
