// Export do inventário: JSON (backup completo, reimportável) e CSV (1 linha por
// fuste, schema compatível com aflora_tools.sinaflor pra reprocessar no Python).
import { volumeIndividuo, dapDeCap } from "./calculos.js";

export function inventarioParaJSON(inv) {
  return JSON.stringify(inv, null, 2);
}

function numBR(v, casas = 4) {
  if (v == null || Number.isNaN(v)) return "";
  return Number(v).toFixed(casas).replace(".", ",");
}

// CSV separado por ";" e decimal com vírgula (abre direto no Excel BR).
export function inventarioParaCSV(inv) {
  const head = [
    "estrato", "fitofisionomia", "estagio", "parcela", "lat", "lon", "placa", "especie", "fuste",
    "cap_cm", "dap_cm", "altura_m", "vol_aereo_m3", "vol_total_m3",
  ];
  const linhas = [head.join(";")];
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

export function baixar(nomeArquivo, conteudo, tipo = "text/plain") {
  const blob = new Blob([conteudo], { type: `${tipo};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const slug = (s) => (s || "inventario").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

export function exportarJSON(inv) {
  baixar(`${slug(inv.nome)}.json`, inventarioParaJSON(inv), "application/json");
}
export function exportarCSV(inv) {
  baixar(`${slug(inv.nome)}.csv`, inventarioParaCSV(inv), "text/csv");
}
