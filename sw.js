// Service worker — cache offline dos assets do app. Cache-first com atualização
// em segundo plano. Suba a versão (CACHE) ao alterar arquivos pra forçar refresh.
const CACHE = "aflora-campo-v28";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/estilo.css",
  "./js/app.js", "./js/calculos.js", "./js/modelo.js", "./js/db.js", "./js/export.js",
  "./js/zip.js", "./js/xlsx.js", "./js/imagem.js",
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
// Rede-primeiro com timeout: online sempre pega a versão NOVA na hora (bom pra
// iteração rápida); sem sinal ou lento (>3s) cai pro cache — ainda funciona no
// campo. Quando estabilizar, dá pra voltar pro cache-first se quiser abrir mais rápido.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const resp = await Promise.race([
        fetch(e.request),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
      ]);
      if (resp && resp.status === 200 && resp.type === "basic") cache.put(e.request, resp.clone());
      return resp;
    } catch (err) {
      return (await cache.match(e.request)) || cache.match("./index.html");
    }
  })());
});
