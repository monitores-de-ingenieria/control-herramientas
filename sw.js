// sw.js — cachea el shell de la app para que abra rápido y funcione
// sin conexión. Las peticiones a Firebase/Firestore NO se cachean:
// siempre van a la red porque los datos deben ser en tiempo real.

const CACHE_NAME = "control-herramientas-v1";

const ARCHIVOS_SHELL = [
  "./",
  "./index.html",
  "./css/estilos.css",
  "./js/app.js",
  "./js/firebase.js",
  "./js/inventario.js",
  "./js/prestamos.js",
  "./js/herramientas-respaldo.js",
  "./img/utesiano.jpg",
  "./img/icons/icon-192.png",
  "./img/icons/icon-512.png",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear Firebase/Firestore/Google APIs: esos datos son en vivo.
  if (
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("gstatic.com") ||
    url.hostname.includes("firestore")
  ) {
    return; // deja pasar la petición normal a la red
  }

  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cacheado) => {
      if (cacheado) return cacheado;
      return fetch(event.request)
        .then((respuesta) => {
          const copia = respuesta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
          return respuesta;
        })
        .catch(() => cacheado); // si falla la red y no hay caché, no hay más opción
    })
  );
});
