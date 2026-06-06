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
    especies: [],   // registro de espécies adicionadas manualmente (tela Espécies)
  };
}

// Registro de espécies do inventário = nomes usados em indivíduos ∪ adicionados
// manualmente ∪ extras (ex.: espécies que têm foto). Ordenado.
export function registroEspecies(inv, nomesExtra = []) {
  const set = new Set();
  for (const p of inv.parcelas) {
    for (const ind of p.individuos) {
      const v = (ind.especie || "").trim();
      if (v) set.add(v);
    }
  }
  for (const n of (inv.especies || [])) { const v = (n || "").trim(); if (v) set.add(v); }
  for (const n of nomesExtra) { const v = (n || "").trim(); if (v) set.add(v); }
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function adicionarEspecie(inv, nome) {
  nome = (nome || "").trim();
  if (!nome) return;
  inv.especies = inv.especies || [];
  if (!inv.especies.includes(nome)) inv.especies.push(nome);
}

// Renomeia uma espécie em cascata: indivíduos + registro manual. As FOTOS são
// atualizadas no app (db.renomearRefKeyFotos). Retorna quantos indivíduos mudaram.
export function renomearEspecie(inv, antigo, novo) {
  antigo = (antigo || "").trim();
  novo = (novo || "").trim();
  if (!novo || antigo === novo) return 0;
  let n = 0;
  for (const p of inv.parcelas) {
    for (const ind of p.individuos) {
      if ((ind.especie || "").trim() === antigo) { ind.especie = novo; n++; }
    }
  }
  inv.especies = [...new Set((inv.especies || [])
    .map((s) => ((s || "").trim() === antigo ? novo : (s || "").trim()))
    .filter(Boolean))];
  if (!inv.especies.includes(novo)) inv.especies.push(novo);
  // migra o hábito (arbórea/não-arbórea) pro novo nome
  if (inv.especiesHabito && inv.especiesHabito[antigo] != null) {
    inv.especiesHabito[novo] = inv.especiesHabito[antigo];
    delete inv.especiesHabito[antigo];
  }
  return n;
}

// Hábito da espécie: "arborea" | "nao_arborea" | null (não classificada).
export function habitoEspecie(inv, nome) {
  return (inv.especiesHabito || {})[(nome || "").trim()] || null;
}
export function setHabitoEspecie(inv, nome, h) {
  nome = (nome || "").trim();
  if (!nome) return;
  inv.especiesHabito = inv.especiesHabito || {};
  if (h) inv.especiesHabito[nome] = h; else delete inv.especiesHabito[nome];
}

// metodo: "arboreo" (parcelas com indivíduos+fustes+volume) | "herbaceo"
// (parcelas 1×1 m com táxons + classe de cobertura Braun-Blanquet, CONAMA 423).
export function novoEstrato(fitofisionomia = "mata_fes", estagio = "", metodo = "arboreo") {
  return {
    id: novoId("est"),
    fitofisionomia,
    estagio,
    metodo,
    nome: rotuloEstrato(fitofisionomia, estagio),
    areaTotalHa: null,
    coefsCustom: null,
  };
}
export function novaParcela(estratoId, rotulo = "") {
  return { id: novoId("par"), rotulo, estratoId, lat: null, lon: null, gpsEm: null, individuos: [], taxons: [] };
}
export function novoIndividuo(placa = "") {
  return { id: novoId("ind"), placa, especie: "", fustes: [novoFuste()] };
}
export function novoFuste() {
  return { capCm: null, alturaM: null };
}

// ---------- estrato CENSO (pontos georreferenciados, estilo AlpineQuest) ----------
// Cada ponto = indivíduo com coordenada própria + fustes (multi-tronco). Vive em
// estrato.pontos (sem parcela, sem erro amostral). Volume pela equação do fito.
export function novoPontoCenso(lat = null, lon = null, alt = null) {
  return { id: novoId("pt"), placa: "", especie: "", lat, lon, alt, fustes: [novoFuste()] };
}
export function resultadosCenso(inv, estratoId) {
  const est = inv.estratos.find((e) => e.id === estratoId);
  const pontos = (est && est.pontos) || [];
  let volAereo = 0;
  for (const pt of pontos) volAereo += volumeIndividuo(pt.fustes, est.fitofisionomia, est.coefsCustom).vol_aereo;
  const especies = new Set(pontos.map((p) => (p.especie || "").trim()).filter(Boolean));
  const comCoord = pontos.filter((p) => p.lat != null && p.lon != null).length;
  return { nPontos: pontos.length, comCoord, volAereo, riqueza: especies.size };
}

// ---------- estrato herbáceo (Braun-Blanquet / CONAMA 423) ----------
export const BB_CLASSES = ["r", "+", "1", "2", "3", "4", "5"];
// ponto-médio de cobertura (%) de cada classe BB (Mueller-Dombois & Ellenberg)
export const BB_MIDPOINT = { r: 0.1, "+": 0.5, 1: 2.5, 2: 15, 3: 37.5, 4: 62.5, 5: 87.5 };
export const BB_DESC = {
  r: "solitário, cobertura ínfima", "+": "poucos, < 1%", 1: "abundante, 1–5%",
  2: "5–25%", 3: "25–50%", 4: "50–75%", 5: "75–100%",
};
export const ORIGENS_HERB = ["Nativa", "Exótica", "Ruderal"];
export function novoTaxon(nome = "") {
  return { id: novoId("tax"), nome, bb: null, origem: null };
}

// Agregação fitossociológica do estrato herbáceo (cobertura por ponto-médio BB).
// cobertura absoluta de um táxon = Σ(pontos-médios nas parcelas) / nº total de parcelas.
export function resultadosHerbaceo(inv, estratoId) {
  const parcelas = inv.parcelas.filter((p) => p.estratoId === estratoId);
  const nParc = parcelas.length;
  const mapa = new Map(); // nome -> { ocorre:Set, somaMid, origem }
  for (const p of parcelas) {
    for (const t of (p.taxons || [])) {
      const nome = (t.nome || "").trim();
      if (!nome) continue;
      let e = mapa.get(nome);
      if (!e) { e = { ocorre: new Set(), somaMid: 0, origem: null }; mapa.set(nome, e); }
      e.ocorre.add(p.id);
      if (t.bb && BB_MIDPOINT[t.bb] != null) e.somaMid += BB_MIDPOINT[t.bb];
      if (!e.origem && t.origem) e.origem = t.origem;
    }
  }
  const taxons = [...mapa.entries()].map(([nome, e]) => ({
    nome,
    nOcorre: e.ocorre.size,
    freqAbsPct: nParc ? (100 * e.ocorre.size) / nParc : 0,
    coberturaAbsPct: nParc ? e.somaMid / nParc : 0,
    origem: e.origem,
  })).sort((a, b) => b.coberturaAbsPct - a.coberturaAbsPct || a.nome.localeCompare(b.nome, "pt-BR"));
  const covTotal = taxons.reduce((s, t) => s + t.coberturaAbsPct, 0);
  const covNativa = taxons.filter((t) => t.origem === "Nativa").reduce((s, t) => s + t.coberturaAbsPct, 0);
  const covExotica = taxons.filter((t) => t.origem === "Exótica" || t.origem === "Ruderal").reduce((s, t) => s + t.coberturaAbsPct, 0);
  return {
    nParcelas: nParc, riqueza: taxons.length, taxons, covTotal, covNativa, covExotica,
    covNativaRelPct: covTotal ? (100 * covNativa) / covTotal : 0,
    covExoticaRelPct: covTotal ? (100 * covExotica) / covTotal : 0,
  };
}

// Táxons já usados no estrato herbáceo (autocomplete da tela de cobertura).
export function taxonsDoEstrato(inv, estratoId) {
  const set = new Set();
  for (const p of inv.parcelas) {
    if (p.estratoId !== estratoId) continue;
    for (const t of (p.taxons || [])) { const v = (t.nome || "").trim(); if (v) set.add(v); }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
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

// DAP médio (cm) e altura da maior árvore (m) da parcela. DAP = média de todos
// os fustes (DAP = CAP/π); altura = MÁXIMA (altura do dossel = estrato superior,
// não a média que inclui o sub-bosque). Atualiza ao vivo conforme entram dados.
export function mediasParcela(parcela) {
  let somaDap = 0, n = 0, alturaMax = null;
  for (const ind of parcela.individuos) {
    for (const f of ind.fustes) {
      if (f.capCm == null || f.alturaM == null) continue;
      somaDap += f.capCm / Math.PI;
      if (alturaMax == null || f.alturaM > alturaMax) alturaMax = f.alturaM;
      n += 1;
    }
  }
  return { dapMedio: n ? somaDap / n : null, alturaMaxima: alturaMax, nFustes: n };
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

// Espécies de fato REGISTRADAS no inventário = nomes atribuídos a indivíduos.
// (Não usa config.especies, que ficou poluído por digitação parcial na versão
// antiga.) Fonte do autocomplete e base da futura tela de Espécies.
// `excluirId`: ignora o indivíduo em edição (pra não sugerir o que se está digitando).
export function especiesDoInventario(inv, excluirId = null) {
  const set = new Set();
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
