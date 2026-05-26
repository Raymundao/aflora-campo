// Persistência local em IndexedDB — auto-save por transação (ACID), sobrevive a
// fechar/matar o app. Cada inventário é um documento (estratos+parcelas+indivíduos
// aninhados): salvar = put do documento inteiro numa transação.
const DB_NAME = "aflora-campo";
const DB_VERSION = 1;
const STORE = "inventarios";

let _dbPromise = null;

function abrir() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
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

function store(db, modo) {
  return db.transaction(STORE, modo).objectStore(STORE);
}

// Pede ao navegador armazenamento PERSISTENTE (não despejável sob pressão de
// espaço). Retorna true se concedido. Instalar o PWA aumenta a chance de concessão.
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

export async function listarInventarios() {
  const db = await abrir();
  const arr = await pedido(store(db, "readonly").getAll());
  return arr.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
}

export async function obterInventario(id) {
  const db = await abrir();
  return pedido(store(db, "readonly").get(id));
}

export async function salvarInventario(inv) {
  const db = await abrir();
  inv.atualizadoEm = Date.now();
  if (!inv.criadoEm) inv.criadoEm = inv.atualizadoEm;
  await pedido(store(db, "readwrite").put(inv));
  return inv;
}

export async function excluirInventario(id) {
  const db = await abrir();
  await pedido(store(db, "readwrite").delete(id));
}
