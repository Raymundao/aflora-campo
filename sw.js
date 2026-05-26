// Service worker — cache offline dos assets do app. Cache-first com atualização
// em segundo plano. Suba a versão (CACHE) ao alterar arquivos pra forçar refresh.
const CACHE = "aflora-campo-v7";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/estilo.css",
  "./js/app.js", "./js/calculos.js", "./js/modelo.js", "./js/db.js", "./js/export.js",
  "./data/tabela_t.js",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./img/brasil_aflora.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first: online sempre pega a versão nova (e atualiza o cache); offline
// cai no cache. Bom pra campo — atualiza no escritório, funciona no mato.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then((resp) => {
      if (resp && resp.status === 200 && resp.type === "basic") {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
      }
      return resp;
    }).catch(() => caches.match(e.request).then((c) => c || caches.match("./index.html"))),
  );
});
