const CACHE_NAME = "esabod-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./register.html",
  "./dashboard.html",
  "./feed.html",
  "./water.html",
  "./temperature.html",
  "./alerts.html",
  "./calendar.html",
  "./style.css",
  "./app.js",
  "./supabase.js",
  "./login.js",
  "./register.js",
  "./monitor.js",
  "./dashboard.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./LOGO.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    if (new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
