// Export do inventário: XLSX (planilha, números reais), CSV (schema sinaflor),
// JSON (backup reimportável). Baixar ou compartilhar (WhatsApp/email via Web Share).
import { volumeIndividuo, dapDeCap } from "./calculos.js";
import { BB_MIDPOINT } from "./modelo.js";
import { gerarXlsx } from "./xlsx.js";

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

// Compartilha o XLSX; se não suportado, baixa. Retorna { ok, motivo }.
export async function compartilharXLSX(inv) {
  const nome = `${slug(inv.nome)}.xlsx`;
  const blob = blobXLSX(inv);
  const r = await compartilhar(nome, blob, MIME.xlsx);
  if (!r.ok) baixar(nome, blob, MIME.xlsx);
  return r;
}
