// Persistência local em IndexedDB — auto-save por transação (ACID), sobrevive a
// fechar/matar o app.
//   store "inventarios": 1 documento por inventário (estratos+parcelas+indivíduos).
//   store "fotos": 1 registro por foto (blob + metadados), separado pra não
//     inchar o documento do inventário. Ligado por invId + tipo + refKey.
const DB_NAME = "aflora-campo";
const DB_VERSION = 2;
const STORE = "inventarios";
const FOTOS = "fotos";

let _dbPromise = null;

function abrir() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FOTOS)) {
        const fs = db.createObjectStore(FOTOS, { keyPath: "id" });
        fs.createIndex("invId", "invId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function pedido(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function store(db, nome, modo) {
  return db.transaction(nome, modo).objectStore(nome);
}

// Pede ao navegador armazenamento PERSISTENTE (não despejável sob pressão de
// espaço). Importante com fotos, que ocupam mais. Retorna true se concedido.
export async function pedirPersistencia() {
  if (navigator.storage && navigator.storage.persist) {
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  }
  return false;
}

export async function estimativaArmazenamento() {
  if (navigator.storage && navigator.storage.estimate) {
    return await navigator.storage.estimate();
  }
  return null;
}

// ---------- inventários ----------
export async function listarInventarios() {
  const db = await abrir();
  const arr = await pedido(store(db, STORE, "readonly").getAll());
  return arr.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
}

export async function obterInventario(id) {
  const db = await abrir();
  return pedido(store(db, STORE, "readonly").get(id));
}

export async function salvarInventario(inv) {
  const db = await abrir();
  inv.atualizadoEm = Date.now();
  if (!inv.criadoEm) inv.criadoEm = inv.atualizadoEm;
  await pedido(store(db, STORE, "readwrite").put(inv));
  return inv;
}

export async function excluirInventario(id) {
  const db = await abrir();
  await pedido(store(db, STORE, "readwrite").delete(id));
  await excluirFotosDoInventario(id);
}

// ---------- fotos ----------
// foto: { id, invId, tipo:'especie'|'parcela', refKey, blob, lat, lon, capturadaEm }
export async function salvarFoto(foto) {
  const db = await abrir();
  await pedido(store(db, FOTOS, "readwrite").put(foto));
  return foto;
}

export async function obterFoto(id) {
  const db = await abrir();
  return pedido(store(db, FOTOS, "readonly").get(id));
}

export async function excluirFoto(id) {
  const db = await abrir();
  await pedido(store(db, FOTOS, "readwrite").delete(id));
}

// Todas as fotos de um inventário (via índice). Ordenadas por captura.
export async function fotosDoInventario(invId) {
  const db = await abrir();
  const idx = store(db, FOTOS, "readonly").index("invId");
  const arr = await pedido(idx.getAll(invId));
  return arr.sort((a, b) => (a.capturadaEm || 0) - (b.capturadaEm || 0));
}

export async function excluirFotosDoInventario(invId) {
  const db = await abrir();
  const tx = db.transaction(FOTOS, "readwrite");
  const idx = tx.objectStore(FOTOS).index("invId");
  const chaves = await pedido(idx.getAllKeys(invId));
  for (const k of chaves) tx.objectStore(FOTOS).delete(k);
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

// Renomeia o refKey de fotos (cascata ao renomear uma espécie).
export async function renomearRefKeyFotos(invId, tipo, antigo, novo) {
  const fotos = await fotosDoInventario(invId);
  const db = await abrir();
  const tx = db.transaction(FOTOS, "readwrite");
  for (const f of fotos) {
    if (f.tipo === tipo && f.refKey === antigo) {
      f.refKey = novo;
      tx.objectStore(FOTOS).put(f);
    }
  }
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
