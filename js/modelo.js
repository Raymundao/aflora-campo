// Modelo de domínio do inventário: fábricas, área da parcela, agregação de
// resultados por estrato (une os dados às funções de calculos.js) e formatação BR.
import { volumeIndividuo, erroAmostral, EQUACOES_VOLUME } from "./calculos.js";

export const ESTAGIOS = ["Inicial", "Médio", "Avançado"];

// Nome exibido do estrato = fitofisionomia (+ estágio, se houver).
export function rotuloEstrato(fitofisionomia, estagio) {
  const fito = EQUACOES_VOLUME[fitofisionomia]?.rotulo || fitofisionomia || "Estrato";
  return estagio ? `${fito} — ${estagio}` : fito;
}

let _seq = 0;
export const novoId = (pfx) => `${pfx}_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

export function novoInventario(nome = "Novo inventário") {
  const agora = Date.now();
  return {
    id: novoId("inv"),
    nome,
    criadoEm: agora,
    atualizadoEm: agora,
    config: {
      formaParcela: "circular",   // circular | retangular | manual
      raioM: 6,                   // Ø12 m → 113,1 m²
      ladoAM: null, ladoBM: null,
      areaParcelaM2: null,        // usado quando formaParcela === "manual"
      nivelPct: 90,               // 90 | 95 | 99
      correcaoFinita: false,
      erroAlvoPct: 10,
      dapMinCm: 5,                // critério de inclusão
      especies: [],               // autocomplete (lista esperada, editável)
    },
    estratos: [novoEstrato()],
    parcelas: [],
  };
}

export function novoEstrato(fitofisionomia = "mata_fes", estagio = "") {
  return {
    id: novoId("est"),
    fitofisionomia,
    estagio,
    nome: rotuloEstrato(fitofisionomia, estagio),
    areaTotalHa: null,
    coefsCustom: null,
  };
}
export function novaParcela(estratoId, rotulo = "") {
  return { id: novoId("par"), rotulo, estratoId, lat: null, lon: null, gpsEm: null, individuos: [] };
}
export function novoIndividuo(placa = "") {
  return { id: novoId("ind"), placa, especie: "", fustes: [novoFuste()] };
}
export function novoFuste() {
  return { capCm: null, alturaM: null };
}

// Área da parcela em hectares, derivada da forma escolhida.
export function areaParcelaHa(config) {
  if (config.formaParcela === "circular" && config.raioM) {
    return (Math.PI * config.raioM ** 2) / 10000;
  }
  if (config.formaParcela === "retangular" && config.ladoAM && config.ladoBM) {
    return (config.ladoAM * config.ladoBM) / 10000;
  }
  if (config.areaParcelaM2) return config.areaParcelaM2 / 10000;
  return null;
}

// Volume aéreo (m³) de uma parcela = soma do volume de todos os indivíduos/fustes.
export function volumeParcelaM3(parcela, estrato) {
  let aereo = 0;
  for (const ind of parcela.individuos) {
    aereo += volumeIndividuo(ind.fustes, estrato.fitofisionomia, estrato.coefsCustom).vol_aereo;
  }
  return aereo;
}

// DAP médio (cm) e altura média (m) da parcela — média sobre todos os fustes
// medidos (DAP = CAP/π). Atualiza ao vivo conforme entram CAP/altura.
export function mediasParcela(parcela) {
  let somaDap = 0, somaAlt = 0, n = 0;
  for (const ind of parcela.individuos) {
    for (const f of ind.fustes) {
      if (f.capCm == null || f.alturaM == null) continue;
      somaDap += f.capCm / Math.PI;
      somaAlt += f.alturaM;
      n += 1;
    }
  }
  return { dapMedio: n ? somaDap / n : null, alturaMedia: n ? somaAlt / n : null, nFustes: n };
}

// Resultado de erro amostral por estrato. A barra usa isso. Toda parcela com
// volume entra (feedback ao vivo); o erro só é calculado com n >= 2 parcelas.
export function resultadosPorEstrato(inv) {
  const aHa = areaParcelaHa(inv.config);
  return inv.estratos.map((est) => {
    const parcelas = inv.parcelas.filter((p) => p.estratoId === est.id);
    const volumesHa = aHa ? parcelas.map((p) => volumeParcelaM3(p, est) / aHa) : [];
    let erro = null;
    if (aHa && volumesHa.length >= 2) {
      erro = erroAmostral(volumesHa, {
        areaTotalHa: est.areaTotalHa,
        areaParcelaHa: aHa,
        nivelPct: inv.config.nivelPct,
        correcaoFinita: inv.config.correcaoFinita,
        erroAlvoPct: inv.config.erroAlvoPct,
      });
    }
    return { estrato: est, nParcelas: parcelas.length, volumesHa, erro };
  });
}

// Detecta indivíduos com volume atípico dentro do estrato (método IQR robusto:
// fora de [Q1 − k·IQR, Q3 + k·IQR]). Ajuda a flagrar erro de digitação de
// CAP/altura. Só sinaliza com amostra mínima (>=5 indivíduos no estrato).
export function outliersDoEstrato(inv, estratoId, k = 1.5) {
  const est = inv.estratos.find((e) => e.id === estratoId);
  const vols = [];
  for (const p of inv.parcelas) {
    if (p.estratoId !== estratoId) continue;
    for (const ind of p.individuos) {
      const v = volumeIndividuo(ind.fustes, est?.fitofisionomia).vol_aereo;
      if (v > 0) vols.push({ id: ind.id, v });
    }
  }
  const out = new Set();
  if (vols.length < 5) return out;
  const ord = vols.map((x) => x.v).sort((a, b) => a - b);
  const quantil = (p) => {
    const i = (ord.length - 1) * p;
    const lo = Math.floor(i);
    return ord[lo] + (ord[Math.ceil(i)] - ord[lo]) * (i - lo);
  };
  const q1 = quantil(0.25);
  const q3 = quantil(0.75);
  const iqr = q3 - q1;
  const limSup = q3 + k * iqr;
  const limInf = q1 - k * iqr;
  for (const x of vols) if (x.v > limSup || x.v < limInf) out.add(x.id);
  return out;
}

// Formatação numérica padrão Brasil (vírgula decimal, ponto de milhar).
export function fmtNum(v, casas = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Normaliza pra busca: sem acento, minúsculo. "Síparúna" -> "siparuna".
export const semAcento = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Lista única de espécies do inventário (config.especies ∪ nomes usados nos
// indivíduos), ordenada — fonte do autocomplete e base da futura tela de Espécies.
// `excluirId`: ignora o indivíduo em edição (pra não sugerir o que está sendo digitado).
export function especiesDoInventario(inv, excluirId = null) {
  const set = new Set((inv.config?.especies || []).map((s) => s.trim()).filter(Boolean));
  for (const p of inv.parcelas) {
    for (const ind of p.individuos) {
      if (ind.id === excluirId) continue;
      const v = (ind.especie || "").trim();
      if (v) set.add(v);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// Indivíduos da parcela ordenados pra exibição, SEM mutar o array (preserva a
// ordem de entrada). Retorna [{ ind, entrada }] — entrada = índice original.
export function individuosOrdenados(parcela, modo = "entrada") {
  const base = parcela.individuos.map((ind, i) => ({ ind, entrada: i }));
  if (modo === "placa") {
    base.sort((a, b) => {
      const pa = (a.ind.placa || "").trim(), pb = (b.ind.placa || "").trim();
      if (!pa) return pb ? 1 : a.entrada - b.entrada;   // sem placa vai pro fim
      if (!pb) return -1;
      return pa.localeCompare(pb, "pt-BR", { numeric: true });
    });
  } else if (modo === "especie") {
    base.sort((a, b) =>
      (a.ind.especie || "~").localeCompare(b.ind.especie || "~", "pt-BR") || a.entrada - b.entrada);
  }
  return base;
}
