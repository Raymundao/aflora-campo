"""Gera os ícones PNG do PWA (192 e 512): a ÁRVORE da logo Brasil Aflora,
com "Aflora" em cima e "Campo" embaixo (cores da marca).
Uso: python icons/_gerar_icones.py"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

AQUI = Path(__file__).parent
LOGO = AQUI.parent / "img" / "brasil_aflora.png"
OLIVA = (120, 163, 52, 255)   # "AFLORA" da logo  -> #78A334
ESCURO = (28, 75, 58, 255)    # "BRASIL" da logo  -> #1C4B3A
BRANCO = (255, 255, 255, 255)

FONTES = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]


def fonte(tam: int):
    for caminho in FONTES:
        try:
            return ImageFont.truetype(caminho, tam)
        except Exception:
            continue
    return ImageFont.load_default()


def arvore_recortada() -> Image.Image:
    """Recorta só a árvore (sem o texto) da logo e apara as margens."""
    logo = Image.open(LOGO).convert("RGBA")
    # a árvore vai de ~y175 a ~y720 (o texto começa em ~780); corta com folga
    topo = logo.crop((300, 160, 954, 730))
    a = np.array(topo)
    rgb = a[:, :, :3].astype(int)
    al = a[:, :, 3]
    conteudo = (al > 20) & (rgb.sum(axis=2) < 730)  # ignora branco/transparente
    ys = np.where(conteudo.any(axis=1))[0]
    xs = np.where(conteudo.any(axis=0))[0]
    return topo.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def texto_centrado(d, txt, f, cy, tam, cor):
    bb = d.textbbox((0, 0), txt, font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((tam - tw) / 2 - bb[0], cy - bb[1]), txt, font=f, fill=cor)
    return th


def gerar(tam: int) -> Image.Image:
    img = Image.new("RGBA", (tam, tam), BRANCO)
    d = ImageDraw.Draw(img)
    ft = fonte(int(tam * 0.165))

    # "Aflora" no topo (oliva)
    y_top = int(tam * 0.07)
    h_top = texto_centrado(d, "Aflora", ft, y_top, tam, OLIVA)
    # "Campo" embaixo (verde escuro)
    bb = d.textbbox((0, 0), "Campo", font=ft)
    h_bot = bb[3] - bb[1]
    y_bot = int(tam * 0.93) - h_bot

    # árvore no espaço do meio (mantém proporção)
    arv = arvore_recortada()
    y0 = y_top + h_top + int(tam * 0.04)
    y1 = y_bot - int(tam * 0.03)
    esp_h = y1 - y0
    esp_w = int(tam * 0.78)
    r = min(esp_w / arv.width, esp_h / arv.height)
    nw, nh = int(arv.width * r), int(arv.height * r)
    arv_r = arv.resize((nw, nh), Image.LANCZOS)
    img.paste(arv_r, ((tam - nw) // 2, y0 + (esp_h - nh) // 2), arv_r)

    texto_centrado(d, "Campo", ft, y_bot, tam, ESCURO)
    return img


def main():
    for tam in (192, 512):
        gerar(tam).save(AQUI / f"icon-{tam}.png")
        print(f"OK -> icon-{tam}.png")


if __name__ == "__main__":
    main()
