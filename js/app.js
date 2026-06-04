// App de campo — UI (SPA vanilla). Navegação por estado, auto-save a cada
// alteração (IndexedDB), barra de erro amostral por estrato ao vivo.
import * as db from "./db.js";
import {
  novoInventario, novoEstrato, novaParcela, novoIndividuo, novoFuste,
  resultadosPorEstrato, areaParcelaHa, fmtNum, outliersDoEstrato,
  ESTAGIOS, rotuloEstrato, mediasParcela,
  semAcento, especiesDoInventario, individuosOrdenados,
} from "./modelo.js";
import { volumeIndividuo, EQUACOES_VOLUME } from "./calculos.js";
import { exportarJSON, exportarCSV, exportarXLSX, prepararXLSX, baixar } from "./export.js";

const app = document.getElementById("app");
const APP_VERSION = "v16"; // manter em sincronia com o CACHE do sw.js
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
      <button class="btn-grande" id="novo-inv">+ Novo inventário</button>
      <div class="cards">${cards || '<p class="vazio">Nenhum inventário ainda. Crie o primeiro.</p>'}</div>
      <p class="versao">Aflora Campo · ${APP_VERSION}</p>
    </main>`;

  $("#novo-inv").onclick = async () => {
    inv = novoInventario();
    await db.salvarInventario(inv);
    telaInventario(inv.id);
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
}

// ============================================================
// TELA 2 — inventário (barra de erro + parcelas)
// ============================================================
function barraErro(r, alvo) {
  if (!r.erro) {
    return `<div class="estrato-card">
      <div class="estrato-nome">${esc(r.estrato.nome)}</div>
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
    <div class="estrato-nome">${esc(r.estrato.nome)}
      <span class="badge ${suf ? "ok" : "nok"}">${suf ? "✓ suficiente" : "✗ acima de " + alvo + "%"}</span>
    </div>
    <div class="barra"><div class="barra-fill ${cls}" style="width:${larg}%"></div>
      <div class="barra-alvo" style="left:${posAlvo}%"></div></div>
    <div class="estrato-stats">erro <b>${fmtNum(e, 2)}%</b> (alvo ${fmtNum(alvo, 0)}%) ·
      ${r.nParcelas} parcelas <small>(n* ${Number.isFinite(nEst) ? nEst : "—"})</small> ·
      ${r.erro.vol_total_estimado != null ? fmtNum(r.erro.vol_total_estimado, 1) + " m³" : "defina a área do estrato"}</div>
  </div>`;
}

async function telaInventario(id) {
  inv = await db.obterInventario(id);
  if (!inv) return telaInventarios();
  // limpeza única: remove a lista de espécies poluída por digitação parcial da
  // versão antiga (autocomplete agora deriva só dos indivíduos registrados).
  if (inv.config?.especies?.length) { delete inv.config.especies; db.salvarInventario(inv); }
  const aHa = areaParcelaHa(inv.config);
  const resultados = resultadosPorEstrato(inv);
  const estPorId = Object.fromEntries(inv.estratos.map((e) => [e.id, e]));

  const barras = resultados.map((r) => barraErro(r, inv.config.erroAlvoPct)).join("");
  const parcelasHtml = inv.parcelas.length
    ? inv.parcelas.map((p) => {
        const est = estPorId[p.estratoId];
        const volM3 = p.individuos.reduce((s, ind) =>
          s + volumeIndividuo(ind.fustes, est?.fitofisionomia).vol_aereo, 0);
        const mha = aHa ? volM3 / aHa : null;
        return `<div class="card" data-parc="${p.id}">
          <div class="card-corpo">
            <div class="card-nome">${esc(p.rotulo || "(sem rótulo)")} <small>· ${esc(est?.nome || "?")}</small></div>
            <div class="card-sub">${p.individuos.length} indiv. · ${fmtNum(volM3, 4)} m³${mha != null ? " · " + fmtNum(mha, 1) + " m³/ha" : ""}${p.lat != null ? " · 📍" : ""}</div>
          </div></div>`;
      }).join("")
    : '<p class="vazio">Nenhuma parcela. Toque em "+ Nova parcela".</p>';

  app.innerHTML = `${header(inv.nome, telaInventarios)}
    <main>
      <section class="painel-erro">${barras}</section>
      <div class="acoes-linha">
        <button class="btn-grande" id="nova-parc">+ Nova parcela</button>
        <button class="btn-sec" id="cfg">⚙ Config</button>
      </div>
      <div class="cards">${parcelasHtml}</div>
      <h3 class="sec-export">Exportar</h3>
      <div class="acoes-linha wrap">
        <button class="btn-sec" id="exp-xlsx">⬇ XLSX</button>
        <button class="btn-sec" id="exp-csv">⬇ CSV</button>
        <button class="btn-sec" id="exp-json">⬇ JSON</button>
        <button class="btn-sec destaque" id="share">↗ Compartilhar</button>
      </div>
    </main>`;
  ligarVoltar(telaInventarios);
  $("#nova-parc").onclick = async () => {
    const est = inv.estratos[0];
    const p = novaParcela(est.id, "P" + String(inv.parcelas.length + 1).padStart(2, "0"));
    inv.parcelas.push(p);
    await salvarJa();
    telaParcela(p.id);
  };
  $("#cfg").onclick = telaConfig;
  $("#exp-json").onclick = () => exportarJSON(inv);
  $("#exp-csv").onclick = () => exportarCSV(inv);
  $("#exp-xlsx").onclick = () => exportarXLSX(inv);
  // PRÉ-GERA a planilha quando a tela abre (em segundo plano, sem travar o
  // render). Assim o clique não faz trabalho pesado antes de navigator.share —
  // o gesto do usuário fica "fresco" e o Android não dá NotAllowedError.
  let arquivoXLSX = null;
  setTimeout(() => { try { arquivoXLSX = prepararXLSX(inv); } catch (e) { /* gera no clique */ } }, 0);
  $("#share").onclick = () => {
    let dados = arquivoXLSX;
    if (!dados) {
      try { dados = prepararXLSX(inv); } catch (e) { alert("Erro ao gerar a planilha: " + (e?.message || e)); return; }
    }
    const { nome, blob, file, mime } = dados;
    if (navigator.share) {
      navigator.share({ files: [file], title: nome }).catch((e) => {
        if (e && e.name === "AbortError") return; // usuário fechou o menu
        baixar(nome, blob, mime);
        alert("Não abriu o menu — baixei a planilha.\nMotivo: " + (e?.name || "") + ": " + (e?.message || ""));
      });
    } else {
      baixar(nome, blob, mime);
      alert("Este navegador não compartilha arquivos — baixei a planilha.");
    }
  };
  $$("[data-parc]").forEach((el) => { el.onclick = () => telaParcela(el.dataset.parc); });
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
// TELA 4 — parcela (GPS + indivíduos)
// ============================================================
function telaParcela(parcelaId) {
  const p = inv.parcelas.find((x) => x.id === parcelaId);
  if (!p) return telaInventario(inv.id);
  const est = estPorId(p.estratoId);
  const aHa = areaParcelaHa(inv.config);
  const volM3 = p.individuos.reduce((s, ind) => s + volumeIndividuo(ind.fustes, est?.fitofisionomia).vol_aereo, 0);
  const mp = mediasParcela(p);
  const resEstrato = resultadosPorEstrato(inv).find((r) => r.estrato.id === p.estratoId);

  const estOpts = inv.estratos.map((e) =>
    `<option value="${e.id}" ${e.id === p.estratoId ? "selected" : ""}>${esc(e.nome)}</option>`).join("");
  const modos = [["entrada", "Ordem de entrada"], ["placa", "Placa"], ["especie", "Espécie"]];
  const ordAtual = inv.config.ordIndividuos || "entrada";
  const ordOpts = modos.map(([v, t]) =>
    `<option value="${v}" ${v === ordAtual ? "selected" : ""}>${t}</option>`).join("");

  app.innerHTML = `${header("Parcela " + (p.rotulo || ""), () => telaInventario(inv.id))}
    <main>
      <section class="painel-erro">${barraErro(resEstrato, inv.config.erroAlvoPct)}</section>
      <div class="form">
        <label class="campo">Rótulo da parcela<input id="p-rotulo" value="${esc(p.rotulo)}"></label>
        <label class="campo">Estrato<select id="p-estrato">${estOpts}</select></label>
        <div class="gps-linha">
          <button class="btn-sec" id="p-gps">📍 Marcar GPS</button>
          <span id="gps-info">${p.lat != null ? fmtNum(p.lat, 6) + ", " + fmtNum(p.lon, 6) : "sem coordenada"}</span>
        </div>
        <div class="info">Volume da parcela: <b>${fmtNum(volM3, 4)} m³</b>${aHa ? " · " + fmtNum(volM3 / aHa, 1) + " m³/ha" : ""}</div>
        <div class="info">${mp.nFustes ? `DAP médio: <b>${fmtNum(mp.dapMedio, 1)} cm</b> · Altura média: <b>${fmtNum(mp.alturaMedia, 1)} m</b> <small>(${mp.nFustes} fuste${mp.nFustes === 1 ? "" : "s"})</small>` : "DAP/altura médios: aguardando primeiro fuste"}</div>
      </div>
      <button class="btn-grande" id="novo-ind">+ Novo indivíduo</button>
      <div class="ordenar"><label>Organizar por <select id="ord-ind">${ordOpts}</select></label>
        <span class="ord-cont">${p.individuos.length} indiv.</span></div>
      <div class="cards" id="cards-ind"></div>
    </main>`;
  ligarVoltar(() => telaInventario(inv.id));
  $("#p-rotulo").oninput = (e) => { p.rotulo = e.target.value; agendarSalvar(); };
  $("#p-estrato").onchange = (e) => { p.estratoId = e.target.value; agendarSalvar(); renderCardsInd(); };
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
      <div class="linha2">
        <label>Placa<input id="i-placa" value="${esc(ind.placa)}" inputmode="numeric"></label>
        <button class="perigo" id="del-ind">🗑 Excluir</button>
      </div>
      <label class="campo">Espécie
        <div class="autocomplete">
          <input id="i-especie" value="${esc(ind.especie)}" autocomplete="off" placeholder="Digite ou toque em ▾">
          <button type="button" class="ac-toggle" id="i-especie-toggle" aria-label="Ver espécies">▾</button>
          <div class="ac-lista" id="i-especie-lista" hidden></div>
        </div></label>

      <h3>Fustes <small>(CAP em cm, altura em m)</small></h3>
      <div id="fustes"></div>
      <button class="btn-sec" id="add-fuste">+ Adicionar fuste</button>

      <div class="info" id="vol-vivo"></div>
      <div class="info" id="medias-parcela"></div>
      <div class="info erro-estrato-box neutro" id="erro-estrato"></div>
      <div id="aviso-outlier"></div>
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
    const vi = volumeIndividuo(ind.fustes, est?.fitofisionomia);
    $("#vol-vivo").innerHTML = `Volume do indivíduo: <b>${fmtNum(vi.vol_aereo, 4)} m³</b> aéreo · `
      + `${fmtNum(vi.vol_total, 4)} m³ total <small>(${vi.n_fustes} fuste(s), eq. ${esc(EQUACOES_VOLUME[est?.fitofisionomia]?.rotulo || est?.fitofisionomia)})</small>`;
    // médias da parcela (DAP e altura) recalculadas ao vivo a cada CAP/altura
    const mp = mediasParcela(p);
    const mpEl = $("#medias-parcela");
    if (mpEl) {
      mpEl.innerHTML = mp.nFustes
        ? `Médias da parcela: DAP <b>${fmtNum(mp.dapMedio, 1)} cm</b> · Altura <b>${fmtNum(mp.alturaMedia, 1)} m</b> <small>(${mp.nFustes} fuste${mp.nFustes === 1 ? "" : "s"})</small>`
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
    const modos = [["entrada", "Entrada"], ["placa", "Placa"], ["especie", "Espécie"]];
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

// ---------- boot ----------
async function iniciar() {
  await db.pedirPersistencia();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  telaInventarios();
}
iniciar();
