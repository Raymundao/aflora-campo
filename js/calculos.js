// Núcleo de cálculo do app de campo — ESPELHO de:
//   aflora_tools.calculos_volume  (volume CETEC 1995)
//   aflora_tools.calculos_amostragem  (erro amostral ACS)
// Paridade verificada contra o Python via tests/fixtures/casos_calculo.json
// (ver app-campo/_teste_paridade.mjs). Manter as duas implementações em sincronia.
import { tStudent } from "../data/tabela_t.js";

export const FATOR_TOCOS_RAIZES = 0.1435; // 14,35% do volume aéreo (IEF)

// Coeficientes CETEC 1995 por fitofisionomia: Vt = a·DAP^b·Ht^c.
// As 3 fisionomias florestais (FES/FOD/FED) usam a MESMA equação (CETEC mata);
// `conama` indica o grupo de limiares pra classificação de estágio (CONAMA 392).
export const EQUACOES_VOLUME = {
  mata_fes:   { a: 0.000074230, b: 1.707348, c: 1.16873,  r2: 0.973, rotulo: "Mata (FES)", conama: "fes_fod" },
  mata_fod:   { a: 0.000074230, b: 1.707348, c: 1.16873,  r2: 0.973, rotulo: "Mata (FOD)", conama: "fes_fod" },
  mata_fed:   { a: 0.000074230, b: 1.707348, c: 1.16873,  r2: 0.973, rotulo: "Mata (FED)", conama: "fed" },
  cerradao:   { a: 0.000094001, b: 1.830398, c: 0.960913, r2: 0.964, rotulo: "Cerradão", conama: "cerrado" },
  cerrado_sr: { a: 0.000065661, b: 2.475293, c: 0.300022, r2: 0.981, rotulo: "Cerrado sensu restrito", conama: "cerrado" },
};

export const dapDeCap = (capCm) => capCm / Math.PI;

function coefs(fito, custom) {
  if (custom) return custom;
  const c = EQUACOES_VOLUME[fito];
  if (!c) throw new Error(`Fitofisionomia desconhecida: ${fito}`);
  return c;
}

export function volumeAereo(dapCm, alturaM, fito = "mata_fes", custom = null) {
  const c = coefs(fito, custom);
  return c.a * Math.pow(dapCm, c.b) * Math.pow(alturaM, c.c);
}

export function volumeFusteDeCap(capCm, alturaM, fito = "mata_fes", custom = null) {
  return volumeAereo(dapDeCap(capCm), alturaM, fito, custom);
}

export const tocosRaizes = (volAereo) => volAereo * FATOR_TOCOS_RAIZES;
export const volumeTotal = (volAereo) => volAereo * (1 + FATOR_TOCOS_RAIZES);
export const areaBasal = (dapCm) => Math.PI * Math.pow(dapCm / 200, 2);

// fustes: array de {cap_cm|cap, altura_m|altura}. Volume do indivíduo = soma dos fustes.
export function volumeIndividuo(fustes, fito = "mata_fes", custom = null) {
  let aereo = 0, ab = 0, n = 0;
  for (const f of fustes) {
    const cap = f.capCm ?? f.cap_cm ?? f.cap;
    const ht = f.alturaM ?? f.altura_m ?? f.altura;
    if (cap == null || ht == null) continue;
    aereo += volumeFusteDeCap(cap, ht, fito, custom);
    ab += areaBasal(dapDeCap(cap));
    n += 1;
  }
  return {
    n_fustes: n,
    area_basal: ab,
    vol_aereo: aereo,
    vol_tocos_raizes: tocosRaizes(aereo),
    vol_total: volumeTotal(aereo),
  };
}

// Erro amostral (ACS) de uma variável em m³/ha medida por parcela. Unidade = parcela: n>=2.
// volumesHa: array de m³/ha por parcela. opts: {areaTotalHa, areaParcelaHa, nivelPct, correcaoFinita, erroAlvoPct}.
export function erroAmostral(volumesHa, {
  areaTotalHa = null, areaParcelaHa = null, nivelPct = 90,
  correcaoFinita = false, erroAlvoPct = 10,
} = {}) {
  const n = volumesHa.length;
  if (n < 2) throw new Error("Erro amostral exige ao menos 2 parcelas (variância entre parcelas).");

  const media = volumesHa.reduce((a, b) => a + b, 0) / n;
  const variancia = volumesHa.reduce((a, v) => a + (v - media) ** 2, 0) / (n - 1);
  const desvio = Math.sqrt(variancia);
  const cvPct = media ? (100 * desvio) / media : NaN;

  let fc = 1;
  if (correcaoFinita && areaTotalHa && areaParcelaHa) {
    const nTotal = areaTotalHa / areaParcelaHa;
    fc = 1 - n / nTotal;
  }
  const erroPadrao = Math.sqrt((variancia / n) * fc);

  const t = tStudent(n, nivelPct);
  const erroAbs = t * erroPadrao;
  const erroRelPct = media ? (100 * erroAbs) / media : NaN;
  const nEstrela = erroAlvoPct ? (t * t * cvPct * cvPct) / (erroAlvoPct * erroAlvoPct) : NaN;

  return {
    n, gl: n - 1, media, variancia, desvio, cv_pct: cvPct,
    erro_padrao: erroPadrao, t, erro_abs: erroAbs, erro_rel_pct: erroRelPct,
    n_estrela: nEstrela, suficiente: erroRelPct <= erroAlvoPct,
    vol_total_estimado: areaTotalHa ? media * areaTotalHa : null,
    ic_inf: media - erroAbs, ic_sup: media + erroAbs,
  };
}
