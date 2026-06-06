// App de campo — UI (SPA vanilla). Navegação por estado, auto-save a cada
// alteração (IndexedDB), barra de erro amostral por estrato ao vivo.
import * as db from "./db.js";
import {
  novoInventario, novoEstrato, novaParcela, novoIndividuo, novoFuste,
  resultadosPorEstrato, areaParcelaHa, fmtNum, outliersDoEstrato,
  ESTAGIOS, mediasParcela, volumeParcelaM3,
  semAcento, especiesDoInventario, individuosOrdenados,
  registroEspecies, adicionarEspecie, renomearEspecie,
  BB_CLASSES, BB_MIDPOINT, BB_DESC, ORIGENS_HERB, novoTaxon,
  resultadosHerbaceo, taxonsDoEstrato,
  habitoEspecie, setHabitoEspecie,
  novoPontoCenso, resultadosCenso,
  novaTrilha, novoPoligono, areaAnelM2,
} from "./modelo.js";
import { volumeIndividuo, EQUACOES_VOLUME } from "./calculos.js";
import {
  exportarJSON, exportarCSV, exportarXLSX, prepararXLSX, baixar,
  temHerbaceo, exportarHerbaceoXLSX, exportarHerbaceoCSV,
  temCenso, exportarCensoKMZ, exportarCensoXLSX,
} from "./export.js";
import { comprimirImagem, carimbarTexto, urlDeBlob } from "./imagem.js";
import { criarZip } from "./zip.js";

const app = document.getElementById("app");
const APP_VERSION = "v39"; // manter em sincronia com o CACHE do sw.js
let inv = null; // inventário aberto

const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Fecha qualquer dropdown de autocomplete ao tocar fora dele (handler único).
document.addEventListener("click", (ev) => {
  $$(".ac-lista").forEach((l) => {
    const wrap = l.closest(".autocomplete");
    if (wrap && !wrap.contains(ev.target)) l.hidden = true;
  });
});

// ---------- lightbox de foto (toca a miniatura → abre em tela cheia) ----------
// Handler único delegado: qualquer <img> dentro de .foto-item abre ampliada.
function abrirLightbox(src) {
  const ov = document.createElement("div");
  ov.className = "lightbox";
  ov.innerHTML = `<img src="${src}" alt=""><button class="lightbox-fechar" aria-label="Fechar">✕</button>`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}
document.addEventListener("click", (ev) => {
  const img = ev.target.closest && ev.target.closest(".foto-item img");
  if (img && img.src) { ev.stopPropagation(); abrirLightbox(img.src); }
});

// Autocomplete custom (o <datalist> nativo não sugere no Android). Setinha abre
// a lista toda; digitar filtra por prefixo (depois substring), sem acento.
function ligarAutocomplete(input, toggle, lista, opcoes, onPick) {
  // termo vazio (setinha/foco) = todas; digitando = filtra por INÍCIO do nome.
  const render = (termo) => {
    const t = semAcento(termo);
    const itens = opcoes()
      .filter((nome) => !t || semAcento(nome).startsWith(t))
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .slice(0, 80);
    if (!itens.length) { lista.hidden = true; lista.innerHTML = ""; return; }
    lista.innerHTML = itens.map((nome) =>
      `<button type="button" class="ac-item" data-nome="${esc(nome)}"><i>${esc(nome)}</i></button>`).join("");
    lista.hidden = false;
    $$(".ac-item", lista).forEach((b) => {
      b.onclick = () => { input.value = b.dataset.nome; lista.hidden = true; onPick(b.dataset.nome); };
    });
  };
  // Setinha = mostra todas. Digitar = filtra pelo início. Campo vazio (apagou
  // tudo) = esconde a lista — só a setinha mostra tudo quando não há texto.
  toggle.onclick = () => { if (lista.hidden) render(""); else lista.hidden = true; };
  input.addEventListener("input", () => {
    if (input.value.trim()) render(input.value);
    else { lista.hidden = true; lista.innerHTML = ""; }
  });
}

// ---------- auto-save ----------
let debTimer = null;
function setStatus(txt, cls) {
  const b = $("#status-salvo");
  if (b) { b.textContent = txt; b.className = `status-salvo ${cls}`; }
}
function agendarSalvar() {
  setStatus("salvando…", "pendente");
  clearTimeout(debTimer);
  debTimer = setTimeout(salvarJa, 150);
}
async function salvarJa() {
  clearTimeout(debTimer);
  if (!inv) return;
  await db.salvarInventario(inv);
  setStatus("✓ salvo", "ok");
}
window.addEventListener("pagehide", () => { if (inv) db.salvarInventario(inv); });
window.addEventListener("visibilitychange", () => { if (document.hidden) salvarJa(); });

// ---------- navegação ----------
function header(titulo, voltarFn) {
  return `<header class="topo">
    ${voltarFn ? '<button class="btn-voltar" id="btn-voltar">‹</button>' : '<span class="logo">🌳</span>'}
    <h1>${esc(titulo)}</h1>
    <button class="btn-sol" id="btn-sol" aria-label="Modo sol (alto contraste)" title="Modo sol">☀️</button>
    <span class="status-salvo ok" id="status-salvo">✓ salvo</span>
  </header>`;
}
function ligarVoltar(fn) { const b = $("#btn-voltar"); if (b) b.onclick = fn; }

// ============================================================
// TELA 1 — lista de inventários
// ============================================================
async function telaInventarios() {
  inv = null;
  const lista = await db.listarInventarios();
  const cards = lista.map((i) => {
    const nParc = i.parcelas?.length || 0;
    const data = new Date(i.atualizadoEm).toLocaleString("pt-BR");
    return `<div class="card" data-id="${i.id}">
      <div class="card-corpo" data-abrir="${i.id}">
        <div class="card-nome">${esc(i.nome)}</div>
        <div class="card-sub">${nParc} parcela(s) · ${(i.estratos || []).length} estrato(s) · ${esc(data)}</div>
      </div>
      <div class="card-acoes">
        <button data-export-json="${i.id}" title="Exportar JSON">JSON</button>
        <button data-export-csv="${i.id}" title="Exportar CSV">CSV</button>
        <button data-excluir="${i.id}" class="perigo" title="Excluir">🗑</button>
      </div>
    </div>`;
  }).join("");
  app.innerHTML = `${header("Inventários")}
    <main>
      <img class="logo-home" src="./img/brasil_aflora.png" alt="Brasil Aflora — Inteligência Ambiental">
      <div class="acoes-linha">
        <button class="btn-grande" id="novo-inv">+ Novo inventário</button>
        <button class="btn-sec" id="importar">⬆ Importar</button>
      </div>
      <input type="file" id="file-import" accept=".json,application/json" hidden>
      <div class="cards">${cards || '<p class="vazio">Nenhum inventário ainda. Crie o primeiro.</p>'}</div>
      <p class="versao">Aflora Campo · ${APP_VERSION} · <button id="forcar-update" class="link-update">forçar atualização</button></p>
    </main>`;

  $("#novo-inv").onclick = async () => {
    inv = novoInventario();
    await db.salvarInventario(inv);
    telaConfig(); // abre a Config primeiro: nome + estratos (fitofisionomia/estágio)
  };
  // Importar JSON exportado (backup/restauração). Gera novo id pra não sobrescrever.
  $("#importar").onclick = () => $("#file-import").click();
  $("#file-import").onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!obj || !Array.isArray(obj.parcelas) || !Array.isArray(obj.estratos)) {
        throw new Error("o arquivo não parece um inventário exportado");
      }
      obj.id = "inv_" + Date.now().toString(36);
      obj.importadoEm = Date.now();
      await db.salvarInventario(obj);
      alert("Inventário importado: " + (obj.nome || obj.id));
      telaInventarios();
    } catch (err) {
      alert("Não consegui importar: " + (err?.message || err));
    }
  };
  $$("[data-abrir]").forEach((el) => { el.onclick = () => telaInventario(el.dataset.abrir); });
  $$("[data-excluir]").forEach((el) => {
    el.onclick = async () => {
      if (confirm("Excluir este inventário? Esta ação não pode ser desfeita.")) {
        await db.excluirInventario(el.dataset.excluir);
        telaInventarios();
      }
    };
  });
  $$("[data-export-json]").forEach((el) => {
    el.onclick = async () => exportarJSON(await db.obterInventario(el.dataset.exportJson));
  });
  $$("[data-export-csv]").forEach((el) => {
    el.onclick = async () => exportarCSV(await db.obterInventario(el.dataset.exportCsv));
  });
  // Escape hatch: limpa service worker + caches e recarrega do zero (resolve app
  // preso numa versão antiga). Os dados ficam (IndexedDB não é tocado).
  $("#forcar-update").onclick = async () => {
    if (!confirm("Forçar atualização? Precisa de internet. Seus dados não são apagados.")) return;
    try {
      const rs = (navigator.serviceWorker && await navigator.serviceWorker.getRegistrations()) || [];
      for (const r of rs) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
    } catch (e) { /* ignora */ }
    location.reload();
  };
}

// ============================================================
// TELA 2 — inventário (barra de erro + parcelas)
// ============================================================
// Rótulo do estrato com fitofisionomia + estágio bem explícitos.
// Fitofisionomias do método HERBÁCEO (sem equação de volume — só rótulo).
const HERB_FITOS = {
  cerrado_sr: "Cerrado sensu restrito", campo_cerrado: "Campo cerrado",
  campo_sujo: "Campo sujo", campo_limpo: "Campo limpo", campo_rupestre: "Campo rupestre",
};
const rotuloFito = (fito) => EQUACOES_VOLUME[fito]?.rotulo || HERB_FITOS[fito] || fito || "—";
const ehHerbaceo = (est) => est?.metodo === "herbaceo";
const ehCenso = (est) => est?.metodo === "censo";

function labelEstrato(est) {
  const fito = rotuloFito(est.fitofisionomia);
  const tag = ehHerbaceo(est) ? ' <span class="badge tag-herb">🌱 herbáceo</span>' : "";
  return `<b>${esc(fito)}</b>${tag}${est.estagio ? ` <small>· estágio ${esc(est.estagio)}</small>` : (ehHerbaceo(est) ? "" : " <small>· sem estágio</small>")}`;
}

function barraErro(r, alvo) {
  if (!r.erro) {
    return `<div class="estrato-card">
      <div class="estrato-nome">${labelEstrato(r.estrato)}</div>
      <div class="aguardando">${r.nParcelas} parcela(s) — precisa de 2+ pra calcular o erro</div>
    </div>`;
  }
  const e = r.erro.erro_rel_pct;
  const suf = e <= alvo;
  const cls = suf ? (e > alvo * 0.8 ? "amarelo" : "verde") : "vermelho";
  const larg = Math.min(e / (alvo * 1.5), 1) * 100;
  const nEst = Math.ceil(r.erro.n_estrela);
  const posAlvo = (1 / 1.5) * 100;
  return `<div class="estrato-card">
    <div class="estrato-nome">${labelEstrato(r.estrato)}
      <span class="badge ${suf ? "ok" : "nok"}">${suf ? "✓ suficiente" : "✗ acima de " + alvo + "%"}</span>
    </div>
    <div class="barra"><div class="barra-fill ${cls}" style="width:${larg}%"></div>
      <div class="barra-alvo" style="left:${posAlvo}%"></div></div>
    <div class="estrato-stats">erro <b>${fmtNum(e, 2)}%</b> (alvo ${fmtNum(alvo, 0)}%) ·
      ${r.nParcelas} parcelas <small>(precisa ~${Number.isFinite(nEst) ? nEst : "—"})</small> ·
      ${r.erro.vol_total_estimado != null ? fmtNum(r.erro.vol_total_estimado, 1) + " m³" : "defina a área do estrato"}</div>
  </div>`;
}

async function telaInventario(id) {
  inv = await db.obterInventario(id);
  if (!inv) return telaInventarios();
  // limpeza única: remove a lista de espécies poluída por digitação parcial da
  // versão antiga (autocomplete agora deriva só dos indivíduos registrados).
  if (inv.config?.especies?.length) { delete inv.config.especies; db.salvarInventario(inv); }
  const resultados = resultadosPorEstrato(inv);
  const fotos = await db.fotosDoInventario(id);
  const nEspecies = registroEspecies(inv, fotos.filter((f) => f.tipo === "especie").map((f) => f.refKey)).length;

  // cada estrato vira um card (erro + completude) → toca pra ver as parcelas dele
  const estratosHtml = resultados.length
    ? resultados.map((r) => cardEstrato(inv, r, completudeEstrato(inv, r.estrato, r, fotos))).join("")
    : '<p class="vazio">Nenhum estrato. Toque em ⚙ Config pra adicionar.</p>';

  app.innerHTML = `${header(inv.nome, telaInventarios)}
    <main>
      <div class="seg-nav">
        <button class="seg ativo">📋 Parcelas</button>
        <button class="seg" id="ir-especies">🌿 Espécies${nEspecies ? " (" + nEspecies + ")" : ""}</button>
      </div>
      <div class="acoes-linha"><button class="btn-sec largo" id="cfg">⚙ Config (estratos, área, erro)</button></div>
      <div class="cards">${estratosHtml}</div>
      <button class="btn-sec largo" id="ir-exportar">📤 Exportar / Compartilhar</button>
    </main>`;
  ligarVoltar(telaInventarios);
  $("#cfg").onclick = telaConfig;
  $("#ir-especies").onclick = () => telaEspecies(inv.id);
  $("#ir-exportar").onclick = () => telaExportar(inv.id);
  $$("[data-estrato]").forEach((el) => {
    el.onclick = () => {
      const e = inv.estratos.find((x) => x.id === el.dataset.estrato);
      if (ehCenso(e)) telaCenso(el.dataset.estrato); else telaParcelasDoEstrato(el.dataset.estrato);
    };
  });
}

// Completude do estrato (% pronto) = média de: erro amostral batido · campos das
// parcelas preenchidos · fotos de parcela nos 4 tipos. Também devolve `pendencias`
// (lista do que falta, por parcela) pro botão ⓘ explicar onde está o buraco.
function completudeEstrato(inv, estrato, resErro, fotos) {
  if (ehCenso(estrato)) return completudeCenso(estrato);
  if (ehHerbaceo(estrato)) return completudeHerbaceo(inv, estrato, fotos);
  const parcelas = inv.parcelas.filter((p) => p.estratoId === estrato.id);
  const alvo = inv.config.erroAlvoPct;
  const c1 = (resErro && resErro.erro && resErro.erro.erro_rel_pct <= alvo) ? 1 : 0;
  const pendencias = [];
  let completas = 0;
  for (const p of parcelas) {
    const rot = p.rotulo || "(sem rótulo)";
    const faltas = [];
    if (p.lat == null || p.lon == null) faltas.push("GPS não marcado");
    if (!p.individuos.length) {
      faltas.push("nenhum indivíduo");
    } else {
      p.individuos.forEach((ind, i) => {
        const nome = ind.placa || "#" + (i + 1);
        if (!(ind.especie || "").trim()) faltas.push(`indivíduo ${nome} sem espécie`);
        if (!ind.fustes.length || ind.fustes.some((f) => f.capCm == null || f.alturaM == null))
          faltas.push(`indivíduo ${nome} sem CAP/altura`);
      });
    }
    const cats = new Set(fotos.filter((f) => f.tipo === "parcela" && f.refKey === p.id).map((f) => f.categoria || "Geral"));
    const fotosFaltando = CATEGORIAS_FOTO.filter((c) => !cats.has(c));
    if (fotosFaltando.length) faltas.push(`fotos faltando: ${fotosFaltando.join(", ")}`);

    const gpsOk = p.lat != null && p.lon != null;
    const indOk = p.individuos.length >= 1 && p.individuos.every((ind) =>
      (ind.especie || "").trim() && ind.fustes.length >= 1
      && ind.fustes.every((f) => f.capCm != null && f.alturaM != null));
    if (gpsOk && indOk) completas++;
    if (faltas.length) pendencias.push({ parcela: rot, faltas });
  }
  const c2 = parcelas.length ? completas / parcelas.length : 0;
  let somaFotos = 0;
  for (const p of parcelas) {
    const cats = new Set(fotos.filter((f) => f.tipo === "parcela" && f.refKey === p.id).map((f) => f.categoria || "Geral"));
    somaFotos += CATEGORIAS_FOTO.filter((c) => cats.has(c)).length / CATEGORIAS_FOTO.length;
  }
  const c3 = parcelas.length ? somaFotos / parcelas.length : 0;
  // pendência de nível-estrato (erro amostral) entra no topo da lista
  if (!c1) {
    if (parcelas.length < 2) pendencias.unshift({ parcela: "Erro amostral", faltas: ["precisa de 2+ parcelas pra calcular"] });
    else if (resErro && resErro.erro) pendencias.unshift({ parcela: "Erro amostral", faltas: [`${fmtNum(resErro.erro.erro_rel_pct, 1)}% — acima do alvo de ${fmtNum(alvo, 0)}%`] });
    else pendencias.unshift({ parcela: "Erro amostral", faltas: ["defina a área da parcela (Config)"] });
  }
  return {
    pct: Math.round(((c1 + c2 + c3) / 3) * 100),
    itens: [
      { label: "Erro amostral", frac: c1 },
      { label: "Campos", frac: c2 },
      { label: "Fotos parcela", frac: c3 },
    ],
    pendencias,
  };
}

// Completude do estrato CENSO = % de pontos com coordenada + espécie + CAP/altura.
function completudeCenso(estrato) {
  const pontos = estrato.pontos || [];
  const pendencias = [];
  let ok = 0;
  pontos.forEach((pt, i) => {
    const faltas = [];
    if (pt.lat == null || pt.lon == null) faltas.push("sem coordenada");
    if (!(pt.especie || "").trim()) faltas.push("sem espécie");
    if (!pt.fustes.length || pt.fustes.some((f) => f.capCm == null || f.alturaM == null)) faltas.push("sem CAP/altura");
    if (!faltas.length) ok++; else pendencias.push({ parcela: pt.placa || ("ponto #" + (i + 1)), faltas });
  });
  if (!pontos.length) pendencias.push({ parcela: "Censo", faltas: ["nenhum ponto ainda"] });
  const frac = pontos.length ? ok / pontos.length : 0;
  return { pct: Math.round(frac * 100), itens: [{ label: "Pontos completos", frac }], pendencias };
}

// Completude do estrato HERBÁCEO = média de (campos das parcelas: GPS + táxons
// com nome/BB/origem) · (foto da parcela). Sem erro amostral.
function completudeHerbaceo(inv, estrato, fotos) {
  const parcelas = inv.parcelas.filter((p) => p.estratoId === estrato.id);
  const pendencias = [];
  let completas = 0, comFoto = 0;
  for (const p of parcelas) {
    const rot = p.rotulo || "(sem rótulo)";
    const faltas = [];
    if (p.lat == null || p.lon == null) faltas.push("GPS não marcado");
    const taxons = p.taxons || [];
    if (!taxons.length) {
      faltas.push("nenhum táxon");
    } else {
      const semNome = taxons.filter((t) => !(t.nome || "").trim()).length;
      const semBB = taxons.filter((t) => !t.bb).length;
      const semOrig = taxons.filter((t) => !t.origem).length;
      if (semNome) faltas.push(`${semNome} táxon(s) sem nome`);
      if (semBB) faltas.push(`${semBB} táxon(s) sem classe BB`);
      if (semOrig) faltas.push(`${semOrig} táxon(s) sem origem`);
    }
    const temFoto = fotos.some((f) => f.tipo === "parcela" && f.refKey === p.id);
    if (!temFoto) faltas.push("sem foto da parcela");
    const gpsOk = p.lat != null && p.lon != null;
    const taxOk = taxons.length >= 1 && taxons.every((t) => (t.nome || "").trim() && t.bb && t.origem);
    if (gpsOk && taxOk) completas++;
    if (temFoto) comFoto++;
    if (faltas.length) pendencias.push({ parcela: rot, faltas });
  }
  const c2 = parcelas.length ? completas / parcelas.length : 0;
  const c3 = parcelas.length ? comFoto / parcelas.length : 0;
  if (!parcelas.length) pendencias.push({ parcela: "Estrato herbáceo", faltas: ["nenhuma parcela ainda"] });
  return {
    pct: Math.round(((c2 + c3) / 2) * 100),
    itens: [{ label: "Campos", frac: c2 }, { label: "Fotos", frac: c3 }],
    pendencias,
  };
}

function barraCompletude(comp) {
  const cls = comp.pct >= 100 ? "verde" : comp.pct >= 60 ? "amarelo" : "vermelho";
  const itens = comp.itens.map((i) =>
    `<span class="compl-item ${i.frac >= 1 ? "ok" : "pend"}">${i.frac >= 1 ? "✓" : Math.round(i.frac * 100) + "%"} ${i.label}</span>`).join("");
  const pend = comp.pendencias || [];
  // ⓘ expansível (nativo <details>): lista onde estão os buracos, por parcela.
  const detalhe = pend.length
    ? `<details class="compl-det" onclick="event.stopPropagation()">
        <summary>ⓘ o que falta (${pend.length})</summary>
        <ul class="compl-faltas">${pend.map((d) =>
          `<li><b>${esc(d.parcela)}</b>: ${esc(d.faltas.join("; "))}</li>`).join("")}</ul>
      </details>`
    : "";
  return `<div class="compl">
    <div class="compl-top">Completude: <b>${comp.pct}%</b></div>
    <div class="barra"><div class="barra-fill ${cls}" style="width:${comp.pct}%"></div></div>
    <div class="compl-itens">${itens}</div>
    ${detalhe}
  </div>`;
}

// Card de um estrato na tela do inventário: erro + completude, toca pra abrir as parcelas.
function cardEstrato(inv, r, comp) {
  const alvo = inv.config.erroAlvoPct;
  let erro;
  if (ehCenso(r.estrato)) {
    const cc = resultadosCenso(inv, r.estrato.id);
    erro = `<div class="estrato-stats">🗺️ censo · <b>${cc.nPontos}</b> ponto(s) · riqueza <b>${cc.riqueza}</b> · ${fmtNum(cc.volAereo, 3)} m³</div>`;
  } else if (ehHerbaceo(r.estrato)) {
    const h = resultadosHerbaceo(inv, r.estrato.id);
    erro = `<div class="estrato-stats">${h.nParcelas} parcela(s) 1×1 m · riqueza <b>${h.riqueza}</b> táxon(s)${h.covTotal ? ` · nativa <b>${fmtNum(h.covNativaRelPct, 0)}%</b> / exót.+rud. <b>${fmtNum(h.covExoticaRelPct, 0)}%</b> da cobertura` : ""}</div>`;
  } else if (!r.erro) {
    erro = `<div class="aguardando">${r.nParcelas} parcela(s) — erro a partir de 2</div>`;
  } else {
    const e = r.erro.erro_rel_pct;
    const suf = e <= alvo;
    const cls = suf ? (e > alvo * 0.8 ? "amarelo" : "verde") : "vermelho";
    const larg = Math.min(e / (alvo * 1.5), 1) * 100;
    const posAlvo = (1 / 1.5) * 100;
    erro = `<div class="barra"><div class="barra-fill ${cls}" style="width:${larg}%"></div><div class="barra-alvo" style="left:${posAlvo}%"></div></div>
      <div class="estrato-stats">erro <b>${fmtNum(e, 2)}%</b> (alvo ${fmtNum(alvo, 0)}%) · ${r.nParcelas} parc. <small>(precisa ~${Math.ceil(r.erro.n_estrela)})</small></div>`;
  }
  return `<div class="card estrato-card" data-estrato="${r.estrato.id}">
    <div class="estrato-nome">${labelEstrato(r.estrato)} <span class="seta-ir">›</span></div>
    ${erro}
    ${barraCompletude(comp)}
  </div>`;
}

// TELA — parcelas de UM estrato (entra aqui depois de escolher o fito/estágio)
async function telaParcelasDoEstrato(estratoId) {
  if (!inv) return telaInventarios();
  const estrato = inv.estratos.find((e) => e.id === estratoId);
  if (!estrato) return telaInventario(inv.id);
  const aHa = areaParcelaHa(inv.config);
  const fotos = await db.fotosDoInventario(inv.id);
  const fotosPorParc = {};
  for (const f of fotos) if (f.tipo === "parcela") fotosPorParc[f.refKey] = (fotosPorParc[f.refKey] || 0) + 1;
  const r = resultadosPorEstrato(inv).find((x) => x.estrato.id === estratoId);
  const comp = completudeEstrato(inv, estrato, r, fotos);
  const herb = ehHerbaceo(estrato);
  const parcelas = inv.parcelas.filter((p) => p.estratoId === estratoId);
  const parcelasHtml = parcelas.length
    ? parcelas.map((p) => {
        const nf = fotosPorParc[p.id] || 0;
        let sub;
        if (herb) {
          const nt = (p.taxons || []).length;
          sub = `${nt} táxon(s)${p.lat != null ? " · 📍" : ""}`;
        } else {
          const volM3 = p.individuos.reduce((s, ind) => s + volumeIndividuo(ind.fustes, estrato.fitofisionomia).vol_aereo, 0);
          const mha = aHa ? volM3 / aHa : null;
          sub = `${p.individuos.length} indiv. · ${fmtNum(volM3, 4)} m³${mha != null ? " · " + fmtNum(mha, 1) + " m³/ha" : ""}${p.lat != null ? " · 📍" : ""}`;
        }
        return `<div class="card">
          <div class="card-corpo" data-parc="${p.id}">
            <div class="card-nome">${esc(p.rotulo || "(sem rótulo)")}</div>
            <div class="card-sub">${sub}</div>
          </div>
          <div class="card-acoes">
            <button class="btn-foto" data-fotos-parc="${p.id}" title="Fotos da parcela">📷${nf ? " " + nf : ""}</button>
            <button class="btn-foto perigo-icone" data-del-parc="${p.id}" title="Excluir parcela">🗑</button>
          </div></div>`;
      }).join("")
    : '<p class="vazio">Nenhuma parcela neste estrato. Toque em "+ Nova parcela".</p>';

  const painelTopo = herb
    ? `<div class="erro-estrato-box neutro">${(() => { const h = resultadosHerbaceo(inv, estratoId); return `riqueza <b>${h.riqueza}</b> táxon(s) em ${h.nParcelas} parcela(s)${h.covTotal ? ` · cobertura nativa <b>${fmtNum(h.covNativaRelPct, 0)}%</b> · exót./ruderal <b>${fmtNum(h.covExoticaRelPct, 0)}%</b>` : ""}`; })()}</div>`
    : `<section class="painel-erro">${barraErro(r, inv.config.erroAlvoPct)}</section>`;

  app.innerHTML = `${header(rotuloFito(estrato.fitofisionomia) || "Estrato", () => telaInventario(inv.id))}
    <main>
      <div class="info">${labelEstrato(estrato)}</div>
      ${painelTopo}
      ${barraCompletude(comp)}
      <button class="btn-grande" id="nova-parc">+ Nova parcela${herb ? " (1×1 m)" : ""}</button>
      <div class="cards">${parcelasHtml}</div>
    </main>`;
  ligarVoltar(() => telaInventario(inv.id));
  $("#nova-parc").onclick = async () => {
    const p = novaParcela(estratoId, "P" + String(inv.parcelas.length + 1).padStart(2, "0"));
    inv.parcelas.push(p);
    await salvarJa();
    if (herb) telaParcelaHerbaceo(p.id); else telaParcela(p.id);
  };
  $$("[data-fotos-parc]").forEach((el) => { el.onclick = () => telaFotosParcela(el.dataset.fotosParc); });
  $$("[data-parc]").forEach((el) => { el.onclick = () => herb ? telaParcelaHerbaceo(el.dataset.parc) : telaParcela(el.dataset.parc); });
  $$("[data-del-parc]").forEach((el) => {
    el.onclick = async () => {
      const pid = el.dataset.delParc;
      const p = inv.parcelas.find((x) => x.id === pid);
      if (!p) return;
      if (!confirm(`Excluir a parcela "${p.rotulo || ""}" e suas fotos? Não dá pra desfazer.`)) return;
      inv.parcelas = inv.parcelas.filter((x) => x.id !== pid);
      const fts = (await db.fotosDoInventario(inv.id)).filter((f) => f.tipo === "parcela" && f.refKey === pid);
      for (const f of fts) await db.excluirFoto(f.id);
      await salvarJa();
      telaParcelasDoEstrato(estratoId);
    };
  });
}

// ============================================================
// TELA — Exportar / Compartilhar (consolidada pra não poluir o inventário)
// ============================================================
function telaExportar(invId) {
  app.innerHTML = `${header("Exportar / Compartilhar", () => telaInventario(invId))}
    <main>
      <h3 class="sec-export">Planilha de dados</h3>
      <div class="acoes-linha wrap">
        <button class="btn-sec" id="exp-xlsx">⬇ XLSX</button>
        <button class="btn-sec" id="exp-csv">⬇ CSV</button>
        <button class="btn-sec" id="exp-json">⬇ JSON (backup)</button>
      </div>
      <button class="btn-grande" id="prep-share">↗ Preparar p/ compartilhar (XLSX)</button>
      <div id="share-panel"></div>
      ${temHerbaceo(inv) ? `
      <h3 class="sec-export">Estrato herbáceo (Braun-Blanquet)</h3>
      <div class="acoes-linha wrap">
        <button class="btn-sec" id="exp-herb-xlsx">⬇ XLSX</button>
        <button class="btn-sec" id="exp-herb-csv">⬇ CSV</button>
      </div>` : ""}
      ${temCenso(inv) ? `
      <h3 class="sec-export">Censo (pontos georreferenciados)</h3>
      <div class="acoes-linha wrap">
        <button class="btn-sec" id="exp-censo-kmz">⬇ KMZ</button>
        <button class="btn-sec" id="exp-censo-xlsx">⬇ XLSX</button>
      </div>` : ""}

      <h3 class="sec-export">Fotos (ZIP)</h3>
      <div class="acoes-linha wrap">
        <button class="btn-sec" id="exp-fotos-esp2">📷 Espécies</button>
        <button class="btn-sec" id="exp-fotos-parc">📷 Parcelas</button>
      </div>
    </main>`;
  ligarVoltar(() => telaInventario(invId));
  $("#exp-json").onclick = () => exportarJSON(inv);
  $("#exp-csv").onclick = () => exportarCSV(inv);
  $("#exp-xlsx").onclick = () => exportarXLSX(inv);
  if (temHerbaceo(inv)) {
    $("#exp-herb-xlsx").onclick = () => exportarHerbaceoXLSX(inv);
    $("#exp-herb-csv").onclick = () => exportarHerbaceoCSV(inv);
  }
  if (temCenso(inv)) {
    $("#exp-censo-kmz").onclick = () => exportarCensoKMZ(inv);
    $("#exp-censo-xlsx").onclick = () => exportarCensoXLSX(inv);
  }
  $("#exp-fotos-esp2").onclick = () => exportarZipEspecies(invId);
  $("#exp-fotos-parc").onclick = () => exportarZipParcelas(invId);
  // Compartilhar em 2 passos (padrão AlpineQuest): "Preparar" MONTA o arquivo;
  // "Enviar" dispara navigator.share — gesto isolado, sem trabalho pesado antes.
  $("#prep-share").onclick = () => {
    const panel = $("#share-panel");
    panel.innerHTML = '<div class="info">Montando a planilha…</div>';
    setTimeout(() => {
      let dados;
      try { dados = prepararXLSX(inv); }
      catch (e) { panel.innerHTML = `<div class="info">Erro ao montar: ${esc(e?.message || e)}</div>`; return; }
      panel.innerHTML = `<div class="share-pronto">
        <div class="info">✓ Planilha pronta: <b>${esc(dados.nome)}</b></div>
        <div class="acoes-linha">
          <button class="btn-grande destaque" id="enviar">↗ Enviar pra um app</button>
          <button class="btn-sec" id="baixar-share">⬇ Baixar</button>
        </div>
      </div>`;
      $("#enviar").onclick = () => {
        const { nome, blob, file, mime } = dados;
        if (navigator.share) {
          navigator.share({ files: [file] }).catch((e) => {
            if (e && e.name === "AbortError") return; // usuário fechou o menu
            baixar(nome, blob, mime);
            alert("Seu navegador bloqueia anexar arquivo no compartilhar — então baixei a planilha "
              + "na pasta Downloads. Abra o app Downloads/Arquivos e compartilhe de lá pro WhatsApp.");
          });
        } else {
          baixar(nome, blob, mime);
          alert("Baixei a planilha na pasta Downloads — compartilhe de lá.");
        }
      };
      $("#baixar-share").onclick = () => baixar(dados.nome, dados.blob, dados.mime);
    }, 30);
  };
}

// ============================================================
// TELA 3 — config do inventário
// ============================================================
function telaConfig() {
  const c = inv.config;
  const fitoOpts = (sel, metodo) => Object.entries(metodo === "herbaceo" ? HERB_FITOS : EQUACOES_VOLUME)
    .map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(typeof v === "string" ? v : v.rotulo)}</option>`).join("");
  const estagioOpts = (sel) => ['<option value="">— (sem estágio)</option>']
    .concat(ESTAGIOS.map((s) => `<option value="${s}" ${s === sel ? "selected" : ""}>${s}</option>`)).join("");
  const metodoOpts = (sel) => [["arboreo", "Arbóreo (parcelas · CAP/altura/volume)"], ["herbaceo", "Herbáceo (1×1 m · Braun-Blanquet)"], ["censo", "Censo (mapa · pontos georreferenciados)"]]
    .map(([k, t]) => `<option value="${k}" ${k === (sel || "arboreo") ? "selected" : ""}>${t}</option>`).join("");
  const estratosHtml = inv.estratos.map((e) => `<div class="estrato-edit" data-est="${e.id}">
    <div class="estrato-titulo">${esc(rotuloFito(e.fitofisionomia))}${ehHerbaceo(e) ? " · herbáceo" : ehCenso(e) ? " · censo" : (e.estagio ? " — " + esc(e.estagio) : "")}</div>
    <label>Método de levantamento<select class="e-metodo" data-est="${e.id}">${metodoOpts(e.metodo)}</select></label>
    <div class="linha2">
      <label>Fitofisionomia<select class="e-fito" data-est="${e.id}">${fitoOpts(e.fitofisionomia, e.metodo)}</select></label>
      <label>Estágio sucessional<select class="e-estagio" data-est="${e.id}">${estagioOpts(e.estagio)}</select></label>
    </div>
    <div class="linha2">
      ${ehHerbaceo(e)
        ? '<div class="info" style="flex:1;margin:0">Parcela <b>1×1 m</b>; cobertura por classe Braun-Blanquet. CONAMA 423 (pós-campo).</div>'
        : ehCenso(e)
        ? '<div class="info" style="flex:1;margin:0">Censo: <b>pontos no mapa</b> (sem parcela, sem erro amostral). Volume pela equação do fito.</div>'
        : `<label>Área total (ha)<input type="number" step="0.0001" class="e-area" data-est="${e.id}" value="${e.areaTotalHa ?? ""}"></label>`}
      ${inv.estratos.length > 1 ? `<button class="perigo del-est" data-est="${e.id}">🗑</button>` : ""}
    </div></div>`).join("");

  app.innerHTML = `${header("Configuração", () => telaInventario(inv.id))}
    <main class="form">
      <label class="campo">Nome do inventário
        <input id="cfg-nome" value="${esc(inv.nome)}"></label>

      <h3>Estratos</h3>
      <div class="info">Cada estrato = uma <b>fitofisionomia + estágio</b>. Adicione quantos precisar (ex.: Mata FES Inicial, Mata FES Médio, Cerradão…). Cada parcela é vinculada a um estrato.</div>
      <div id="estratos">${estratosHtml}</div>
      <button class="btn-sec" id="add-est">+ Adicionar estrato</button>

      <h3>Parcela</h3>
      <label class="campo">Forma
        <select id="cfg-forma">
          <option value="circular" ${c.formaParcela === "circular" ? "selected" : ""}>Circular (raio)</option>
          <option value="retangular" ${c.formaParcela === "retangular" ? "selected" : ""}>Retangular (lados)</option>
          <option value="manual" ${c.formaParcela === "manual" ? "selected" : ""}>Área manual (m²)</option>
        </select></label>
      <div id="dims-parc"></div>
      <div class="info" id="area-info"></div>

      <h3>Erro amostral</h3>
      <label class="campo">Nível de probabilidade
        <select id="cfg-nivel">
          <option value="90" ${c.nivelPct === 90 ? "selected" : ""}>90%</option>
          <option value="95" ${c.nivelPct === 95 ? "selected" : ""}>95%</option>
          <option value="99" ${c.nivelPct === 99 ? "selected" : ""}>99%</option>
        </select></label>
      <label class="campo">Erro-alvo (%)<input id="cfg-alvo" type="number" step="0.5" value="${c.erroAlvoPct}"></label>
      <label class="check"><input type="checkbox" id="cfg-correcao" ${c.correcaoFinita ? "checked" : ""}> Correção de população finita</label>
      <label class="campo">Critério de inclusão — DAP mínimo (cm)<input id="cfg-dapmin" type="number" step="0.5" value="${c.dapMinCm}"></label>
    </main>`;
  ligarVoltar(() => telaInventario(inv.id));

  function renderDims() {
    const box = $("#dims-parc");
    if (c.formaParcela === "circular") {
      box.innerHTML = `<label class="campo">Raio (m)<input id="d-raio" type="number" step="0.1" value="${c.raioM ?? ""}"></label>`;
      $("#d-raio").oninput = (e) => { c.raioM = parseFloat(e.target.value) || null; mostrarArea(); agendarSalvar(); };
    } else if (c.formaParcela === "retangular") {
      box.innerHTML = `<div class="linha2"><label>Lado A (m)<input id="d-a" type="number" step="0.1" value="${c.ladoAM ?? ""}"></label>
        <label>Lado B (m)<input id="d-b" type="number" step="0.1" value="${c.ladoBM ?? ""}"></label></div>`;
      $("#d-a").oninput = (e) => { c.ladoAM = parseFloat(e.target.value) || null; mostrarArea(); agendarSalvar(); };
      $("#d-b").oninput = (e) => { c.ladoBM = parseFloat(e.target.value) || null; mostrarArea(); agendarSalvar(); };
    } else {
      box.innerHTML = `<label class="campo">Área da parcela (m²)<input id="d-m2" type="number" step="0.1" value="${c.areaParcelaM2 ?? ""}"></label>`;
      $("#d-m2").oninput = (e) => { c.areaParcelaM2 = parseFloat(e.target.value) || null; mostrarArea(); agendarSalvar(); };
    }
  }
  function mostrarArea() {
    const ha = areaParcelaHa(c);
    $("#area-info").textContent = ha ? `Área da parcela: ${fmtNum(ha * 10000, 2)} m² = ${fmtNum(ha, 4)} ha` : "Informe as dimensões da parcela.";
  }
  renderDims(); mostrarArea();

  $("#cfg-nome").oninput = (e) => { inv.nome = e.target.value; agendarSalvar(); };
  $("#cfg-forma").onchange = (e) => { c.formaParcela = e.target.value; renderDims(); mostrarArea(); agendarSalvar(); };
  $("#cfg-nivel").onchange = (e) => { c.nivelPct = parseInt(e.target.value, 10); agendarSalvar(); };
  $("#cfg-alvo").oninput = (e) => { c.erroAlvoPct = parseFloat(e.target.value) || 10; agendarSalvar(); };
  $("#cfg-correcao").onchange = (e) => { c.correcaoFinita = e.target.checked; agendarSalvar(); };
  $("#cfg-dapmin").oninput = (e) => { c.dapMinCm = parseFloat(e.target.value) || 0; agendarSalvar(); };
  $("#add-est").onclick = async () => { inv.estratos.push(novoEstrato()); await salvarJa(); telaConfig(); };
  $$(".e-area").forEach((el) => { el.oninput = () => { estPorId(el.dataset.est).areaTotalHa = parseFloat(el.value) || null; agendarSalvar(); }; });
  const aplicaEstrato = (el, campo) => {
    const e = estPorId(el.dataset.est);
    e[campo] = el.value;
    e.nome = rotuloFito(e.fitofisionomia) + (ehHerbaceo(e) ? "" : (e.estagio ? " — " + e.estagio : ""));
    const t = document.querySelector(`.estrato-edit[data-est="${e.id}"] .estrato-titulo`);
    if (t) t.textContent = e.nome;
    agendarSalvar();
  };
  $$(".e-fito").forEach((el) => { el.onchange = () => aplicaEstrato(el, "fitofisionomia"); });
  $$(".e-estagio").forEach((el) => { el.onchange = () => aplicaEstrato(el, "estagio"); });
  // trocar o método troca as fitofisionomias disponíveis → re-render do Config.
  $$(".e-metodo").forEach((el) => {
    el.onchange = async () => {
      const e = estPorId(el.dataset.est);
      e.metodo = el.value;
      // ajusta a fitofisionomia pro novo método se a atual não existe nele
      const validas = e.metodo === "herbaceo" ? Object.keys(HERB_FITOS) : Object.keys(EQUACOES_VOLUME);
      if (!validas.includes(e.fitofisionomia)) e.fitofisionomia = e.metodo === "herbaceo" ? "cerrado_sr" : "mata_fes";
      e.nome = rotuloFito(e.fitofisionomia) + (ehHerbaceo(e) ? "" : (e.estagio ? " — " + e.estagio : ""));
      await salvarJa();
      telaConfig();
    };
  });
  $$(".del-est").forEach((el) => {
    el.onclick = async () => {
      const eid = el.dataset.est;
      if (inv.parcelas.some((p) => p.estratoId === eid)) { alert("Há parcelas neste estrato. Mova ou exclua-as primeiro."); return; }
      inv.estratos = inv.estratos.filter((x) => x.id !== eid);
      await salvarJa(); telaConfig();
    };
  });
}
function estPorId(id) { return inv.estratos.find((e) => e.id === id); }

// ============================================================
// ============================================================
// CONAMA 392 — classificação de estágio sucessional (FES/FOD e FED)
// ============================================================
const CONAMA_LIMIARES = {
  fes_fod: {
    rotulo: "Floresta Estacional Semidecidual / Ombrófila (FES/FOD)",
    altura: { inicial: "até 5 m", medio: "5–12 m", avancado: "> 12 m", lo: 5, hi: 12 },
    dap: { inicial: "até 10 cm", medio: "10–20 cm", avancado: "> 20 cm", lo: 10, hi: 20, cinzaLo: 18, cinzaHi: 20 },
  },
  fed: {
    rotulo: "Floresta Estacional Decidual (FED)",
    altura: { inicial: "até 3 m", medio: "3–6 m", avancado: "> 6 m", lo: 3, hi: 6 },
    dap: { inicial: "até 8 cm", medio: "8–15 cm", avancado: "> 15 cm", lo: 8, hi: 15, cinzaLo: null, cinzaHi: null },
  },
};
// Parâmetros qualitativos (iguais entre fisionomias). Indicadoras é tratado à parte.
const CONAMA_QUALI = [
  { key: "estratificacao", label: "Estratificação", inicial: "sem estratificação", medio: "dossel + sub-bosque", avancado: "dossel + sub-dossel + sub-bosque" },
  { key: "grupo", label: "Grupo sucessional", inicial: "pioneiras", medio: "pioneiras + secundárias", avancado: "secundárias" },
  { key: "trepadeiras", label: "Trepadeiras", inicial: "herbáceas", medio: "herbáceas/lenhosas", avancado: "lenhosas" },
  { key: "epifitas", label: "Epífitas", inicial: "líquens/briófitas", medio: "angiospermas", avancado: "alta riqueza" },
  { key: "dominancia", label: "Dominância de espécies", inicial: "alta", medio: "média", avancado: "baixa" },
  { key: "serrapilheira", label: "Serrapilheira", inicial: "rala", medio: "média", avancado: "densa" },
];
const grupoConama = (estrato) => EQUACOES_VOLUME[estrato?.fitofisionomia]?.conama || null;

function classeAltura(altura, g) {
  if (altura == null) return null;
  const a = CONAMA_LIMIARES[g].altura;
  return altura <= a.lo ? "inicial" : altura <= a.hi ? "medio" : "avancado";
}
function classeDap(dapMedio, g) {
  if (dapMedio == null) return null;
  const d = CONAMA_LIMIARES[g].dap;
  if (d.cinzaLo != null && dapMedio >= d.cinzaLo && dapMedio <= d.cinzaHi) return "ambiguo"; // zona cinza 18–20
  return dapMedio <= d.lo ? "inicial" : dapMedio <= d.hi ? "medio" : "avancado";
}

// Classifica o estágio: maioria dos 9 parâmetros. DAP em zona cinza e indicadoras
// "secundárias" são ambíguos (médio↔avançado): seguem a maioria dos firmes;
// empate (aqui ou no geral) → AVANÇADO.
function classificarEstagio(p, estrato) {
  const g = grupoConama(estrato);
  if (g !== "fes_fod" && g !== "fed") return null; // cerrado: CONAMA 423 (depois)
  const mp = mediasParcela(p);
  const c = p.conama || {};
  // medições têm prioridade; sem fustes medidos, cai no valor manual informado
  const altEf = mp.alturaMaxima != null ? mp.alturaMaxima : (c.alturaManual != null ? c.alturaManual : null);
  const dapEf = mp.dapMedio != null ? mp.dapMedio : (c.dapManual != null ? c.dapManual : null);
  const votos = [classeAltura(altEf, g), classeDap(dapEf, g)];
  for (const q of CONAMA_QUALI) votos.push(c[q.key] || null);
  votos.push(c.indicadoras === "pioneiras" ? "inicial" : c.indicadoras === "secundarias" ? "ambiguo" : null);
  const cont = (arr, s) => arr.filter((v) => v === s).length;
  const firmes = votos.filter((v) => v && v !== "ambiguo");
  const resolvidos = votos.map((v) => v !== "ambiguo" ? v
    : (cont(firmes, "avancado") >= cont(firmes, "medio") ? "avancado" : "medio")).filter(Boolean);
  if (!resolvidos.length) return null;
  let melhor = null, max = -1;
  for (const s of ["avancado", "medio", "inicial"]) { // ordem garante empate → avançado
    const n = cont(resolvidos, s);
    if (n > max) { max = n; melhor = s; }
  }
  return { estagio: melhor, n: resolvidos.length, total: 9,
    votos: { inicial: cont(resolvidos, "inicial"), medio: cont(resolvidos, "medio"), avancado: cont(resolvidos, "avancado") } };
}
const ROTULO_ESTAGIO = { inicial: "Inicial", medio: "Médio", avancado: "Avançado" };

// TELA — formulário CONAMA 392 de estágio sucessional da parcela
function telaConama(parcelaId) {
  const p = inv.parcelas.find((x) => x.id === parcelaId);
  if (!p) return telaParcela(parcelaId);
  const estrato = estPorId(p.estratoId);
  const g = grupoConama(estrato);
  p.conama = p.conama || {};
  const c = p.conama;
  const mp = mediasParcela(p);

  if (g !== "fes_fod" && g !== "fed") {
    app.innerHTML = `${header("Estágio sucessional", () => telaParcela(parcelaId))}
      <main><div class="info">A classificação CONAMA 392 é pra fisionomias florestais (FES/FOD/FED).
      Este estrato é <b>${esc(EQUACOES_VOLUME[estrato?.fitofisionomia]?.rotulo || "—")}</b> (cerrado/savânica → CONAMA 423, em breve).</div></main>`;
    ligarVoltar(() => telaParcela(parcelaId));
    return;
  }

  const lim = CONAMA_LIMIARES[g];
  const opcoesParam = (key, desc) => ["inicial", "medio", "avancado"].map((est) =>
    `<button class="conama-opt ${c[key] === est ? "sel" : ""}" data-param="${key}" data-est="${est}">
       <b>${ROTULO_ESTAGIO[est]}</b><span>${esc(desc[est])}</span></button>`).join("");
  // altura/DAP: auto a partir das médias medidas; sem fustes medidos, usa o manual.
  const autoLinha = (label, valor, classe, d, manual) => `<div class="conama-auto">
    <div class="conama-auto-top"><b>${label}</b> ${valor}${manual ? ' <span class="badge">manual</span>' : ""} → <span class="badge ${classe && classe !== "ambiguo" ? "ok" : "nok"}">${classe ? (classe === "ambiguo" ? "zona 18–20 (decide pelos outros)" : ROTULO_ESTAGIO[classe]) : "sem dado"}</span></div>
    <small>Inicial: ${d.inicial} · Médio: ${d.medio} · Avançado: ${d.avancado}</small></div>`;
  function autoBoxHtml() {
    const m = mediasParcela(p);
    const altEf = m.alturaMaxima != null ? m.alturaMaxima : (c.alturaManual != null ? c.alturaManual : null);
    const dapEf = m.dapMedio != null ? m.dapMedio : (c.dapManual != null ? c.dapManual : null);
    const altMan = m.alturaMaxima == null && c.alturaManual != null;
    const dapMan = m.dapMedio == null && c.dapManual != null;
    return autoLinha("Altura do dossel", altEf != null ? fmtNum(altEf, 1) + " m" : "—", classeAltura(altEf, g), lim.altura, altMan)
      + autoLinha("DAP médio", dapEf != null ? fmtNum(dapEf, 1) + " cm" : "—", classeDap(dapEf, g), lim.dap, dapMan);
  }

  const qualiHtml = CONAMA_QUALI.map((q) =>
    `<div class="conama-param"><div class="conama-label">${q.label}</div>
       <div class="conama-opts">${opcoesParam(q.key, q)}</div></div>`).join("");
  const indHtml = `<div class="conama-param"><div class="conama-label">Espécies indicadoras</div>
    <div class="conama-opts">
      <button class="conama-opt ${c.indicadoras === "pioneiras" ? "sel" : ""}" data-param="indicadoras" data-est="pioneiras"><b>Pioneiras</b><span>estágio inicial</span></button>
      <button class="conama-opt larga ${c.indicadoras === "secundarias" ? "sel" : ""}" data-param="indicadoras" data-est="secundarias"><b>Secundárias</b><span>médio ou avançado</span></button>
    </div></div>`;

  app.innerHTML = `${header("Estágio sucessional", () => telaParcela(parcelaId))}
    <main>
      <div class="info">${lim.rotulo} · parcela <b>${esc(p.rotulo || "")}</b></div>
      <div id="conama-auto-box">${autoBoxHtml()}</div>
      <details class="conama-manual">
        <summary>Sem fustes medidos? Informar altura/DAP manual</summary>
        <div class="linha2">
          <label>Altura do dossel (m)<input id="cm-altura" type="number" step="0.1" inputmode="decimal" value="${c.alturaManual ?? ""}"></label>
          <label>DAP médio (cm)<input id="cm-dap" type="number" step="0.1" inputmode="decimal" value="${c.dapManual ?? ""}"></label>
        </div>
        <small>Usado só quando a parcela não tem CAP/altura medidos (ex.: estágio estimado em campo).</small>
      </details>
      ${qualiHtml}
      ${indHtml}
      <div class="conama-resultado" id="conama-res"></div>
    </main>`;
  ligarVoltar(() => telaParcela(parcelaId));

  function render() {
    const r = classificarEstagio(p, estrato);
    const el = $("#conama-res");
    if (!r) { el.innerHTML = "Marque os parâmetros pra sugerir o estágio."; el.className = "conama-resultado"; return; }
    const cls = r.estagio === "avancado" ? "verde" : r.estagio === "medio" ? "amarelo" : "vermelho";
    el.className = `conama-resultado ${cls}`;
    el.innerHTML = `Estágio sugerido: <b>${ROTULO_ESTAGIO[r.estagio]}</b>
      <small>(${r.n}/9 parâmetros · I:${r.votos.inicial} M:${r.votos.medio} A:${r.votos.avancado})</small>`;
    c.estagioSugerido = r.estagio;
  }
  $$(".conama-opt").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.param, est = b.dataset.est;
      c[k] = (c[k] === est) ? null : est; // toca de novo = desmarca
      $$(`.conama-opt[data-param="${k}"]`).forEach((x) => x.classList.toggle("sel", x.dataset.est === c[k]));
      agendarSalvar();
      render();
    };
  });
  const setManual = (campo, el) => {
    const v = parseFloat(el.value);
    c[campo] = Number.isNaN(v) ? null : v;
    $("#conama-auto-box").innerHTML = autoBoxHtml();
    agendarSalvar();
    render();
  };
  $("#cm-altura").oninput = (e) => setManual("alturaManual", e.target);
  $("#cm-dap").oninput = (e) => setManual("dapManual", e.target);
  render();
}

// TELA 4 — parcela (GPS + indivíduos)
// ============================================================
function telaParcela(parcelaId) {
  const p = inv.parcelas.find((x) => x.id === parcelaId);
  if (!p) return telaInventario(inv.id);
  const est = estPorId(p.estratoId);
  const modos = [["placa", "Placa"], ["especie", "Espécie"], ["entrada", "Ordem de entrada"]];
  const ordAtual = inv.config.ordIndividuos || "entrada";
  const ordOpts = modos.map(([v, t]) =>
    `<option value="${v}" ${v === ordAtual ? "selected" : ""}>${t}</option>`).join("");

  app.innerHTML = `${header("Parcela " + (p.rotulo || ""), () => telaParcelasDoEstrato(p.estratoId))}
    <main>
      <div class="form">
        <label class="campo">Rótulo da parcela<input id="p-rotulo" value="${esc(p.rotulo)}"></label>
        <div class="gps-linha">
          <button class="btn-sec" id="p-gps">📍 Marcar GPS</button>
          <span id="gps-info">${p.lat != null ? fmtNum(p.lat, 6) + ", " + fmtNum(p.lon, 6) : "sem coordenada"}</span>
        </div>
        <button class="btn-sec largo" id="p-conama">🌳 Estágio sucessional (CONAMA) <span id="p-conama-est"></span></button>
      </div>
      <div class="erro-estrato-box neutro" id="p-resumo"></div>
      <button class="btn-grande" id="novo-ind">+ Novo indivíduo</button>
      <div class="ordenar"><label>Organizar por <select id="ord-ind">${ordOpts}</select></label>
        <span class="ord-cont">${p.individuos.length} indiv.</span></div>
      <div class="cards" id="cards-ind"></div>
    </main>`;
  ligarVoltar(() => telaParcelasDoEstrato(p.estratoId));
  const rConama = classificarEstagio(p, est);
  $("#p-conama-est").innerHTML = rConama
    ? `<span class="badge ok">${ROTULO_ESTAGIO[rConama.estagio]}</span>`
    : (grupoConama(est) ? "" : '<small>(cerrado: depois)</small>');
  $("#p-conama").onclick = () => telaConama(p.id);
  $("#p-rotulo").oninput = (e) => { p.rotulo = e.target.value; agendarSalvar(); };
  $("#p-gps").onclick = () => marcarGPS(p);
  $("#novo-ind").onclick = async () => {
    const ind = novoIndividuo("");
    p.individuos.push(ind);
    await salvarJa();
    telaIndividuo(p.id, ind.id);
  };
  $("#ord-ind").onchange = (e) => { inv.config.ordIndividuos = e.target.value; agendarSalvar(); renderCardsInd(); };

  function renderCardsInd() {
    const box = $("#cards-ind");
    if (!p.individuos.length) {
      box.innerHTML = '<p class="vazio">Nenhum indivíduo. Toque em "+ Novo indivíduo".</p>';
      return;
    }
    const outliers = outliersDoEstrato(inv, p.estratoId);
    box.innerHTML = individuosOrdenados(p, inv.config.ordIndividuos || "entrada").map(({ ind, entrada }) => {
      const vi = volumeIndividuo(ind.fustes, est?.fitofisionomia);
      const out = outliers.has(ind.id);
      return `<div class="card ${out ? "card-outlier" : ""}" data-ind="${ind.id}">
        <div class="card-corpo">
          <div class="card-nome">#${esc(ind.placa || (entrada + 1))} <i>${esc(ind.especie || "—")}</i>${out ? ' <span class="badge nok">⚠ verificar</span>' : ""}</div>
          <div class="card-sub">${ind.fustes.length} fuste(s) · ${fmtNum(vi.vol_aereo, 4)} m³</div>
        </div></div>`;
    }).join("");
    $$("[data-ind]", box).forEach((el) => { el.onclick = () => telaIndividuo(p.id, el.dataset.ind); });
  }
  // resumo da parcela: erro amostral do estrato + volume acumulado desta parcela
  function renderResumo() {
    const el = $("#p-resumo");
    if (!el) return;
    const aHa = areaParcelaHa(inv.config);
    const volM3 = volumeParcelaM3(p, est);
    const mha = aHa ? volM3 / aHa : null;
    const r = resultadosPorEstrato(inv).find((x) => x.estrato.id === p.estratoId);
    const alvo = inv.config.erroAlvoPct;
    let erroTxt, cls = "neutro";
    if (!r || !r.erro) {
      erroTxt = `erro do estrato: ${r ? r.nParcelas : 0} parcela(s) <small>(precisa de 2+)</small>`;
    } else {
      const e = r.erro.erro_rel_pct;
      const suf = e <= alvo;
      cls = suf ? (e > alvo * 0.8 ? "amarelo" : "verde") : "vermelho";
      erroTxt = `erro do estrato: <b>${fmtNum(e, 2)}%</b> ${suf ? "✓" : "✗ acima"} <small>(alvo ${fmtNum(alvo, 0)}%)</small>`;
    }
    el.className = `erro-estrato-box ${cls}`;
    el.innerHTML = `volume acumulado: <b>${fmtNum(volM3, 4)} m³</b>${mha != null ? ` · ${fmtNum(mha, 1)} m³/ha` : ""} <small>(${p.individuos.length} indiv.)</small><br>${erroTxt}`;
  }
  renderCardsInd();
  renderResumo();
}

function marcarGPS(p) {
  const info = $("#gps-info");
  if (!navigator.geolocation) { info.textContent = "GPS indisponível neste dispositivo"; return; }
  info.textContent = "obtendo…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      p.lat = pos.coords.latitude; p.lon = pos.coords.longitude; p.gpsEm = Date.now();
      info.textContent = `${fmtNum(p.lat, 6)}, ${fmtNum(p.lon, 6)}`;
      agendarSalvar();
    },
    (err) => { info.textContent = "erro no GPS: " + err.message; },
    { enableHighAccuracy: true, timeout: 15000 },
  );
}

// ============================================================
// TELA — parcela HERBÁCEA (1×1 m): GPS + fotos + táxons com classe Braun-Blanquet
// ============================================================
function telaParcelaHerbaceo(parcelaId) {
  const p = inv.parcelas.find((x) => x.id === parcelaId);
  if (!p) return telaInventario(inv.id);
  if (!p.taxons) p.taxons = [];
  const est = estPorId(p.estratoId);

  app.innerHTML = `${header("Parcela " + (p.rotulo || ""), () => telaParcelasDoEstrato(p.estratoId))}
    <main class="form">
      <div class="erro-estrato-box neutro" id="h-resumo"></div>
      <label class="campo">Rótulo da parcela<input id="p-rotulo" value="${esc(p.rotulo)}"></label>
      <div class="gps-linha">
        <button class="btn-sec" id="p-gps">📍 Marcar GPS</button>
        <span id="gps-info">${p.lat != null ? fmtNum(p.lat, 6) + ", " + fmtNum(p.lon, 6) : "sem coordenada"}</span>
      </div>
      <button class="btn-sec largo" id="p-fotos">📷 Fotos da parcela</button>
      <h3>Cobertura — táxons <small>(escala Braun-Blanquet · ID a gênero)</small></h3>
      <details class="bb-legenda">
        <summary>ⓘ escala de cobertura Braun-Blanquet</summary>
        <ul>${BB_CLASSES.map((bb) => `<li><b>${bb}</b> — ${esc(BB_DESC[bb])}</li>`).join("")}</ul>
        <small>r/+ = quase nada (conta indivíduos); 1–5 = quanto do quadrado a espécie cobre vista de cima.</small>
      </details>
      <div id="taxons"></div>
      <button class="btn-grande" id="add-tax">+ Adicionar táxon</button>
    </main>`;
  ligarVoltar(() => telaParcelasDoEstrato(p.estratoId));
  $("#p-rotulo").oninput = (e) => { p.rotulo = e.target.value; agendarSalvar(); };
  $("#p-gps").onclick = () => marcarGPS(p);
  $("#p-fotos").onclick = () => telaFotosParcela(p.id);
  $("#add-tax").onclick = async () => { p.taxons.push(novoTaxon("")); await salvarJa(); renderTaxons(); };

  function renderResumoH() {
    const el = $("#h-resumo");
    if (!el) return;
    const h = resultadosHerbaceo(inv, p.estratoId);
    el.innerHTML = `nesta parcela: <b>${p.taxons.length}</b> táxon(s) · estrato: riqueza <b>${h.riqueza}</b> em ${h.nParcelas} parcela(s)`;
  }
  function renderTaxons() {
    const box = $("#taxons");
    if (!p.taxons.length) {
      box.innerHTML = '<p class="vazio">Nenhum táxon. Toque em "+ Adicionar táxon".</p>';
      renderResumoH();
      return;
    }
    // Cobertura e Origem ficam COLAPSADAS num botão (mostra a escolha); tocar abre
    // as opções, escolher fecha de volta — tela limpa com vários táxons.
    box.innerHTML = p.taxons.map((t, i) => `<div class="taxon-card">
      <div class="taxon-top">
        <div class="autocomplete">
          <input class="t-nome" data-i="${i}" value="${esc(t.nome)}" autocomplete="off" placeholder="Gênero / espécie">
          <button type="button" class="ac-toggle t-toggle" data-i="${i}" aria-label="Ver táxons">▾</button>
          <div class="ac-lista t-lista" data-i="${i}" hidden></div>
        </div>
        <button class="btn-foto perigo-icone t-del" data-i="${i}" title="Excluir táxon">🗑</button>
      </div>
      <div class="taxon-linha">
        <div class="sel-campo">
          <button class="sel-btn ${t.bb ? "ok" : ""}" data-toggle="bb" data-i="${i}">Cobertura <b>${t.bb || "—"}</b> <span class="seta">▾</span></button>
          <div class="sel-opts" data-campo="bb" data-i="${i}" hidden>
            ${BB_CLASSES.map((bb) => `<button class="bb-opt-full ${t.bb === bb ? "sel" : ""}" data-i="${i}" data-bb="${bb}"><b>${bb}</b><span>${esc(BB_DESC[bb])}</span></button>`).join("")}
          </div>
        </div>
        <div class="sel-campo">
          <button class="sel-btn ${t.origem ? "ok" : ""}" data-toggle="orig" data-i="${i}">Origem <b>${esc(t.origem || "—")}</b> <span class="seta">▾</span></button>
          <div class="sel-opts" data-campo="orig" data-i="${i}" hidden>
            ${ORIGENS_HERB.map((o) => `<button class="orig-opt larga ${t.origem === o ? "sel" : ""}" data-i="${i}" data-orig="${esc(o)}">${esc(o)}</button>`).join("")}
          </div>
        </div>
      </div>
    </div>`).join("");
    $$(".t-nome", box).forEach((el) => { el.oninput = () => { p.taxons[+el.dataset.i].nome = el.value; agendarSalvar(); }; });
    p.taxons.forEach((t, i) => {
      const input = box.querySelector(`.t-nome[data-i="${i}"]`);
      const toggle = box.querySelector(`.t-toggle[data-i="${i}"]`);
      const lista = box.querySelector(`.t-lista[data-i="${i}"]`);
      ligarAutocomplete(input, toggle, lista, () => taxonsDoEstrato(inv, p.estratoId),
        (nome) => { p.taxons[i].nome = nome; agendarSalvar(); });
    });
    // abre/fecha o seletor de cobertura ou origem
    $$(".sel-btn", box).forEach((el) => {
      el.onclick = () => {
        const panel = box.querySelector(`.sel-opts[data-campo="${el.dataset.toggle}"][data-i="${el.dataset.i}"]`);
        if (panel) panel.hidden = !panel.hidden;
      };
    });
    // escolher cobertura/origem → grava e re-renderiza (fecha o seletor, atualiza o rótulo)
    $$(".bb-opt-full", box).forEach((el) => {
      el.onclick = () => {
        const i = +el.dataset.i;
        p.taxons[i].bb = (p.taxons[i].bb === el.dataset.bb) ? null : el.dataset.bb;
        agendarSalvar(); renderTaxons();
      };
    });
    $$(".orig-opt", box).forEach((el) => {
      el.onclick = () => {
        const i = +el.dataset.i;
        p.taxons[i].origem = (p.taxons[i].origem === el.dataset.orig) ? null : el.dataset.orig;
        agendarSalvar(); renderTaxons();
      };
    });
    $$(".t-del", box).forEach((el) => {
      el.onclick = async () => { p.taxons.splice(+el.dataset.i, 1); await salvarJa(); renderTaxons(); };
    });
    renderResumoH();
  }
  renderTaxons();
}

// ============================================================
// TELA 5 — indivíduo (placa, espécie, fustes)
// ============================================================
function telaIndividuo(parcelaId, individuoId) {
  const p = inv.parcelas.find((x) => x.id === parcelaId);
  const ind = p.individuos.find((x) => x.id === individuoId);
  if (!ind) return telaParcela(parcelaId);
  const est = estPorId(p.estratoId);

  app.innerHTML = `${header("Indivíduo", () => telaParcela(parcelaId))}
    <main class="form">
      <div class="info" id="medias-parcela"></div>
      <div class="info erro-estrato-box neutro" id="erro-estrato"></div>
      <div id="aviso-outlier"></div>
      <div class="linha2">
        <label>Placa<input id="i-placa" value="${esc(ind.placa)}" inputmode="numeric"></label>
        <button class="perigo" id="del-ind">🗑 Excluir</button>
      </div>
      <label class="campo">Espécie
        <div class="autocomplete">
          <input id="i-especie" value="${esc(ind.especie)}" autocomplete="off" placeholder="Digite ou toque em ▾">
          <button type="button" class="ac-cam" id="i-foto" aria-label="Foto da espécie">📷</button>
          <button type="button" class="ac-toggle" id="i-especie-toggle" aria-label="Ver espécies">▾</button>
          <div class="ac-lista" id="i-especie-lista" hidden></div>
        </div></label>

      <h3>Fustes <small>(CAP em cm, altura em m)</small></h3>
      <div id="fustes"></div>
      <button class="btn-sec" id="add-fuste">+ Adicionar fuste</button>

      <button class="btn-grande" id="prox-ind">✓ Salvar e próximo indivíduo</button>
      <section id="lista-individuos"></section>
    </main>`;
  ligarVoltar(() => telaParcela(parcelaId));

  function renderFustes() {
    $("#fustes").innerHTML = ind.fustes.map((f, i) => `<div class="fuste-linha" data-i="${i}">
      <span class="fuste-num">${i + 1}</span>
      <input class="f-cap" data-i="${i}" type="number" step="0.1" inputmode="decimal" placeholder="CAP" value="${f.capCm ?? ""}">
      <input class="f-alt" data-i="${i}" type="number" step="0.1" inputmode="decimal" placeholder="Altura" value="${f.alturaM ?? ""}">
      ${ind.fustes.length > 1 ? `<button class="perigo f-del" data-i="${i}">✕</button>` : "<span></span>"}
    </div>`).join("");
    $$(".f-cap").forEach((el) => { el.oninput = () => { ind.fustes[+el.dataset.i].capCm = parseFloat(el.value) || null; volVivo(); agendarSalvar(); }; });
    $$(".f-alt").forEach((el) => { el.oninput = () => { ind.fustes[+el.dataset.i].alturaM = parseFloat(el.value) || null; volVivo(); agendarSalvar(); }; });
    $$(".f-del").forEach((el) => { el.onclick = async () => { ind.fustes.splice(+el.dataset.i, 1); await salvarJa(); renderFustes(); volVivo(); }; });
  }
  function volVivo() {
    // médias da parcela (DAP e altura) recalculadas ao vivo a cada CAP/altura
    const mp = mediasParcela(p);
    const mpEl = $("#medias-parcela");
    if (mpEl) {
      const volAc = volumeParcelaM3(p, est);
      const medias = mp.nFustes
        ? `Parcela: DAP médio <b>${fmtNum(mp.dapMedio, 1)} cm</b> · maior árvore <b>${fmtNum(mp.alturaMaxima, 1)} m</b> <small>(${mp.nFustes} fuste${mp.nFustes === 1 ? "" : "s"})</small>`
        : "Médias da parcela: aguardando primeiro fuste";
      mpEl.innerHTML = `${medias}<br>Volume acumulado: <b>${fmtNum(volAc, 4)} m³</b> <small>(${p.individuos.length} indiv.)</small>`;
    }
    // erro amostral do estrato recalculado ao vivo (inclui este indivíduo) —
    // permite flagrar um outlier antes de fechar a parcela.
    const ee = $("#erro-estrato");
    if (ee) {
      const r = resultadosPorEstrato(inv).find((x) => x.estrato.id === p.estratoId);
      const alvo = inv.config.erroAlvoPct;
      if (!r || !r.erro) {
        ee.className = "info erro-estrato-box neutro";
        ee.innerHTML = `Erro do estrato: ${r ? r.nParcelas : 0} parcela(s) — precisa de 2+ pra calcular`;
      } else {
        const e = r.erro.erro_rel_pct;
        const suf = e <= alvo;
        ee.className = `info erro-estrato-box ${suf ? (e > alvo * 0.8 ? "amarelo" : "verde") : "vermelho"}`;
        ee.innerHTML = `Erro amostral do estrato: <b>${fmtNum(e, 2)}%</b> ${suf ? "✓ ok" : "✗ acima"} `
          + `<small>(${r.nParcelas} parcelas · alvo ${fmtNum(alvo, 0)}%)</small>`;
      }
    }
    const ao = $("#aviso-outlier");
    if (ao) {
      const ehOutlier = outliersDoEstrato(inv, p.estratoId).has(ind.id);
      ao.className = ehOutlier ? "aviso-outlier" : "";
      ao.innerHTML = ehOutlier
        ? "⚠ <b>Indivíduo atípico</b> — volume bem fora do padrão do estrato. Confira se o CAP/altura não tem erro de digitação."
        : "";
    }
  }
  // Lista dos indivíduos já cadastrados na parcela — clicável pra editar/remover/consultar
  // sem sair da tela. O indivíduo em edição fica destacado.
  function renderListaIndividuos() {
    const modo = inv.config.ordIndividuos || "entrada";
    const outliers = outliersDoEstrato(inv, p.estratoId);
    const itens = individuosOrdenados(p, modo).map(({ ind: x, entrada }) => {
      const vi = volumeIndividuo(x.fustes, est?.fitofisionomia);
      const atual = x.id === ind.id;
      const out = outliers.has(x.id);
      return `<div class="card ${out ? "card-outlier" : ""} ${atual ? "card-atual" : ""}" ${atual ? "" : `data-troca="${x.id}"`}>
        <div class="card-corpo">
          <div class="card-nome">#${esc(x.placa || (entrada + 1))} <i>${esc(x.especie || "—")}</i>`
        + `${atual ? ' <span class="badge ok">editando</span>' : ""}${out ? ' <span class="badge nok">⚠</span>' : ""}</div>
          <div class="card-sub">${x.fustes.length} fuste(s) · ${fmtNum(vi.vol_aereo, 4)} m³</div>
        </div></div>`;
    }).join("");
    const modos = [["placa", "Placa"], ["especie", "Espécie"], ["entrada", "Ordem de entrada"]];
    const ordOpts = modos.map(([v, t]) => `<option value="${v}" ${v === modo ? "selected" : ""}>${t}</option>`).join("");
    $("#lista-individuos").innerHTML = `<div class="lista-head">
        <h3>Indivíduos da parcela (${p.individuos.length})</h3>
        <label class="ord-mini">Organizar <select id="ord-ind-i">${ordOpts}</select></label>
      </div>${itens}`;
    $("#ord-ind-i").onchange = (e) => { inv.config.ordIndividuos = e.target.value; agendarSalvar(); renderListaIndividuos(); };
    $$("#lista-individuos [data-troca]").forEach((el) => {
      el.onclick = async () => { await salvarJa(); telaIndividuo(parcelaId, el.dataset.troca); };
    });
  }
  renderFustes(); volVivo(); renderListaIndividuos();

  $("#i-placa").oninput = (e) => { ind.placa = e.target.value; agendarSalvar(); renderListaIndividuos(); };
  // não polui a lista com digitação parcial — as opções derivam dos indivíduos
  // já comprometidos (especiesDoInventario) + as pré-cadastradas em config.
  const setEspecie = (v) => { ind.especie = v; agendarSalvar(); renderListaIndividuos(); };
  $("#i-especie").oninput = (e) => setEspecie(e.target.value);
  ligarAutocomplete(
    $("#i-especie"), $("#i-especie-toggle"), $("#i-especie-lista"),
    () => especiesDoInventario(inv, ind.id), setEspecie,
  );
  // atalho de foto da espécie: tira foto JÁ marcada com a parcela atual e manda
  // pro registro de Espécies (organiza por espécie → parcela).
  $("#i-foto").onclick = async () => {
    const nome = (ind.especie || "").trim();
    if (!nome) { alert("Preencha a espécie antes de tirar a foto."); return; }
    const foto = await capturarFoto(inv.id, "especie", nome, { parcelaId: p.id });
    if (foto) { adicionarEspecie(inv, nome); await salvarJa(); }
  };
  $("#add-fuste").onclick = async () => { ind.fustes.push(novoFuste()); await salvarJa(); renderFustes(); volVivo(); };
  $("#del-ind").onclick = async () => {
    if (confirm("Excluir este indivíduo?")) {
      p.individuos = p.individuos.filter((x) => x.id !== ind.id);
      await salvarJa();
      // mantém na tela do indivíduo (abrindo o último restante) pra seguir mexendo na lista
      if (p.individuos.length) telaIndividuo(parcelaId, p.individuos[p.individuos.length - 1].id);
      else telaParcela(parcelaId);
    }
  };
  $("#prox-ind").onclick = async () => {
    await salvarJa();
    const novo = novoIndividuo("");
    p.individuos.push(novo);
    await salvarJa();
    telaIndividuo(parcelaId, novo.id);
  };
}

// ============================================================
// FOTOS — captura, galeria, telas de Espécies e de fotos da parcela, export ZIP
// ============================================================
let _fotoUrls = [];
function revogarUrls() { for (const u of _fotoUrls) URL.revokeObjectURL(u); _fotoUrls = []; }
function urlFoto(blob) { const u = urlDeBlob(blob); _fotoUrls.push(u); return u; }
const nomeSeguro = (s) => (s || "sem-nome").replace(/[\\/:*?"<>|]+/g, "-").trim() || "sem-nome";
const coordTexto = (lat, lon) => (lat == null || lon == null) ? ""
  : `${fmtNum(Math.abs(lat), 6)} ${lat < 0 ? "S" : "N"}  ${fmtNum(Math.abs(lon), 6)} ${lon < 0 ? "W" : "E"}`;
function dataTexto(ms) { try { return new Date(ms).toLocaleString("pt-BR"); } catch (e) { return ""; } }

// Abre a câmera, comprime e salva a foto. inp.click() roda no gesto do toque.
function capturarFoto(invId, tipo, refKey, extra = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.setAttribute("capture", "environment");
    inp.onchange = async () => {
      const file = inp.files && inp.files[0];
      if (!file) return resolve(null);
      try {
        const blob = await comprimirImagem(file);
        const foto = {
          id: "foto_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e9).toString(36),
          invId, tipo, refKey, blob,
          lat: extra.lat ?? null, lon: extra.lon ?? null,
          parcelaId: extra.parcelaId ?? null,   // fotos de espécie: em qual parcela foi tirada ("" = avulsa)
          categoria: extra.categoria ?? null,   // fotos de parcela: Geral/Serrapilheira/Dossel/Sub-bosque
          capturadaEm: Date.now(),
        };
        await db.salvarFoto(foto);
        resolve(foto);
      } catch (e) { alert("Erro ao processar a foto: " + (e?.message || e)); resolve(null); }
    };
    inp.click();
  });
}

function galeriaHTML(fotos) {
  if (!fotos.length) return '<p class="vazio">Nenhuma foto ainda.</p>';
  return '<div class="galeria">' + fotos.map((f) =>
    `<div class="foto-item"><img src="${urlFoto(f.blob)}" alt="" loading="lazy">
       <button class="foto-del" data-del-foto="${f.id}" title="Excluir">✕</button></div>`).join("") + "</div>";
}
function ligarDelFoto(sel, reRender) {
  $$(sel + " [data-del-foto]").forEach((el) => {
    el.onclick = async () => {
      if (!confirm("Excluir esta foto?")) return;
      await db.excluirFoto(el.dataset.delFoto);
      reRender();
    };
  });
}

// TELA — registro de Espécies (lista + fotos)
async function telaEspecies(invId) {
  inv = await db.obterInventario(invId);
  if (!inv) return telaInventarios();
  revogarUrls();
  const fotos = (await db.fotosDoInventario(invId)).filter((f) => f.tipo === "especie");
  const contagem = {};
  for (const f of fotos) contagem[f.refKey] = (contagem[f.refKey] || 0) + 1;
  const nomes = registroEspecies(inv, fotos.map((f) => f.refKey));
  const HAB_BADGE = { arborea: '<span class="badge hab-arb">🌳 arbórea</span>', nao_arborea: '<span class="badge hab-naoarb">🌿 não-arbórea</span>' };
  const cards = nomes.length ? nomes.map((nome) => {
    const hab = habitoEfetivo(inv, nome) || "";
    return `<div class="card" data-esp="${esc(nome)}" data-hab="${hab}">
       <div class="card-corpo">
         <div class="card-nome"><i>${esc(nome)}</i> ${HAB_BADGE[hab] || ""}</div>
         <div class="card-sub">${contagem[nome] || 0} foto(s)</div>
       </div>
       <div class="card-acoes">
         <span class="badge ${contagem[nome] ? "ok" : ""}">${contagem[nome] ? "📷 " + contagem[nome] : "—"}</span>
         <button class="btn-foto perigo-icone" data-del-esp="${esc(nome)}" title="Excluir espécie">🗑</button>
       </div>
     </div>`;
  }).join("")
    : '<p class="vazio">Nenhuma espécie ainda. As que você registrar nas parcelas aparecem aqui.</p>';
  const filtro = localStorage.getItem("aflora-filtro-hab") || "todas";
  const fChip = (v, t) => `<button class="filtro-chip ${v === filtro ? "sel" : ""}" data-filtro="${v}">${t}</button>`;
  app.innerHTML = `${header("Espécies", () => telaInventario(invId))}
    <main>
      <div class="seg-nav">
        <button class="seg" id="ir-parcelas">📋 Parcelas</button>
        <button class="seg ativo">🌿 Espécies</button>
      </div>
      <button class="btn-grande" id="add-esp">+ Adicionar espécie</button>
      <input id="busca-esp" class="busca" type="search" placeholder="🔎 Buscar espécie…" autocomplete="off">
      <div class="filtro-chips">${fChip("todas", "Todas")}${fChip("arborea", "🌳 Arbóreas")}${fChip("nao_arborea", "🌿 Não-arbóreas")}</div>
      <div class="cards">${cards}</div>
      <button class="btn-sec largo" id="exp-fotos-esp">⬇ Exportar fotos das espécies (ZIP)</button>
    </main>`;
  ligarVoltar(() => telaInventario(invId));
  $("#ir-parcelas").onclick = () => telaInventario(invId);
  $("#add-esp").onclick = async () => {
    const nome = prompt("Nome da espécie (ex.: Myrtaceae sp.1):");
    if (!nome || !nome.trim()) return;
    adicionarEspecie(inv, nome.trim());
    await salvarJa();
    telaEspecies(invId);
  };
  $$("[data-esp]").forEach((el) => { el.onclick = () => telaEspecie(invId, el.dataset.esp); });
  $$("[data-del-esp]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation(); // não abrir a espécie ao tocar o 🗑
      const nome = el.dataset.delEsp;
      let usados = 0;
      for (const p of inv.parcelas) usados += p.individuos.filter((ind) => (ind.especie || "").trim() === nome).length;
      if (usados) { alert(`"${nome}" está em ${usados} indivíduo(s). Renomeie ou exclua esses indivíduos primeiro.`); return; }
      if (!confirm(`Excluir a espécie "${nome}" e suas fotos? Não dá pra desfazer.`)) return;
      inv.especies = (inv.especies || []).filter((s) => (s || "").trim() !== nome);
      const fts = (await db.fotosDoInventario(invId)).filter((f) => f.tipo === "especie" && f.refKey === nome);
      for (const f of fts) await db.excluirFoto(f.id);
      await salvarJa();
      telaEspecies(invId);
    };
  });
  const buscaEl = $("#busca-esp");
  // filtro (hábito) + busca (texto) aplicados juntos
  const aplicarFiltro = () => {
    const t = semAcento(buscaEl.value);
    const fil = localStorage.getItem("aflora-filtro-hab") || "todas";
    $$("[data-esp]").forEach((el) => {
      const okTexto = !t || semAcento(el.dataset.esp).includes(t);
      const okHab = fil === "todas" || el.dataset.hab === fil;
      el.style.display = (okTexto && okHab) ? "" : "none";
    });
  };
  buscaEl.oninput = aplicarFiltro;
  $$("[data-filtro]").forEach((el) => {
    el.onclick = () => {
      localStorage.setItem("aflora-filtro-hab", el.dataset.filtro);
      $$("[data-filtro]").forEach((x) => x.classList.toggle("sel", x === el));
      aplicarFiltro();
    };
  });
  aplicarFiltro();
  $("#exp-fotos-esp").onclick = () => exportarZipEspecies(invId);
}

// Hábito EFETIVO: o que o usuário marcou; se nada, espécie registrada como
// indivíduo (parcela arbórea/censo) conta como arbórea por padrão. Deixa o filtro
// já útil sem marcar tudo na mão; a marcação manual sempre prevalece.
function habitoEfetivo(inv, nome) {
  const h = habitoEspecie(inv, nome);
  if (h) return h;
  const alvo = (nome || "").trim();
  for (const p of inv.parcelas) {
    const est = inv.estratos.find((e) => e.id === p.estratoId);
    if (est && est.metodo === "herbaceo") continue; // herbáceo não define arbóreo
    if (p.individuos.some((ind) => (ind.especie || "").trim() === alvo)) return "arborea";
  }
  return null;
}

const CATEGORIAS_FOTO = ["Geral", "Serrapilheira", "Dossel", "Sub-bosque"];
// Categorias de foto de ESPÉCIE (organização opcional, togglável na tela da espécie).
const CATEGORIAS_ESP = ["Geral", "Material Vegetativo", "Tronco", "Material Reprodutivo"];
const espCatAtivo = () => localStorage.getItem("aflora-esp-cat") === "1";

// TELA — detalhe da espécie: renomear + ocorrência + pastas de parcela
async function telaEspecie(invId, nome) {
  inv = await db.obterInventario(invId);
  if (!inv) return telaInventarios();
  revogarUrls();
  let nomeAtual = nome;
  const rotulo = {};
  for (const p of inv.parcelas) rotulo[p.id] = p.rotulo || p.id;
  const fotos = (await db.fotosDoInventario(invId)).filter((f) => f.tipo === "especie" && f.refKey === nome);
  // ocorrência: parcelas onde há indivíduo com esta espécie
  const ocorre = [];
  for (const p of inv.parcelas) {
    const n = p.individuos.filter((ind) => (ind.especie || "").trim() === nome).length;
    if (n) ocorre.push(`${rotulo[p.id]} (${n})`);
  }
  // pastas de fotos por parcela ("" = avulsa, fora de parcela)
  const porParc = {};
  for (const f of fotos) { const k = f.parcelaId || ""; (porParc[k] = porParc[k] || []).push(f); }
  const chaves = Object.keys(porParc).sort();
  const pastasHtml = chaves.length ? chaves.map((k) =>
    `<div class="card" data-pasta="${esc(k)}"><div class="card-corpo">
       <div class="card-nome">📁 ${k ? esc(rotulo[k] || k) : "Sem parcela (avulsa)"}</div>
       <div class="card-sub">${porParc[k].length} foto(s)</div></div></div>`).join("")
    : '<p class="vazio">Nenhuma foto. Toque em "Tirar foto" ou use o 📷 ao registrar o indivíduo.</p>';
  const hab = habitoEfetivo(inv, nome);
  const habBtn = (v, t) => `<button class="orig-opt larga ${hab === v ? "sel" : ""}" data-hab-set="${v}">${t}</button>`;
  app.innerHTML = `${header("Espécie", () => telaEspecies(invId))}
    <main class="form">
      <label class="campo">Nome da espécie <small>(editar renomeia no inventário todo)</small>
        <input id="esp-nome" value="${esc(nome)}"></label>
      <div class="campo">Hábito
        <div class="bb-opts">${habBtn("arborea", "🌳 Arbórea")}${habBtn("nao_arborea", "🌿 Não-arbórea")}</div>
      </div>
      <div class="info">${ocorre.length
        ? "Ocorre em: <b>" + esc(ocorre.join(", ")) + "</b>"
        : "Espécie avulsa — não registrada em parcelas (ex.: herbácea / fora das parcelas)."}</div>
      <button class="btn-grande" id="esp-foto">📷 Tirar foto avulsa</button>
      <h3>Fotos por parcela</h3>
      <div class="cards">${pastasHtml}</div>
    </main>`;
  ligarVoltar(() => telaEspecies(invId));
  $("#esp-nome").onchange = async (e) => {
    const novo = e.target.value.trim();
    if (!novo || novo === nomeAtual) return;
    renomearEspecie(inv, nomeAtual, novo);
    await db.renomearRefKeyFotos(invId, "especie", nomeAtual, novo);
    await salvarJa();
    nomeAtual = novo;
  };
  // hábito: toca pra marcar; toca de novo desmarca
  $$("[data-hab-set]").forEach((el) => {
    el.onclick = () => {
      const v = el.dataset.habSet;
      const atual = habitoEfetivo(inv, nomeAtual);
      setHabitoEspecie(inv, nomeAtual, atual === v ? null : v);
      $$("[data-hab-set]").forEach((x) => x.classList.toggle("sel", x.dataset.habSet === habitoEfetivo(inv, nomeAtual)));
      agendarSalvar();
    };
  });
  $("#esp-foto").onclick = async () => {
    const nomeUse = $("#esp-nome").value.trim() || nomeAtual;
    const foto = await capturarFoto(invId, "especie", nomeUse, { parcelaId: "" });
    if (foto) { adicionarEspecie(inv, nomeUse); await salvarJa(); telaEspecie(invId, nomeUse); }
  };
  $$("[data-pasta]").forEach((el) => { el.onclick = () => telaEspecieFotos(invId, nomeAtual, el.dataset.pasta); });
}

// TELA — fotos de uma espécie dentro de uma parcela (ou avulsa). Botão 📁 ativa
// as subpastas por categoria (Geral/Material Vegetativo/Tronco/Material Reprodutivo)
// AQUI DENTRO da parcela — togglável, persiste em localStorage.
async function telaEspecieFotos(invId, nome, parcelaKey) {
  inv = await db.obterInventario(invId);
  if (!inv) return telaInventarios();
  revogarUrls();
  const rotulo = {};
  for (const p of inv.parcelas) rotulo[p.id] = p.rotulo || p.id;
  const titulo = parcelaKey ? (rotulo[parcelaKey] || parcelaKey) : "Sem parcela";
  const fotos = (await db.fotosDoInventario(invId))
    .filter((f) => f.tipo === "especie" && f.refKey === nome && (f.parcelaId || "") === parcelaKey);
  const porCat = espCatAtivo();

  let corpo;
  if (porCat) {
    // subpastas por categoria, no padrão das fotos de parcela (seção + 📷 + galeria)
    corpo = CATEGORIAS_ESP.map((cat) => {
      const fc = fotos.filter((f) => (f.categoria || "Geral") === cat);
      return `<div class="cat-sec">
        <div class="cat-head"><b>${cat}</b><button class="btn-foto" data-cat="${esc(cat)}" title="Foto em ${esc(cat)}">📷</button></div>
        ${fc.length ? galeriaHTML(fc) : '<p class="vazio-min">— sem fotos</p>'}
      </div>`;
    }).join("");
  } else {
    corpo = `<button class="btn-grande" id="ef-foto">📷 Tirar foto aqui</button>
      <div id="ef-galeria">${galeriaHTML(fotos)}</div>`;
  }

  app.innerHTML = `${header(titulo, () => telaEspecie(invId, nome))}
    <main>
      <div class="sec-fotos-head">
        <div class="info" style="flex:1;margin:0"><i>${esc(nome)}</i> · ${esc(titulo)}</div>
        <button class="btn-icone-disc" id="toggle-cat" title="${porCat ? "Ver tudo junto" : "Separar por categoria (Geral/Vegetativo/Tronco/Reprodutivo)"}">${porCat ? "🗂️" : "📁"}</button>
      </div>
      ${corpo}
    </main>`;
  ligarVoltar(() => telaEspecie(invId, nome));
  $("#toggle-cat").onclick = () => {
    localStorage.setItem("aflora-esp-cat", porCat ? "0" : "1");
    telaEspecieFotos(invId, nome, parcelaKey);
  };
  if (porCat) {
    $$("[data-cat]").forEach((el) => {
      el.onclick = async () => {
        const foto = await capturarFoto(invId, "especie", nome, { parcelaId: parcelaKey, categoria: el.dataset.cat });
        if (foto) telaEspecieFotos(invId, nome, parcelaKey);
      };
    });
    ligarDelFoto("main", () => telaEspecieFotos(invId, nome, parcelaKey));
  } else {
    $("#ef-foto").onclick = async () => {
      const foto = await capturarFoto(invId, "especie", nome, { parcelaId: parcelaKey });
      if (foto) telaEspecieFotos(invId, nome, parcelaKey);
    };
    ligarDelFoto("#ef-galeria", () => telaEspecieFotos(invId, nome, parcelaKey));
  }
}

// TELA — fotos de uma parcela por categoria (Geral/Serrapilheira/Dossel/Sub-bosque)
async function telaFotosParcela(parcelaId) {
  if (!inv) return telaInventarios();
  const p = inv.parcelas.find((x) => x.id === parcelaId);
  if (!p) return telaInventario(inv.id);
  revogarUrls();
  const fotos = (await db.fotosDoInventario(inv.id)).filter((f) => f.tipo === "parcela" && f.refKey === parcelaId);
  // leitura de GPS em segundo plano (sem travar o gesto da câmera)
  let ultimaCoord = { lat: p.lat ?? null, lon: p.lon ?? null };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { ultimaCoord = { lat: pos.coords.latitude, lon: pos.coords.longitude }; },
      () => {}, { enableHighAccuracy: true, timeout: 10000 });
  }
  const secoes = CATEGORIAS_FOTO.map((cat) => {
    const fc = fotos.filter((f) => (f.categoria || "Geral") === cat);
    return `<div class="cat-sec">
      <div class="cat-head"><b>${cat}</b><button class="btn-foto" data-cat="${cat}">📷</button></div>
      ${fc.length ? galeriaHTML(fc) : '<p class="vazio-min">— sem fotos</p>'}
    </div>`;
  }).join("");
  app.innerHTML = `${header("Fotos · " + (p.rotulo || "parcela"), () => telaParcelasDoEstrato(p.estratoId))}
    <main>
      <div class="info">Escolha o tipo e toque em 📷. Nome, coordenadas e data são carimbados <b>só na exportação</b>.</div>
      ${secoes}
    </main>`;
  ligarVoltar(() => telaParcelasDoEstrato(p.estratoId));
  $$("[data-cat]").forEach((el) => {
    el.onclick = async () => {
      const foto = await capturarFoto(inv.id, "parcela", parcelaId, { ...ultimaCoord, categoria: el.dataset.cat });
      if (foto) telaFotosParcela(parcelaId);
    };
  });
  ligarDelFoto("main", () => telaFotosParcela(parcelaId));
}

// EXPORT — ZIP fotos de espécies: <espécie>/<parcela ou Sem parcela>/<espécie>_N.jpg
async function exportarZipEspecies(invId) {
  const inv2 = await db.obterInventario(invId);
  const fotos = (await db.fotosDoInventario(invId)).filter((f) => f.tipo === "especie");
  if (!fotos.length) { alert("Nenhuma foto de espécie pra exportar."); return; }
  const rotulo = {};
  for (const p of inv2.parcelas) rotulo[p.id] = p.rotulo || p.id;
  const arquivos = [];
  const cont = {};
  for (const f of fotos) {
    const esp = nomeSeguro(f.refKey);
    const sub = f.parcelaId ? nomeSeguro(rotulo[f.parcelaId] || f.parcelaId) : "Sem parcela";
    // categoria vira subpasta só quando definida e diferente de "Geral" (mantém compat.)
    const cat = (f.categoria && f.categoria !== "Geral") ? "/" + nomeSeguro(f.categoria) : "";
    const chave = esp + "/" + sub + cat;
    cont[chave] = (cont[chave] || 0) + 1;
    arquivos.push({ nome: `${chave}/${esp}_${cont[chave]}.jpg`, dados: await f.blob.arrayBuffer() });
  }
  baixar(`${nomeSeguro(inv2.nome)}_fotos_especies.zip`, criarZip(arquivos), "application/zip");
}

// EXPORT — ZIP fotos de parcelas: <categoria>/<parcela>/<parcela>_N.jpg (carimba nome+cat+coords+data)
async function exportarZipParcelas(invId) {
  const inv2 = await db.obterInventario(invId);
  const fotos = (await db.fotosDoInventario(invId)).filter((f) => f.tipo === "parcela");
  if (!fotos.length) { alert("Nenhuma foto de parcela pra exportar."); return; }
  const rotulo = {};
  for (const p of inv2.parcelas) rotulo[p.id] = p.rotulo || p.id;
  const arquivos = [];
  const cont = {};
  for (const f of fotos) {
    const rot = rotulo[f.refKey] || f.refKey;
    const cat = f.categoria || "Geral";
    const chave = nomeSeguro(cat) + "/" + nomeSeguro(rot);
    cont[chave] = (cont[chave] || 0) + 1;
    const carimbada = await carimbarTexto(f.blob, [`${rot} · ${cat}`, coordTexto(f.lat, f.lon), dataTexto(f.capturadaEm)]);
    arquivos.push({ nome: `${chave}/${nomeSeguro(rot)}_${cont[chave]}.jpg`, dados: await carimbada.arrayBuffer() });
  }
  baixar(`${nomeSeguro(inv2.nome)}_fotos_parcelas.zip`, criarZip(arquivos), "application/zip");
}

// ============================================================
// CENSO — mapa estilo AlpineQuest (Leaflet): posição + mira central +
// distância/rumo ao vivo, criar pontos georreferenciados, baixar área offline.
// ============================================================
const TILE_ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// Google: endpoint não-oficial (sem chave). Host fixo (mt1) pra o pré-download
// casar com o que o Leaflet pede (sem subdomínio rotativo). lyrs=s satélite, y híbrido.
const TILE_GSAT = "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
const TILE_GHIB = "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";
// camadas de satélite oferecidas no seletor (1ª = padrão). maxNativeZoom = até onde
// existe imagem real; acima disso o Leaflet só amplia (overzoom) pra dar mais zoom.
const CAMADAS_SAT = [
  { nome: "Google Satélite", url: TILE_GSAT, maxNativeZoom: 20 },
  { nome: "Google Híbrido (nomes)", url: TILE_GHIB, maxNativeZoom: 20 },
  { nome: "Esri (reserva)", url: TILE_ESRI, maxNativeZoom: 19 },
];
let _mapa = null, _watchId = null, _orientHandler = null;

function destruirMapa() {
  if (_watchId != null && navigator.geolocation) { navigator.geolocation.clearWatch(_watchId); _watchId = null; }
  if (_orientHandler) {
    window.removeEventListener("deviceorientationabsolute", _orientHandler);
    window.removeEventListener("deviceorientation", _orientHandler);
    _orientHandler = null;
  }
  if (_mapa) { try { _mapa.remove(); } catch (e) { /* */ } _mapa = null; }
}
// distância (m) e rumo (graus) entre dois {lat,lng} — Haversine
function distanciaM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function rumoGraus(a, b) {
  const toR = Math.PI / 180, toD = 180 / Math.PI;
  const y = Math.sin((b.lng - a.lng) * toR) * Math.cos(b.lat * toR);
  const x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lng - a.lng) * toR);
  return (Math.atan2(y, x) * toD + 360) % 360;
}
const fmtCoordDec = (lat, lng) => `${fmtNum(lat, 6)}, ${fmtNum(lng, 6)}`;
// XYZ tile a partir de lon/lat (Web Mercator) — pro pré-download de área
function lonLatParaTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latR = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  const clamp = (v) => Math.max(0, Math.min(n - 1, v));
  return { x: clamp(x), y: clamp(y) };
}

async function telaCenso(estratoId) {
  if (!inv) return telaInventarios();
  const est = estPorId(estratoId);
  if (!est) return telaInventario(inv.id);
  est.pontos = est.pontos || [];
  destruirMapa();
  if (!window.L) {
    app.innerHTML = `${header("Censo", () => telaInventario(inv.id))}
      <main><div class="info">O mapa (Leaflet) não carregou. Abra com internet na 1ª vez pra ele ficar disponível offline depois.</div></main>`;
    ligarVoltar(() => telaInventario(inv.id));
    return;
  }
  const voltar = () => { destruirMapa(); telaInventario(inv.id); };
  // tela cheia (estilo AlpineQuest): mapa ocupa tudo, controles flutuam por cima.
  app.innerHTML = `<div class="censo-tela">
      <div id="mapa"></div>
      <div class="censo-dot" id="censo-dot"></div>
      <div class="censo-label" id="censo-label" hidden></div>
      <button class="censo-fab censo-voltar" id="censo-voltar" aria-label="Voltar">‹</button>
      <div class="bussola" id="bussola" hidden><div class="bussola-rosa" id="bussola-rosa"><span class="bussola-n">N</span></div><span class="bussola-deg" id="bussola-deg">—</span></div>
      <div class="trk-banner" id="trk-banner" hidden></div>
      <div class="censo-fabs">
        <button class="censo-fab" id="censo-lista" title="Lista de pontos">📋</button>
        <button class="censo-fab" id="censo-centrar" title="Centralizar em mim">🎯</button>
        <button class="censo-fab" id="censo-bussola" title="Bússola">🧭</button>
        <button class="censo-fab" id="censo-trilha" title="Gravar trilha">🛤️</button>
        <button class="censo-fab" id="censo-desenho" title="Desenhar polígono">✏️</button>
        <button class="censo-fab" id="censo-importar" title="Importar KML (ADA…)">📂</button>
        <button class="censo-fab" id="censo-baixar" title="Baixar área offline">⬇</button>
      </div>
      <input type="file" id="kml-file" accept=".kml,application/vnd.google-earth.kml+xml" hidden>
      <button class="btn-grande destaque censo-add-fixo" id="censo-add">+ Ponto</button>
      <div class="censo-barra" id="censo-barra" hidden></div>
      <div class="censo-sheet" id="censo-painel"></div>
    </div>`;

  const L = window.L;
  let centro = [-19.65, -43.9];
  const comCoord = est.pontos.filter((p) => p.lat != null);
  if (comCoord.length) centro = [comCoord[comCoord.length - 1].lat, comCoord[comCoord.length - 1].lon];
  const map = L.map("mapa", { zoomControl: false, attributionControl: false, maxZoom: 21 }).setView(centro, 17);
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  _mapa = map;
  // camadas de satélite + seletor (igual "Mapas disponíveis" do AlpineQuest).
  // tileTemplate guarda a URL da camada ativa pro pré-download de área.
  let tileTemplate = CAMADAS_SAT[0].url;
  const baseLayers = {};
  // tile transparente p/ falhas (offline sem cache) — em vez de quadrado branco/ícone quebrado
  const TILE_ERRO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  CAMADAS_SAT.forEach((c, i) => {
    const layer = L.tileLayer(c.url, {
      maxZoom: 21, maxNativeZoom: c.maxNativeZoom,
      keepBuffer: 6,            // mantém mais tiles ao redor → menos borda branca no pan
      updateWhenZooming: false, // não recarrega no meio do zoom (evita pisca)
      updateWhenIdle: true,     // só busca novos tiles quando para de mexer
      errorTileUrl: TILE_ERRO,  // falha offline = transparente (fundo escuro), não branco
    });
    baseLayers[c.nome] = layer;
    if (i === 0) layer.addTo(map);
  });
  L.control.layers(baseLayers, null, { collapsed: true }).addTo(map);
  map.on("baselayerchange", (ev) => {
    const c = CAMADAS_SAT.find((x) => x.nome === ev.name);
    if (c) tileTemplate = c.url;
  });
  setTimeout(() => map.invalidateSize(), 120); // o container acabou de entrar no DOM

  let userLatLng = null, userAlt = null, userAcc = null, userMarker = null, linha = null;
  const iconeEu = L.divIcon({ className: "marcador-eu", html: '<div class="cone-eu" hidden></div><div class="dot-eu"></div>', iconSize: [22, 22] });

  // linha fina da minha posição até a mira (bolinha central no DOM) + label na linha
  function atualizarLeitura() {
    const c = map.getCenter();
    const lbl = $("#censo-label");
    if (!lbl) return;
    if (userLatLng) {
      const d = distanciaM(userLatLng, c);
      lbl.hidden = false;
      lbl.innerHTML = `<b>${fmtNum(d, 0)} m</b>`;
      if (!linha) linha = L.polyline([userLatLng, c], { color: "#1565C0", weight: 1.6, opacity: 0.85, dashArray: null }).addTo(map);
      else linha.setLatLngs([userLatLng, c]);
    } else {
      lbl.hidden = false;
      lbl.innerHTML = "<span>aguardando GPS…</span>";
    }
  }
  map.on("move", atualizarLeitura);

  // rastro recente (breadcrumb): segmentos amarelos que vão sumindo conforme ando.
  const RASTRO_MAX = 30;
  const rastro = [];
  const rastroLayer = L.layerGroup().addTo(map);
  function desenharRastro() {
    rastroLayer.clearLayers();
    for (let i = 1; i < rastro.length; i++) {
      const op = (i / rastro.length) * 0.75; // mais novo = mais visível; mais antigo apaga
      L.polyline([rastro[i - 1], rastro[i]], { color: "#FFC107", weight: 3, opacity: op }).addTo(rastroLayer);
    }
  }

  // estado do gravador de trilha (declarado aqui pra o watch enxergar)
  let gravando = false, trilhaPts = [], trilhaLinha = null;
  function comprimentoTrilha(pts) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += distanciaM({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] });
    return s;
  }
  function atualizarTrkBanner() {
    const b = $("#trk-banner");
    if (b) b.innerHTML = `⏺ gravando · <b>${fmtNum(comprimentoTrilha(trilhaPts), 0)} m</b> · ${trilhaPts.length} pts`;
  }

  if (navigator.geolocation) {
    _watchId = navigator.geolocation.watchPosition((pos) => {
      userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      userAlt = pos.coords.altitude; userAcc = pos.coords.accuracy;
      if (!userMarker) { userMarker = L.marker(userLatLng, { icon: iconeEu }).addTo(map); map.setView(userLatLng, map.getZoom()); }
      else userMarker.setLatLng(userLatLng);
      // só guarda no rastro se andei o suficiente (não polui parado)
      const last = rastro[rastro.length - 1];
      if (!last || distanciaM({ lat: last[0], lng: last[1] }, userLatLng) > 2) {
        rastro.push([userLatLng.lat, userLatLng.lng]);
        if (rastro.length > RASTRO_MAX) rastro.shift();
        desenharRastro();
      }
      // gravando trilha → acumula posições (a cada >2 m)
      if (gravando) {
        const lp = trilhaPts[trilhaPts.length - 1];
        if (!lp || distanciaM({ lat: lp[0], lng: lp[1] }, userLatLng) > 2) {
          trilhaPts.push([userLatLng.lat, userLatLng.lng]);
          if (!trilhaLinha) trilhaLinha = L.polyline(trilhaPts, { color: "#E53935", weight: 4, opacity: 0.9 }).addTo(map);
          else trilhaLinha.setLatLngs(trilhaPts);
          atualizarTrkBanner();
        }
      }
      atualizarLeitura();
    }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }

  function renderPontos() {
    if (renderPontos._layer) renderPontos._layer.remove();
    const grupo = L.layerGroup();
    est.pontos.forEach((pt, i) => {
      if (pt.lat == null) return;
      const ic = L.divIcon({ className: "marcador-ponto", html: `<div class="pin-ponto">${esc(pt.placa || (i + 1))}</div>`, iconSize: [30, 30] });
      const m = L.marker([pt.lat, pt.lon], { icon: ic, draggable: true });
      m.on("click", () => abrirFormPonto(pt, false));
      // arrastar o pino reposiciona o ponto
      m.on("dragend", async () => { const ll = m.getLatLng(); pt.lat = ll.lat; pt.lon = ll.lng; await salvarJa(); });
      grupo.addLayer(m);
    });
    grupo.addTo(map);
    renderPontos._layer = grupo;
  }
  renderPontos();
  atualizarLeitura();

  $("#censo-voltar").onclick = voltar;
  $("#censo-centrar").onclick = () => { if (userLatLng) map.setView(userLatLng, Math.max(map.getZoom(), 18)); };
  $("#censo-add").onclick = () => {
    const c = map.getCenter();
    abrirFormPonto(novoPontoCenso(c.lat, c.lng, userAlt), true);
  };
  $("#censo-baixar").onclick = () => baixarAreaCenso();
  // some/mostra o botão "+ Ponto" conforme o painel (sheet) abre/fecha
  const mostrarAdd = (v) => { const b = $("#censo-add"); if (b) b.style.display = v ? "" : "none"; };

  est.trilhas = est.trilhas || [];
  est.poligonos = est.poligonos || [];

  // ----- trilhas e polígonos salvos no mapa -----
  function renderTrilhas() {
    if (renderTrilhas._l) renderTrilhas._l.remove();
    const g = L.layerGroup();
    for (const t of est.trilhas) if (t.pontos && t.pontos.length > 1) L.polyline(t.pontos, { color: "#E53935", weight: 3, opacity: 0.7 }).addTo(g);
    g.addTo(map); renderTrilhas._l = g;
  }
  function renderPoligonos() {
    if (renderPoligonos._l) renderPoligonos._l.remove();
    const g = L.layerGroup();
    for (const p of est.poligonos) {
      if (!p.coords || p.coords.length < 3) continue;
      const poly = L.polygon(p.coords, { color: "#2E7D32", weight: 2, fillColor: "#43A047", fillOpacity: 0.25 });
      poly.bindTooltip(`${esc(p.nome || "polígono")} · ${fmtNum(p.areaM2 / 10000, 4)} ha`);
      poly.on("click", async () => { if (confirm(`Excluir o polígono "${p.nome || ""}"?`)) { est.poligonos = est.poligonos.filter((x) => x.id !== p.id); await salvarJa(); renderPoligonos(); } });
      poly.addTo(g);
    }
    g.addTo(map); renderPoligonos._l = g;
  }
  renderTrilhas(); renderPoligonos();

  // ----- bússola (orientação do aparelho) -----
  let bussolaOn = false;
  function onOrient(ev) {
    let h = (ev.webkitCompassHeading != null) ? ev.webkitCompassHeading
      : (ev.absolute && ev.alpha != null) ? (360 - ev.alpha) : null;
    if (h == null) return;
    const rosa = $("#bussola-rosa"), deg = $("#bussola-deg");
    if (rosa) rosa.style.transform = `rotate(${-h}deg)`;
    if (deg) deg.textContent = `${fmtNum(h, 0)}°`;
    // cone de direção no ponto azul (mostra pra onde estou virado)
    if (userMarker && userMarker._icon) {
      const cone = userMarker._icon.querySelector(".cone-eu");
      if (cone) { cone.hidden = false; cone.style.transform = `translateX(-50%) rotate(${h}deg)`; }
    }
  }
  $("#censo-bussola").onclick = async () => {
    bussolaOn = !bussolaOn;
    $("#censo-bussola").classList.toggle("ativo", bussolaOn);
    const w = $("#bussola"); if (w) w.hidden = !bussolaOn;
    if (bussolaOn) {
      try {
        if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
          const p = await DeviceOrientationEvent.requestPermission();
          if (p !== "granted") { bussolaOn = false; if (w) w.hidden = true; $("#censo-bussola").classList.remove("ativo"); return; }
        }
      } catch (e) { /* */ }
      _orientHandler = onOrient;
      window.addEventListener("deviceorientationabsolute", _orientHandler);
      window.addEventListener("deviceorientation", _orientHandler);
    } else if (_orientHandler) {
      window.removeEventListener("deviceorientationabsolute", _orientHandler);
      window.removeEventListener("deviceorientation", _orientHandler);
      _orientHandler = null;
    }
  };

  // ----- gravador de trilha (start/stop) -----
  $("#censo-trilha").onclick = async () => {
    if (!gravando) {
      gravando = true;
      trilhaPts = []; if (trilhaLinha) { trilhaLinha.remove(); trilhaLinha = null; }
      if (userLatLng) trilhaPts.push([userLatLng.lat, userLatLng.lng]);
      $("#censo-trilha").classList.add("ativo");
      const b = $("#trk-banner"); if (b) b.hidden = false;
      atualizarTrkBanner();
    } else {
      gravando = false;
      $("#censo-trilha").classList.remove("ativo");
      if (trilhaPts.length >= 2) {
        const nome = prompt("Nome da trilha:", "Trilha " + (est.trilhas.length + 1));
        if (nome != null) {
          const t = novaTrilha(nome.trim() || "Trilha " + (est.trilhas.length + 1));
          t.pontos = trilhaPts.slice();
          est.trilhas.push(t); await salvarJa(); renderTrilhas();
        }
      }
      if (trilhaLinha) { trilhaLinha.remove(); trilhaLinha = null; }
      trilhaPts = [];
      const b = $("#trk-banner"); if (b) { b.hidden = true; b.innerHTML = ""; }
    }
  };

  // ----- desenho de polígono (por pontos ou à mão livre pelo cursor) -----
  let desenho = null;
  function limparDesenho() {
    if (desenho) {
      if (desenho.layer) desenho.layer.remove();
      if (desenho.moveHandler) map.off("move", desenho.moveHandler);
    }
    desenho = null;
    const barra = $("#censo-barra"); if (barra) { barra.hidden = true; barra.innerHTML = ""; }
    mostrarAdd(true);
    $("#censo-desenho").classList.remove("ativo");
  }
  function redesenharDesenho() {
    if (!desenho) return;
    if (desenho.layer) { desenho.layer.remove(); desenho.layer = null; }
    if (desenho.coords.length >= 3) {
      desenho.layer = L.polygon(desenho.coords, { color: "#FF6F00", weight: 2, fillColor: "#FFA000", fillOpacity: 0.2, dashArray: "5,5" }).addTo(map);
    } else if (desenho.coords.length === 2) {
      desenho.layer = L.polyline(desenho.coords, { color: "#FF6F00", weight: 2, dashArray: "5,5" }).addTo(map);
    } else if (desenho.coords.length === 1) {
      desenho.layer = L.circleMarker(desenho.coords[0], { radius: 4, color: "#FF6F00" }).addTo(map);
    }
    const area = desenho.coords.length >= 3 ? areaAnelM2(desenho.coords) : 0;
    const info = $("#barra-info"); if (info) info.innerHTML = `${desenho.coords.length} vértices${area ? ` · <b>${fmtNum(area / 10000, 4)} ha</b>` : ""}`;
  }
  async function concluirDesenho() {
    if (!desenho || desenho.coords.length < 3) { alert("Precisa de pelo menos 3 vértices."); return; }
    const nome = prompt("Nome do polígono:", "Polígono " + (est.poligonos.length + 1));
    if (nome == null) return;
    const pol = novoPoligono(desenho.tipo, nome.trim() || "Polígono " + (est.poligonos.length + 1));
    pol.coords = desenho.coords.slice();
    pol.areaM2 = areaAnelM2(pol.coords);
    est.poligonos.push(pol); await salvarJa();
    limparDesenho(); renderPoligonos();
  }
  function iniciarDesenho(tipo) {
    limparDesenho();
    mostrarAdd(false);
    $("#censo-desenho").classList.add("ativo");
    desenho = { tipo, coords: [], layer: null, moveHandler: null };
    const barra = $("#censo-barra"); barra.hidden = false;
    if (tipo === "pontos") {
      barra.innerHTML = `<span id="barra-info">0 vértices</span>
        <button class="btn-sec" id="b-vert">+ Vértice</button>
        <button class="btn-sec" id="b-desf">↶</button>
        <button class="btn-grande destaque" id="b-ok">✓ Fechar</button>
        <button class="btn-foto" id="b-cancel">✕</button>`;
      $("#b-vert").onclick = () => { const c = map.getCenter(); desenho.coords.push([c.lat, c.lng]); redesenharDesenho(); };
      $("#b-desf").onclick = () => { desenho.coords.pop(); redesenharDesenho(); };
      $("#b-ok").onclick = concluirDesenho;
      $("#b-cancel").onclick = limparDesenho;
    } else {
      barra.innerHTML = `<span id="barra-info">mexa o mapa pra traçar</span>
        <button class="btn-grande destaque" id="b-ok">✓ Concluir</button>
        <button class="btn-foto" id="b-cancel">✕</button>`;
      let ultimo = null;
      desenho.moveHandler = () => {
        const c = map.getCenter();
        if (!ultimo || distanciaM(ultimo, c) > 3) { desenho.coords.push([c.lat, c.lng]); ultimo = c; redesenharDesenho(); }
      };
      map.on("move", desenho.moveHandler);
      $("#b-ok").onclick = concluirDesenho;
      $("#b-cancel").onclick = limparDesenho;
    }
    redesenharDesenho();
  }
  $("#censo-desenho").onclick = () => {
    if (desenho) { limparDesenho(); return; }
    const barra = $("#censo-barra"); barra.hidden = false; mostrarAdd(false);
    barra.innerHTML = `<span>Polígono:</span>
      <button class="btn-sec" id="d-pontos">📍 Por pontos</button>
      <button class="btn-sec" id="d-mao">✍️ À mão livre</button>
      <button class="btn-foto" id="d-cancel">✕</button>`;
    $("#d-pontos").onclick = () => iniciarDesenho("pontos");
    $("#d-mao").onclick = () => iniciarDesenho("maolivre");
    $("#d-cancel").onclick = () => { barra.hidden = true; barra.innerHTML = ""; mostrarAdd(true); };
  };

  // ----- lista de pontos (ordenável) -----
  function pontosOrdenados(modo) {
    const base = est.pontos.map((pt, i) => ({ pt, entrada: i }));
    if (modo === "placa") {
      base.sort((a, b) => {
        const pa = (a.pt.placa || "").trim(), pb = (b.pt.placa || "").trim();
        if (!pa) return pb ? 1 : a.entrada - b.entrada;
        if (!pb) return -1;
        return pa.localeCompare(pb, "pt-BR", { numeric: true });
      });
    } else if (modo === "especie") {
      base.sort((a, b) => (a.pt.especie || "~").localeCompare(b.pt.especie || "~", "pt-BR") || a.entrada - b.entrada);
    }
    return base;
  }
  function abrirLista() {
    const painel = $("#censo-painel"); mostrarAdd(false);
    const modo = localStorage.getItem("aflora-censo-ord") || "entrada";
    const modos = [["entrada", "Ordem de entrada"], ["placa", "Placa"], ["especie", "Espécie"]];
    const ordOpts = modos.map(([v, t]) => `<option value="${v}" ${v === modo ? "selected" : ""}>${t}</option>`).join("");
    const itens = pontosOrdenados(modo).map(({ pt, entrada }) => {
      const vi = volumeIndividuo(pt.fustes, est.fitofisionomia);
      return `<div class="card" data-pt="${pt.id}"><div class="card-corpo">
        <div class="card-nome">#${esc(pt.placa || (entrada + 1))} <i>${esc(pt.especie || "—")}</i></div>
        <div class="card-sub">${pt.fustes.length} fuste(s) · ${fmtNum(vi.vol_aereo, 4)} m³${pt.lat != null ? " · 📍" : " · sem coord"}</div>
      </div></div>`;
    }).join("") || '<p class="vazio">Nenhum ponto ainda.</p>';
    painel.innerHTML = `<div class="censo-form">
      <div class="censo-form-top"><b>Pontos (${est.pontos.length})</b>
        <label class="ord-mini" style="flex:1">Organizar <select id="lst-ord">${ordOpts}</select></label>
        <button class="btn-foto" id="lst-fechar">✕</button></div>
      <div class="cards">${itens}</div></div>`;
    $("#lst-ord").onchange = (e) => { localStorage.setItem("aflora-censo-ord", e.target.value); abrirLista(); };
    $("#lst-fechar").onclick = () => { painel.innerHTML = ""; mostrarAdd(true); };
    $$("[data-pt]").forEach((el) => {
      el.onclick = () => {
        const pt = est.pontos.find((x) => x.id === el.dataset.pt);
        if (!pt) return;
        if (pt.lat != null) map.setView([pt.lat, pt.lon], Math.max(map.getZoom(), 18));
        abrirFormPonto(pt, false);
      };
    });
  }
  $("#censo-lista").onclick = abrirLista;

  // ----- importar KML (referência: ADA, talhões…) -----
  est.referencias = est.referencias || [];
  function parseKML(txt) {
    const doc = new DOMParser().parseFromString(txt, "application/xml");
    const out = [];
    const coordsDe = (pm, tag) => {
      const el = pm.getElementsByTagName(tag)[0]; if (!el) return null;
      const c = (el.getElementsByTagName("coordinates")[0]?.textContent || "").trim();
      if (!c) return null;
      return c.split(/\s+/).map((p) => { const [lo, la] = p.split(",").map(Number); return [la, lo]; })
        .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
    };
    for (const pm of doc.getElementsByTagName("Placemark")) {
      const nome = (pm.getElementsByTagName("name")[0]?.textContent || "").trim();
      if (pm.getElementsByTagName("Polygon")[0]) { const co = coordsDe(pm, "Polygon"); if (co && co.length >= 3) out.push({ nome, tipo: "poligono", coords: co }); }
      else if (pm.getElementsByTagName("LineString")[0]) { const co = coordsDe(pm, "LineString"); if (co && co.length >= 2) out.push({ nome, tipo: "linha", coords: co }); }
      else if (pm.getElementsByTagName("Point")[0]) { const co = coordsDe(pm, "Point"); if (co && co.length >= 1) out.push({ nome, tipo: "ponto", coords: co }); }
    }
    return out;
  }
  function renderReferencias() {
    if (renderReferencias._l) renderReferencias._l.remove();
    const g = L.layerGroup();
    for (const r of est.referencias) {
      let lay;
      if (r.tipo === "poligono") lay = L.polygon(r.coords, { color: "#00BCD4", weight: 2, fill: false, dashArray: "6,4" });
      else if (r.tipo === "linha") lay = L.polyline(r.coords, { color: "#00BCD4", weight: 2, dashArray: "6,4" });
      else lay = L.circleMarker(r.coords[0], { radius: 5, color: "#00BCD4" });
      if (r.nome) lay.bindTooltip(r.nome);
      lay.on("click", async () => { if (confirm(`Remover a referência "${r.nome || r.tipo}"?`)) { est.referencias = est.referencias.filter((x) => x !== r); await salvarJa(); renderReferencias(); } });
      lay.addTo(g);
    }
    g.addTo(map); renderReferencias._l = g;
  }
  renderReferencias();
  $("#censo-importar").onclick = () => $("#kml-file").click();
  $("#kml-file").onchange = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    try {
      const geoms = parseKML(await file.text());
      if (!geoms.length) { alert("Não achei geometrias (polígono/linha/ponto) nesse KML."); e.target.value = ""; return; }
      est.referencias.push(...geoms.map((g) => ({ ...g, fonte: file.name })));
      await salvarJa(); renderReferencias();
      const first = geoms.find((g) => g.coords.length > 1);
      if (first) map.fitBounds(L.latLngBounds(first.coords));
      alert(`Importado: ${geoms.length} feição(ões) de ${file.name}. Toque numa referência pra remover.`);
    } catch (err) { alert("Erro ao ler KML: " + (err?.message || err)); }
    e.target.value = "";
  };

  // form do ponto: sobe num painel (sheet) sobre o rodapé do mapa — não sai da tela
  function abrirFormPonto(pt, ehNovo) {
    const painel = $("#censo-painel");
    mostrarAdd(false);
    const fustesHtml = () => pt.fustes.map((f, i) => `<div class="fuste-linha" data-i="${i}">
      <span class="fuste-num">${i + 1}</span>
      <input class="cf-cap" data-i="${i}" type="number" step="0.1" inputmode="decimal" placeholder="CAP" value="${f.capCm ?? ""}">
      <input class="cf-alt" data-i="${i}" type="number" step="0.1" inputmode="decimal" placeholder="Altura" value="${f.alturaM ?? ""}">
      ${pt.fustes.length > 1 ? `<button class="perigo cf-fdel" data-i="${i}">✕</button>` : "<span></span>"}
    </div>`).join("");
    painel.innerHTML = `<div class="censo-form">
      <div class="censo-form-top">
        <b>${ehNovo ? "Novo ponto" : "Editar ponto"}</b>
        <span class="censo-form-coord">${pt.lat != null ? fmtCoordDec(pt.lat, pt.lon) : "sem coord"}</span>
        <button class="btn-foto" id="cf-fechar">✕</button>
      </div>
      <label class="campo">Placa<input id="cf-placa" value="${esc(pt.placa)}" inputmode="numeric"></label>
      <label class="campo">Espécie
        <div class="autocomplete">
          <input id="cf-especie" value="${esc(pt.especie)}" autocomplete="off" placeholder="Digite ou toque em ▾">
          <button type="button" class="ac-toggle" id="cf-esp-toggle">▾</button>
          <div class="ac-lista" id="cf-esp-lista" hidden></div>
        </div></label>
      <button class="btn-sec largo" id="cf-mover">📍 Mover ponto pra mira do mapa</button>
      <h3>Fustes <small>(CAP cm · altura m)</small></h3>
      <div id="cf-fustes">${fustesHtml()}</div>
      <button class="btn-sec" id="cf-addfuste">+ Fuste</button>
      <div class="acoes-linha">
        <button class="btn-grande destaque" id="cf-salvar">✓ Salvar</button>
        ${!ehNovo ? '<button class="perigo" id="cf-excluir">🗑</button>' : ""}
      </div>
    </div>`;
    const ligarFustes = () => {
      $$(".cf-cap").forEach((el) => { el.oninput = () => { pt.fustes[+el.dataset.i].capCm = parseFloat(el.value) || null; }; });
      $$(".cf-alt").forEach((el) => { el.oninput = () => { pt.fustes[+el.dataset.i].alturaM = parseFloat(el.value) || null; }; });
      $$(".cf-fdel").forEach((el) => { el.onclick = () => { pt.fustes.splice(+el.dataset.i, 1); $("#cf-fustes").innerHTML = fustesHtml(); ligarFustes(); }; });
    };
    ligarFustes();
    $("#cf-placa").oninput = (e) => { pt.placa = e.target.value; };
    const setEsp = (v) => { pt.especie = v; };
    $("#cf-especie").oninput = (e) => setEsp(e.target.value);
    ligarAutocomplete($("#cf-especie"), $("#cf-esp-toggle"), $("#cf-esp-lista"), () => especiesDoInventario(inv), setEsp);
    $("#cf-addfuste").onclick = () => { pt.fustes.push(novoFuste()); $("#cf-fustes").innerHTML = fustesHtml(); ligarFustes(); };
    $("#cf-mover").onclick = async () => {
      const c = map.getCenter();
      pt.lat = c.lat; pt.lon = c.lng;
      const sp = $(".censo-form-coord"); if (sp) sp.textContent = fmtCoordDec(pt.lat, pt.lon);
      if (!est.pontos.includes(pt)) est.pontos.push(pt);
      await salvarJa(); renderPontos();
    };
    const fechar = () => { painel.innerHTML = ""; mostrarAdd(true); };
    $("#cf-fechar").onclick = fechar;
    $("#cf-salvar").onclick = async () => {
      if (ehNovo && !est.pontos.includes(pt)) est.pontos.push(pt);
      if ((pt.especie || "").trim()) adicionarEspecie(inv, pt.especie.trim());
      await salvarJa();
      fechar();
      renderPontos();
    };
    if (!ehNovo) {
      $("#cf-excluir").onclick = async () => {
        if (!confirm("Excluir este ponto?")) return;
        est.pontos = est.pontos.filter((x) => x.id !== pt.id);
        await salvarJa();
        fechar();
        renderPontos();
      };
    }
  }

  // pré-download da área visível numa FAIXA de zooms (afasta e aproxima offline
  // sem ficar branco): do zoom atual −2 até +2 (limitado 13..19).
  async function baixarAreaCenso() {
    const painel = $("#censo-painel");
    const b = map.getBounds();
    const z0 = Math.round(map.getZoom());
    const zMin = Math.max(13, z0 - 2);
    const zMax = Math.min(19, z0 + 2);
    const urls = [];
    for (let z = zMin; z <= zMax; z++) {
      const t1 = lonLatParaTile(b.getWest(), b.getNorth(), z);
      const t2 = lonLatParaTile(b.getEast(), b.getSouth(), z);
      for (let x = t1.x; x <= t2.x; x++) {
        for (let y = t1.y; y <= t2.y; y++) {
          urls.push(tileTemplate.replace("{z}", z).replace("{x}", x).replace("{y}", y));
        }
      }
    }
    if (urls.length > 2000 && !confirm(`Essa área tem ${urls.length} tiles (pode demorar/pesar). Aproxime o zoom pra baixar menos, ou continue assim mesmo?`)) return;
    mostrarAdd(false);
    painel.innerHTML = `<div class="censo-form"><div class="info" id="dl-prog">Baixando 0/${urls.length} tiles…</div>
      <button class="btn-sec largo" id="dl-fechar">Fechar</button></div>`;
    $("#dl-fechar").onclick = () => { painel.innerHTML = ""; mostrarAdd(true); };
    let cache;
    try { cache = await caches.open("aflora-tiles-v1"); }
    catch (e) { const el = $("#dl-prog"); if (el) el.textContent = "Cache indisponível neste navegador."; return; }
    let done = 0, falhas = 0;
    for (const u of urls) {
      try { const r = await fetch(u); if (r.ok) await cache.put(u, r.clone()); else falhas++; }
      catch (e) { falhas++; }
      done++;
      if (done % 8 === 0 || done === urls.length) { const el = $("#dl-prog"); if (el) el.textContent = `Baixando ${done}/${urls.length} tiles…`; }
    }
    const el = $("#dl-prog"); if (el) el.innerHTML = `✓ Área salva offline (${done - falhas}/${urls.length} tiles${falhas ? `, ${falhas} falharam` : ""}).`;
  }
}

// ---------- boot ----------
// Modo sol (alto contraste + fonte maior) — togglável, persiste em localStorage.
// Delegado no document porque o cabeçalho (com o botão) é re-renderizado a cada tela.
if (localStorage.getItem("aflora-sol") === "1") document.body.classList.add("sol");
document.addEventListener("click", (e) => {
  if (e.target.closest && e.target.closest("#btn-sol")) {
    const on = document.body.classList.toggle("sol");
    localStorage.setItem("aflora-sol", on ? "1" : "0");
  }
});

async function iniciar() {
  await db.pedirPersistencia();
  if ("serviceWorker" in navigator) {
    // updateViaCache:"none" → o browser sempre busca um sw.js fresco (sem cache
    // HTTP), garantindo que updates cheguem na próxima abertura.
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {});
    // quando um service worker novo assume o controle, recarrega 1x pra já usar
    // a versão nova (resolve o app "travado" numa versão antiga).
    let recarregando = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (recarregando) return;
      recarregando = true;
      location.reload();
    });
  }
  telaInventarios();
}
iniciar();
