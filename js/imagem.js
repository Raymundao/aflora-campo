// Utilidades de imagem: compressão (ao salvar) e overlay de texto (ao exportar).
// Tudo via canvas, offline. JPEG porque fotos de campo não precisam de alfa e
// comprime muito melhor que PNG.

async function carregar(blobOuFile) {
  if (self.createImageBitmap) {
    try { return await createImageBitmap(blobOuFile); } catch (e) { /* fallback */ }
  }
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(blobOuFile);
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 0); };
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

const dims = (img) => ({ w: img.width || img.naturalWidth, h: img.height || img.naturalHeight });

// Redimensiona pra caber em maxLado (lado maior) e exporta JPEG comprimido.
// Reduz fotos de 3–12 MB pra algumas centenas de KB sem perder ID de espécie.
export async function comprimirImagem(file, maxLado = 1600, qualidade = 0.82) {
  const img = await carregar(file);
  const { w, h } = dims(img);
  const escala = Math.min(1, maxLado / Math.max(w, h));
  const cw = Math.round(w * escala);
  const ch = Math.round(h * escala);
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
  if (img.close) img.close();
  return new Promise((res) => canvas.toBlob((b) => res(b || file), "image/jpeg", qualidade));
}

// Carimba linhas de texto numa faixa semi-transparente no rodapé da imagem.
// Usado SÓ na exportação (a foto guardada fica limpa). Retorna Blob JPEG.
export async function carimbarTexto(blob, linhas, qualidade = 0.9) {
  const img = await carregar(blob);
  const { w, h } = dims(img);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  if (img.close) img.close();

  const linhasFiltradas = (linhas || []).filter(Boolean);
  if (linhasFiltradas.length) {
    const fonte = Math.max(16, Math.round(w * 0.028));
    const pad = Math.round(fonte * 0.5);
    const alturaLinha = fonte + pad * 0.6;
    const alturaFaixa = linhasFiltradas.length * alturaLinha + pad * 1.2;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, h - alturaFaixa, w, alturaFaixa);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fonte}px sans-serif`;
    ctx.textBaseline = "top";
    linhasFiltradas.forEach((linha, i) => {
      ctx.fillText(linha, pad, h - alturaFaixa + pad * 0.6 + i * alturaLinha);
    });
  }
  return new Promise((res) => canvas.toBlob((b) => res(b || blob), "image/jpeg", qualidade));
}

export const blobParaArrayBuffer = (blob) => blob.arrayBuffer();

// URL temporária pra <img> exibir o blob (lembrar de revogar).
export const urlDeBlob = (blob) => URL.createObjectURL(blob);
