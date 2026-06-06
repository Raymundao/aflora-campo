// Export do inventário: XLSX (planilha, números reais), CSV (schema sinaflor),
// JSON (backup reimportável). Baixar ou compartilhar (WhatsApp/email via Web Share).
import { volumeIndividuo, dapDeCap } from "./calculos.js";
import { BB_MIDPOINT } from "./modelo.js";
import { gerarXlsx } from "./xlsx.js";
import { criarZip } from "./zip.js";

export function inventarioParaJSON(inv) {
  return JSON.stringify(inv, null, 2);
}

const arred = (v, casas) => (v == null || Number.isNaN(v) ? "" : Number(Number(v).toFixed(casas)));

function numBR(v, casas = 4) {
  if (v == null || Number.isNaN(v)) return "";
  return Number(v).toFixed(casas).replace(".", ",");
}

const COLUNAS = [
  "estrato", "fitofisionomia", "estagio", "parcela", "lat", "lon", "placa", "especie", "fuste",
  "cap_cm", "dap_cm", "altura_m", "vol_aereo_m3", "vol_total_m3",
];

// Matriz [linha][coluna] — 1 linha por fuste. Números entram como número.
export function inventarioParaMatriz(inv) {
  const linhas = [COLUNAS.slice()];
  const estPorId = Object.fromEntries(inv.estratos.map((e) => [e.id, e]));
  for (const p of inv.parcelas) {
    const est = estPorId[p.estratoId] || {};
    for (const ind of p.individuos) {
      ind.fustes.forEach((f, i) => {
        if (f.capCm == null || f.alturaM == null) return;
        const vi = volumeIndividuo([f], est.fitofisionomia || "mata_fes", est.coefsCustom);
        linhas.push([
          est.nome || "", est.fitofisionomia || "", est.estagio || "", p.rotulo || "",
          p.lat ?? "", p.lon ?? "", ind.placa || "", ind.especie || "", i + 1,
          arred(f.capCm, 1), arred(dapDeCap(f.capCm), 2), arred(f.alturaM, 1),
          arred(vi.vol_aereo, 6), arred(vi.vol_total, 6),
        ]);
      });
    }
  }
  return linhas;
}

// CSV separado por ";" e decimal com vírgula (abre direto no Excel BR).
export function inventarioParaCSV(inv) {
  const linhas = [COLUNAS.join(";")];
  const estPorId = Object.fromEntries(inv.estratos.map((e) => [e.id, e]));
  for (const p of inv.parcelas) {
    const est = estPorId[p.estratoId] || {};
    for (const ind of p.individuos) {
      ind.fustes.forEach((f, i) => {
        if (f.capCm == null || f.alturaM == null) return;
        const vi = volumeIndividuo([f], est.fitofisionomia || "mata_fes", est.coefsCustom);
        linhas.push([
          (est.nome || "").replaceAll(";", ","),
          (est.fitofisionomia || "").replaceAll(";", ","),
          (est.estagio || "").replaceAll(";", ","),
          (p.rotulo || "").replaceAll(";", ","),
          p.lat ?? "", p.lon ?? "",
          (ind.placa || "").replaceAll(";", ","),
          (ind.especie || "").replaceAll(";", ","),
          i + 1,
          numBR(f.capCm, 1), numBR(dapDeCap(f.capCm), 2), numBR(f.alturaM, 1),
          numBR(vi.vol_aereo, 6), numBR(vi.vol_total, 6),
        ].join(";"));
      });
    }
  }
  return linhas.join("\r\n");
}

// ---------- estrato herbáceo (Braun-Blanquet / CONAMA 423) ----------
// 1 linha por (parcela, táxon). Ruderal vira flag separada (origem fica p/ definir
// pós-campo via REFLORA — padrão Diego: origem só Nativa/Exótica).
const COLUNAS_HERB = ["estrato", "fitofisionomia", "parcela", "lat", "lon", "taxon", "classe_bb", "cobertura_pct", "origem", "ruderal"];

export function temHerbaceo(inv) {
  return (inv.estratos || []).some((e) => e.metodo === "herbaceo");
}

export function inventarioHerbaceoParaMatriz(inv) {
  const linhas = [COLUNAS_HERB.slice()];
  const estPorId = Object.fromEntries(inv.estratos.map((e) => [e.id, e]));
  for (const p of inv.parcelas) {
    const est = estPorId[p.estratoId] || {};
    if (est.metodo !== "herbaceo") continue;
    for (const t of (p.taxons || [])) {
      if (!(t.nome || "").trim()) continue;
      const origem = t.origem === "Ruderal" ? "" : (t.origem || "");
      const ruderal = t.origem === "Ruderal" ? "sim" : "";
      const cob = (t.bb && BB_MIDPOINT[t.bb] != null) ? BB_MIDPOINT[t.bb] : "";
      linhas.push([est.nome || "", est.fitofisionomia || "", p.rotulo || "", p.lat ?? "", p.lon ?? "",
        t.nome, t.bb || "", cob, origem, ruderal]);
    }
  }
  return linhas;
}

export function inventarioHerbaceoParaCSV(inv) {
  const linhas = [COLUNAS_HERB.join(";")];
  const estPorId = Object.fromEntries(inv.estratos.map((e) => [e.id, e]));
  for (const p of inv.parcelas) {
    const est = estPorId[p.estratoId] || {};
    if (est.metodo !== "herbaceo") continue;
    for (const t of (p.taxons || [])) {
      if (!(t.nome || "").trim()) continue;
      const origem = t.origem === "Ruderal" ? "" : (t.origem || "");
      const ruderal = t.origem === "Ruderal" ? "sim" : "";
      const cob = (t.bb && BB_MIDPOINT[t.bb] != null) ? String(BB_MIDPOINT[t.bb]).replace(".", ",") : "";
      linhas.push([
        (est.nome || "").replaceAll(";", ","), (est.fitofisionomia || "").replaceAll(";", ","),
        (p.rotulo || "").replaceAll(";", ","), p.lat ?? "", p.lon ?? "",
        (t.nome || "").replaceAll(";", ","), t.bb || "", cob, origem, ruderal,
      ].join(";"));
    }
  }
  return linhas.join("\r\n");
}

// ---------- estrato CENSO (pontos georreferenciados) ----------
export function temCenso(inv) {
  return (inv.estratos || []).some((e) => e.metodo === "censo");
}
function pontosCenso(inv) {
  const out = [];
  for (const est of inv.estratos) {
    if (est.metodo !== "censo") continue;
    for (const pt of (est.pontos || [])) out.push({ est, pt });
  }
  return out;
}
const COLS_CENSO = ["estrato", "fitofisionomia", "placa", "especie", "lat", "lon", "alt_m", "fuste", "cap_cm", "dap_cm", "altura_m", "vol_aereo_m3", "vol_total_m3"];
export function inventarioCensoParaMatriz(inv) {
  const linhas = [COLS_CENSO.slice()];
  for (const { est, pt } of pontosCenso(inv)) {
    pt.fustes.forEach((f, i) => {
      if (f.capCm == null || f.alturaM == null) return;
      const vi = volumeIndividuo([f], est.fitofisionomia || "mata_fes", est.coefsCustom);
      linhas.push([est.nome || "", est.fitofisionomia || "", pt.placa || "", pt.especie || "",
        pt.lat ?? "", pt.lon ?? "", pt.alt ?? "", i + 1,
        arred(f.capCm, 1), arred(dapDeCap(f.capCm), 2), arred(f.alturaM, 1),
        arred(vi.vol_aereo, 6), arred(vi.vol_total, 6)]);
    });
  }
  return linhas;
}

// KMZ = zip com doc.kml; Placemarks dos pontos (nome no padrão AlpineQuest do
// Diego) + LineStrings das trilhas gravadas + Polygons desenhados.
// #rrggbb + opacidade(0..1) → aabbggrr (ordem do KML)
function kmlCor(hex, op) {
  if (!hex || hex[0] !== "#" || hex.length < 7) return null;
  const a = Math.round((op == null ? 1 : op) * 255).toString(16).padStart(2, "0");
  return a + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
}
function kmlCenso(inv) {
  const escX = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const marks = pontosCenso(inv).filter(({ pt }) => pt.lat != null && pt.lon != null).map(({ est, pt }) => {
    const caps = pt.fustes.map((f) => f.capCm).filter((v) => v != null).map((v) => numBR(v, 1)).join("+");
    const alts = pt.fustes.map((f) => f.alturaM).filter((v) => v != null).map((v) => numBR(v, 1)).join("/");
    const nome = [pt.placa, pt.especie, caps ? `CAP ${caps}` : "", alts ? `H ${alts}` : ""].filter(Boolean).join(" | ");
    const desc = `Estrato: ${est.nome || ""}\nEspécie: ${pt.especie || ""}\nCAP (cm): ${caps || "—"}\nAltura (m): ${alts || "—"}`;
    const coord = `${pt.lon},${pt.lat}${pt.alt != null ? "," + pt.alt : ""}`;
    return `<Placemark><name>${escX(nome || "ponto")}</name><description>${escX(desc)}</description><Point><coordinates>${coord}</coordinates></Point></Placemark>`;
  }).join("");
  // trilhas (por estrato censo) + fitofisionomias/polígonos (nível do projeto)
  let linhas = "", poligonos = "";
  for (const est of inv.estratos) {
    if (est.metodo !== "censo") continue;
    for (const t of (est.trilhas || [])) {
      if (!t.pontos || t.pontos.length < 2) continue;
      const cs = t.pontos.map(([la, lo]) => `${lo},${la}`).join(" ");
      linhas += `<Placemark><name>${escX(t.nome || "trilha")}</name><Style><LineStyle><color>ff00aaff</color><width>3</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${cs}</coordinates></LineString></Placemark>`;
    }
  }
  for (const pol of (inv.fitos || [])) {
    if (!pol.coords || pol.coords.length < 3) continue;
    const anel = pol.coords.concat([pol.coords[0]]).map(([la, lo]) => `${lo},${la}`).join(" ");
    const nome = [pol.fito, pol.nome].filter(Boolean).join(" · ") || "fitofisionomia";
    const corLinha = kmlCor(pol.corBorda, 1) || "ff2e7d32";
    const corFill = kmlCor(pol.cor, pol.opacidade == null ? 0.3 : pol.opacidade) || "4d43a047";
    poligonos += `<Placemark><name>${escX(nome)}</name><Style><LineStyle><color>${corLinha}</color><width>2</width></LineStyle><PolyStyle><color>${corFill}</color></PolyStyle></Style><Polygon><outerBoundaryIs><LinearRing><tessellate>1</tessellate><coordinates>${anel}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escX(inv.nome)} — censo</name>${marks}${linhas}${poligonos}</Document></kml>`;
}

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};

export function baixar(nomeArquivo, conteudo, tipo = "text/plain") {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: `${tipo};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Compartilha via Web Share API (menu nativo do Android com os apps: WhatsApp,
// e-mail, Drive...). Retorna { ok, motivo }. Tenta o share com arquivo; se o
// device não suportar arquivo, tenta com texto pra ao menos abrir o menu.
export async function compartilhar(nomeArquivo, conteudo, tipo) {
  if (!navigator.share) return { ok: false, motivo: "navigator.share indisponível neste navegador" };
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const file = new File([blob], nomeArquivo, { type: tipo });
  const podeArquivo = !navigator.canShare || navigator.canShare({ files: [file] });
  try {
    await navigator.share({ files: [file], title: nomeArquivo, text: nomeArquivo });
    return { ok: true };
  } catch (e) {
    if (e && e.name === "AbortError") return { ok: true }; // usuário cancelou
    return { ok: false, motivo: `${e?.name || "Erro"}: ${e?.message || ""} (canShareArquivo=${podeArquivo})` };
  }
}

const slug = (s) => (s || "inventario").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

const blobXLSX = (inv) => gerarXlsx(inventarioParaMatriz(inv), "Inventario");

// Prepara o xlsx de forma SÍNCRONA: { nome, blob, file }. Permite chamar
// navigator.share() direto no clique (sem await antes), evitando o
// NotAllowedError "Permission denied" por perda do gesto do usuário.
export function prepararXLSX(inv) {
  const nome = `${slug(inv.nome)}.xlsx`;
  const blob = blobXLSX(inv);
  return { nome, blob, file: new File([blob], nome, { type: MIME.xlsx }), mime: MIME.xlsx };
}

export function exportarJSON(inv) { baixar(`${slug(inv.nome)}.json`, inventarioParaJSON(inv), MIME.json); }
export function exportarCSV(inv) { baixar(`${slug(inv.nome)}.csv`, inventarioParaCSV(inv), MIME.csv); }
export function exportarXLSX(inv) { baixar(`${slug(inv.nome)}.xlsx`, blobXLSX(inv), MIME.xlsx); }

const blobHerbXLSX = (inv) => gerarXlsx(inventarioHerbaceoParaMatriz(inv), "Herbaceo");
export function exportarHerbaceoXLSX(inv) { baixar(`${slug(inv.nome)}_herbaceo.xlsx`, blobHerbXLSX(inv), MIME.xlsx); }
export function exportarHerbaceoCSV(inv) { baixar(`${slug(inv.nome)}_herbaceo.csv`, inventarioHerbaceoParaCSV(inv), MIME.csv); }

export function exportarCensoXLSX(inv) { baixar(`${slug(inv.nome)}_censo.xlsx`, gerarXlsx(inventarioCensoParaMatriz(inv), "Censo"), MIME.xlsx); }

// blobs/strings p/ montar o backup completo do projeto (1 ZIP com tudo)
export function blobXLSXInventario(inv) { return gerarXlsx(inventarioParaMatriz(inv), "Inventario"); }
export function blobXLSXHerbaceo(inv) { return gerarXlsx(inventarioHerbaceoParaMatriz(inv), "Herbaceo"); }
export function blobXLSXCenso(inv) { return gerarXlsx(inventarioCensoParaMatriz(inv), "Censo"); }
export function kmlCensoStr(inv) { return kmlCenso(inv); }
export const slugNome = slug;
export function exportarCensoKMZ(inv) {
  const zip = criarZip([{ nome: "doc.kml", dados: kmlCenso(inv) }]);
  baixar(`${slug(inv.nome)}_censo.kmz`, zip, "application/vnd.google-earth.kmz");
}

// Compartilha o XLSX; se não suportado, baixa. Retorna { ok, motivo }.
export async function compartilharXLSX(inv) {
  const nome = `${slug(inv.nome)}.xlsx`;
  const blob = blobXLSX(inv);
  const r = await compartilhar(nome, blob, MIME.xlsx);
  if (!r.ok) baixar(nome, blob, MIME.xlsx);
  return r;
}
