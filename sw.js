/* sw.js — service worker simples para permitir instalação e uso offline. */

const CACHE_NAME = 'financeapp-cache-v12';
const ASSETS = [
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/config.js',
  './js/db.js',
  './js/drive.js',
  './js/rates.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Nunca cacheia chamadas à API do Google ou de cotação de câmbio
  // (precisam sempre ser de rede / têm seu próprio cache em localStorage).
  if (
    event.request.url.includes('googleapis.com') ||
    event.request.url.includes('accounts.google.com') ||
    event.request.url.includes('frankfurter')
  ) {
    return;
  }
  // Network-first: sempre tenta buscar a versão mais nova primeiro (ex: depois
  // de você editar js/config.js no GitHub). Só usa o cache como fallback
  // quando estiver offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (event.request.method === 'GET' && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
