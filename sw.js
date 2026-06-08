// Service worker — cache offline dos assets do app. Cache-first com atualização
// em segundo plano. Suba a versão (CACHE) ao alterar arquivos pra forçar refresh.
const CACHE = "aflora-campo-v65";
const TILES = "aflora-tiles-v1";   // cache de tiles de satélite (mapa do censo, offline)
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/estilo.css",
  "./vendor/leaflet.css", "./vendor/leaflet.js", "./vendor/leaflet-rotate.js",
  "./js/app.js", "./js/calculos.js", "./js/modelo.js", "./js/db.js", "./js/export.js",
  "./js/zip.js", "./js/xlsx.js", "./js/imagem.js",
  "./data/tabela_t.js",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png",
  "./img/brasil_aflora.png",
];

// tiles de mapa (Esri/Google/OSM) — host externo, cacheado à parte pra offline
const ehTile = (url) => /server\.arcgisonline\.com|tile\.openstreetmap\.org|mts?\d?\.google|tile\.googleapis/.test(url);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // mantém o cache da versão atual E o cache de tiles (não re-baixar o mapa a cada update)
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k))))
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
  // Tiles de mapa: cache-first (não mudam). Servem offline depois de baixados/vistos.
  if (ehTile(e.request.url)) {
    e.respondWith((async () => {
      const tc = await caches.open(TILES);
      const hit = await tc.match(e.request);
      if (hit) return hit;
      try {
        const resp = await fetch(e.request);
        if (resp && (resp.ok || resp.type === "opaque")) tc.put(e.request, resp.clone());
        return resp;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Arquivos do PRÓPRIO app: busca SEMPRE da rede ignorando o cache HTTP do
    // navegador (cache:"no-store") — assim atualização chega no campo de verdade,
    // sem ficar presa no cache teimoso do Android. Offline cai pro cache do SW.
    const mesmaOrigem = new URL(e.request.url).origin === self.location.origin;
    try {
      const resp = await Promise.race([
        fetch(e.request, mesmaOrigem ? { cache: "no-store" } : undefined),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
      ]);
      if (resp && resp.status === 200 && resp.type === "basic") cache.put(e.request, resp.clone());
      return resp;
    } catch (err) {
      return (await cache.match(e.request)) || cache.match("./index.html");
    }
  })());
});
