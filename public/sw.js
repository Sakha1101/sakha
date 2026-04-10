self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("sakha-v2").then((cache) =>
      cache.addAll(["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"]),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (url.pathname === "/" || url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
