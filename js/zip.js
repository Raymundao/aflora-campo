// Mini-zipador ZIP (método STORE, sem compressão) — zero dependências.
// Suficiente pra .xlsx (XMLs pequenos) e pra zips de fotos (JPEG já comprimido,
// deflate não ajudaria). Usado por xlsx.js e pela exportação de fotos.

const _crcTab = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _crcTab[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const _enc = new TextEncoder();
const _bytes = (d) =>
  typeof d === "string" ? _enc.encode(d)
    : d instanceof Uint8Array ? d
      : new Uint8Array(d);

// arquivos: [{ nome: string, dados: string | Uint8Array | ArrayBuffer }]
// Retorna um Blob application/zip. Data DOS fixa (1980-01-01) — irrelevante.
export function criarZip(arquivos) {
  const partes = [];
  const central = [];
  let offset = 0;
  const dDate = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const dTime = 0;

  for (const a of arquivos) {
    const nome = _enc.encode(a.nome);
    const dados = _bytes(a.dados);
    const crc = crc32(dados);
    const size = dados.length;

    const lfh = new Uint8Array(30 + nome.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);       // version needed
    lv.setUint16(6, 0x0800, true);   // flag: nomes em UTF-8
    lv.setUint16(8, 0, true);        // método STORE
    lv.setUint16(10, dTime, true);
    lv.setUint16(12, dDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nome.length, true);
    lfh.set(nome, 30);
    partes.push(lfh, dados);

    const cdh = new Uint8Array(46 + nome.length);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dTime, true);
    cv.setUint16(14, dDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nome.length, true);
    cv.setUint32(42, offset, true);
    cdh.set(nome, 46);
    central.push(cdh);

    offset += lfh.length + dados.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) { partes.push(c); cdSize += c.length; }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  partes.push(eocd);

  return new Blob(partes, { type: "application/zip" });
}
