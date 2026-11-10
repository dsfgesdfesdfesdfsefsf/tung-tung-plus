const CACHE = "tung-tung-plus-shell-v1";
const SHELL = ["./", "./index.html", "./styles.css", "./config.js", "./manifest.webmanifest", "./assets/icon-192.png", "./assets/icon-512.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Never cache Supabase API, signed media, uploads, or cross-origin content.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/storage/") || url.pathname.includes("/rest/")) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
    return response;
  })));
});
