// App de campo — UI (SPA vanilla). Navegação por estado, auto-save a cada
// alteração (IndexedDB), barra de erro amostral por estrato ao vivo.
import * as db from "./db.js";
import {
  novoInventario, novoEstrato, novaParcela, novoIndividuo, novoFuste,
  resultadosPorEstrato, areaParcelaHa, fmtNum, outliersDoEstrato,
  ESTAGIOS, rotuloEstrato, mediasParcela,
  semAcento, especiesDoInventario, individuosOrdenados,
  registroEspecies, adicionarEspecie, renomearEspecie,
} from "./modelo.js";
import { volumeIndividuo, EQUACOES_VOLUME } from "./calculos.js";
import { exportarJSON, exportarCSV, exportarXLSX, prepararXLSX, baixar } from "./export.js";
import { comprimirImagem, carimbarTexto, urlDeBlob } from "./imagem.js";
import { criarZip } from "./zip.js";

const app = document.getElementById("app");
const APP_VERSION = "v26"; // manter em sincronia com o CACHE do sw.js
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
function labelEstrato(est) {
  const fito = EQUACOES_VOLUME[est.fitofisionomia]?.rotulo || est.fitofisionomia || "—";
  return `<b>${esc(fito)}</b>${est.estagio ? ` <small>· estágio ${esc(est.estagio)}</small>` : " <small>· sem estágio</small>"}`;
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
  $$("[data-estrato]").forEach((el) => { el.onclick = () => telaParcelasDoEstrato(el.dataset.estrato); });
}

// Completude do estrato (% pronto) = média de: erro amostral batido · campos das
// parcelas preenchidos · fotos de parcela nos 4 tipos.
function completudeEstrato(inv, estrato, resErro, fotos) {
  const parcelas = inv.parcelas.filter((p) => p.estratoId === estrato.id);
  const alvo = inv.config.erroAlvoPct;
  const c1 = (resErro && resErro.erro && resErro.erro.erro_rel_pct <= alvo) ? 1 : 0;
  let completas = 0;
  for (const p of parcelas) {
    const gpsOk = p.lat != null && p.lon != null;
    const indOk = p.individuos.length >= 1 && p.individuos.every((ind) =>
      (ind.especie || "").trim() && ind.fustes.length >= 1
      && ind.fustes.every((f) => f.capCm != null && f.alturaM != null));
    if (gpsOk && indOk) completas++;
  }
  const c2 = parcelas.length ? completas / parcelas.length : 0;
  let somaFotos = 0;
  for (const p of parcelas) {
    const cats = new Set(fotos.filter((f) => f.tipo === "parcela" && f.refKey === p.id).map((f) => f.categoria || "Geral"));
    somaFotos += CATEGORIAS_FOTO.filter((c) => cats.has(c)).length / CATEGORIAS_FOTO.length;
  }
  const c3 = parcelas.length ? somaFotos / parcelas.length : 0;
  return {
    pct: Math.round(((c1 + c2 + c3) / 3) * 100),
    itens: [
      { label: "Erro amostral", frac: c1 },
      { label: "Campos", frac: c2 },
      { label: "Fotos parcela", frac: c3 },
    ],
  };
}

function barraCompletude(comp) {
  const cls = comp.pct >= 100 ? "verde" : comp.pct >= 60 ? "amarelo" : "vermelho";
  const itens = comp.itens.map((i) =>
    `<span class="compl-item ${i.frac >= 1 ? "ok" : "pend"}">${i.frac >= 1 ? "✓" : Math.round(i.frac * 100) + "%"} ${i.label}</span>`).join("");
  return `<div class="compl">
    <div class="compl-top">Completude: <b>${comp.pct}%</b></div>
    <div class="barra"><div class="barra-fill ${cls}" style="width:${comp.pct}%"></div></div>
    <div class="compl-itens">${itens}</div>
  </div>`;
}

// Card de um estrato na tela do inventário: erro + completude, toca pra abrir as parcelas.
function cardEstrato(inv, r, comp) {
  const alvo = inv.config.erroAlvoPct;
  let erro;
  if (!r.erro) {
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
  const parcelas = inv.parcelas.filter((p) => p.estratoId === estratoId);
  const parcelasHtml = parcelas.length
    ? parcelas.map((p) => {
        const volM3 = p.individuos.reduce((s, ind) => s + volumeIndividuo(ind.fustes, estrato.fitofisionomia).vol_aereo, 0);
        const mha = aHa ? volM3 / aHa : null;
        const nf = fotosPorParc[p.id] || 0;
        return `<div class="card">
          <div class="card-corpo" data-parc="${p.id}">
            <div class="card-nome">${esc(p.rotulo || "(sem rótulo)")}</div>
            <div class="card-sub">${p.individuos.length} indiv. · ${fmtNum(volM3, 4)} m³${mha != null ? " · " + fmtNum(mha, 1) + " m³/ha" : ""}${p.lat != null ? " · 📍" : ""}</div>
          </div>
          <div class="card-acoes"><button class="btn-foto" data-fotos-parc="${p.id}" title="Fotos da parcela">📷${nf ? " " + nf : ""}</button></div></div>`;
      }).join("")
    : '<p class="vazio">Nenhuma parcela neste estrato. Toque em "+ Nova parcela".</p>';

  app.innerHTML = `${header(EQUACOES_VOLUME[estrato.fitofisionomia]?.rotulo || "Estrato", () => telaInventario(inv.id))}
    <main>
      <div class="info">${labelEstrato(estrato)}</div>
      <section class="painel-erro">${barraErro(r, inv.config.erroAlvoPct)}</section>
      ${barraCompletude(comp)}
      <button class="btn-grande" id="nova-parc">+ Nova parcela</button>
      <div class="cards">${parcelasHtml}</div>
    </main>`;
  ligarVoltar(() => telaInventario(inv.id));
  $("#nova-parc").onclick = async () => {
    const p = novaParcela(estratoId, "P" + String(inv.parcelas.length + 1).padStart(2, "0"));
    inv.parcelas.push(p);
    await salvarJa();
    telaParcela(p.id);
  };
  $$("[data-fotos-parc]").forEach((el) => { el.onclick = () => telaFotosParcela(el.dataset.fotosParc); });
  $$("[data-parc]").forEach((el) => { el.onclick = () => telaParcela(el.dataset.parc); });
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
  const fitoOpts = (sel) => Object.entries(EQUACOES_VOLUME)
    .map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(v.rotulo)}</option>`).join("");
  const estagioOpts = (sel) => ['<option value="">— (sem estágio)</option>']
    .concat(ESTAGIOS.map((s) => `<option value="${s}" ${s === sel ? "selected" : ""}>${s}</option>`)).join("");
  const estratosHtml = inv.estratos.map((e) => `<div class="estrato-edit" data-est="${e.id}">
    <div class="estrato-titulo">${esc(rotuloEstrato(e.fitofisionomia, e.estagio))}</div>
    <div class="linha2">
      <label>Fitofisionomia<select class="e-fito" data-est="${e.id}">${fitoOpts(e.fitofisionomia)}</select></label>
      <label>Estágio sucessional<select class="e-estagio" data-est="${e.id}">${estagioOpts(e.estagio)}</select></label>
    </div>
    <div class="linha2">
      <label>Área total (ha)<input type="number" step="0.0001" class="e-area" data-est="${e.id}" value="${e.areaTotalHa ?? ""}"></label>
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
    e.nome = rotuloEstrato(e.fitofisionomia, e.estagio);
    const t = document.querySelector(`.estrato-edit[data-est="${e.id}"] .estrato-titulo`);
    if (t) t.textContent = e.nome;
    agendarSalvar();
  };
  $$(".e-fito").forEach((el) => { el.onchange = () => aplicaEstrato(el, "fitofisionomia"); });
  $$(".e-estagio").forEach((el) => { el.onchange = () => aplicaEstrato(el, "estagio"); });
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
  const votos = [classeAltura(mp.alturaMaxima, g), classeDap(mp.dapMedio, g)];
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
  // altura/DAP: auto a partir das médias medidas (mostra a classe sugerida)
  const aAlt = classeAltura(mp.alturaMaxima, g);
  const aDap = classeDap(mp.dapMedio, g);
  const autoLinha = (label, valor, classe, d) => `<div class="conama-auto">
    <div class="conama-auto-top"><b>${label}</b> ${valor} → <span class="badge ${classe && classe !== "ambiguo" ? "ok" : "nok"}">${classe ? (classe === "ambiguo" ? "zona 18–20 (decide pelos outros)" : ROTULO_ESTAGIO[classe]) : "sem dado"}</span></div>
    <small>Inicial: ${d.inicial} · Médio: ${d.medio} · Avançado: ${d.avancado}</small></div>`;

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
      ${autoLinha("Altura do dossel", mp.alturaMaxima != null ? fmtNum(mp.alturaMaxima, 1) + " m" : "—", aAlt, lim.altura)}
      ${autoLinha("DAP médio", mp.dapMedio != null ? fmtNum(mp.dapMedio, 1) + " cm" : "—", aDap, lim.dap)}
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
  renderCardsInd();
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
      mpEl.innerHTML = mp.nFustes
        ? `Parcela: DAP médio <b>${fmtNum(mp.dapMedio, 1)} cm</b> · maior árvore <b>${fmtNum(mp.alturaMaxima, 1)} m</b> <small>(${mp.nFustes} fuste${mp.nFustes === 1 ? "" : "s"})</small>`
        : "Médias da parcela: aguardando primeiro fuste";
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
  const cards = nomes.length ? nomes.map((nome) =>
    `<div class="card" data-esp="${esc(nome)}">
       <div class="card-corpo">
         <div class="card-nome"><i>${esc(nome)}</i></div>
         <div class="card-sub">${contagem[nome] || 0} foto(s)</div>
       </div>
       <div class="card-acoes"><span class="badge ${contagem[nome] ? "ok" : ""}">${contagem[nome] ? "📷 " + contagem[nome] : "—"}</span></div>
     </div>`).join("")
    : '<p class="vazio">Nenhuma espécie ainda. As que você registrar nas parcelas aparecem aqui.</p>';
  app.innerHTML = `${header("Espécies", () => telaInventario(invId))}
    <main>
      <div class="seg-nav">
        <button class="seg" id="ir-parcelas">📋 Parcelas</button>
        <button class="seg ativo">🌿 Espécies</button>
      </div>
      <button class="btn-grande" id="add-esp">+ Adicionar espécie</button>
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
  $("#exp-fotos-esp").onclick = () => exportarZipEspecies(invId);
}

const CATEGORIAS_FOTO = ["Geral", "Serrapilheira", "Dossel", "Sub-bosque"];

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
  app.innerHTML = `${header("Espécie", () => telaEspecies(invId))}
    <main class="form">
      <label class="campo">Nome da espécie <small>(editar renomeia no inventário todo)</small>
        <input id="esp-nome" value="${esc(nome)}"></label>
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
  $("#esp-foto").onclick = async () => {
    const nomeUse = $("#esp-nome").value.trim() || nomeAtual;
    const foto = await capturarFoto(invId, "especie", nomeUse, { parcelaId: "" });
    if (foto) { adicionarEspecie(inv, nomeUse); await salvarJa(); telaEspecie(invId, nomeUse); }
  };
  $$("[data-pasta]").forEach((el) => { el.onclick = () => telaEspecieFotos(invId, nomeAtual, el.dataset.pasta); });
}

// TELA — fotos de uma espécie dentro de uma parcela (ou avulsa)
async function telaEspecieFotos(invId, nome, parcelaKey) {
  inv = await db.obterInventario(invId);
  if (!inv) return telaInventarios();
  revogarUrls();
  const rotulo = {};
  for (const p of inv.parcelas) rotulo[p.id] = p.rotulo || p.id;
  const titulo = parcelaKey ? (rotulo[parcelaKey] || parcelaKey) : "Sem parcela";
  const fotos = (await db.fotosDoInventario(invId))
    .filter((f) => f.tipo === "especie" && f.refKey === nome && (f.parcelaId || "") === parcelaKey);
  app.innerHTML = `${header(titulo, () => telaEspecie(invId, nome))}
    <main>
      <div class="info"><i>${esc(nome)}</i> · ${esc(titulo)}</div>
      <button class="btn-grande" id="ef-foto">📷 Tirar foto aqui</button>
      <div id="ef-galeria">${galeriaHTML(fotos)}</div>
    </main>`;
  ligarVoltar(() => telaEspecie(invId, nome));
  $("#ef-foto").onclick = async () => {
    const foto = await capturarFoto(invId, "especie", nome, { parcelaId: parcelaKey });
    if (foto) telaEspecieFotos(invId, nome, parcelaKey);
  };
  ligarDelFoto("#ef-galeria", () => telaEspecieFotos(invId, nome, parcelaKey));
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
    const chave = esp + "/" + sub;
    cont[chave] = (cont[chave] || 0) + 1;
    arquivos.push({ nome: `${esp}/${sub}/${esp}_${cont[chave]}.jpg`, dados: await f.blob.arrayBuffer() });
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

// ---------- boot ----------
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
