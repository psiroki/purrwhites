const cacheName = "purrwhites-v1.0.0";
const files = [
  "/purrwhites/",
  "/purrwhites/?source=pwa",
  "/purrwhites/ImageProcessor.js",
  "/purrwhites/README.md",
  "/purrwhites/common/math.js",
  "/purrwhites/crc32.js",
  "/purrwhites/favicon.ico",
  "/purrwhites/icon-192.png",
  "/purrwhites/icon-512.png",
  "/purrwhites/index.html",
  "/purrwhites/manifest.json",
  "/purrwhites/offwhite.jpeg",
  "/purrwhites/pw.png",
  "/purrwhites/ui/scrollzoom.js",
  "https://fonts.googleapis.com/icon"
];

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.open(cacheName)
      .then(c => c.match(event.request))
      .then(response => {
        return response || fetch(event.request);
      })
  );
});

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(cacheName).then(cache => {
      return cache.addAll(files);
    })
  );
});

// Delete stale caches from previous versions once the new one is active.
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith("purrwhites-v") && key !== cacheName)
          .map(key => caches.delete(key))
    ))
  );
});

self.addEventListener("message", event => {
  const msg = event.data;
  if (msg["action"] === "hi") {
    const dash = cacheName.indexOf("-");
    event.source.postMessage({"action": "greetings", "version": cacheName.substring(dash + 1)});
  }
});
