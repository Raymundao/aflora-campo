// Service worker — cache offline dos assets do app. Cache-first com atualização
// em segundo plano. Suba a versão (CACHE) ao alterar arquivos pra forçar refresh.
const CACHE = "aflora-campo-v11";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/estilo.css",
  "./js/app.js", "./js/calculos.js", "./js/modelo.js", "./js/db.js", "./js/export.js",
  "./js/zip.js", "./js/xlsx.js",
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

// Stale-while-revalidate: serve o cache NA HORA (rápido, funciona offline e com
// sinal ruim) e busca a versão nova em segundo plano — ela entra na próxima
// abertura. Assim o app abre instantâneo no campo e continua recebendo updates.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const buscaRede = fetch(e.request).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          caches.open(CACHE).then((c) => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() => cached || caches.match("./index.html"));
      return cached || buscaRede;
    }),
  );
});
