self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Supabase ve harici API isteklerine hiç dokunma
  if (url.origin !== self.location.origin || event.request.method !== 'GET') {
    return;
  }
  event.respondWith(fetch(event.request));
});