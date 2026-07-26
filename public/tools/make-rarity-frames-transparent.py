# -*- coding: utf-8 -*-
"""Make near-white background/hole pixels transparent on rarity frame PNGs."""
from pathlib import Path
from PIL import Image

DIR = Path(r"c:\Users\포키\OneDrive\Desktop\sentence-craft\public\assets\achievements\rarity-frames")
FILES = ["일반.png", "청동.png", "황금.png", "수정.png", "전설.png"]


def process(img: Image.Image):
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    cleared = 0
    softened = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            mx = max(r, g, b)
            mn = min(r, g, b)
            chroma = mx - mn
            # near-achromatic bright = bg / hole (keep colorful metal highlights)
            if mn >= 240 and chroma <= 16:
                px[x, y] = (r, g, b, 0)
                cleared += 1
            elif mn >= 220 and chroma <= 20:
                t = (mn - 220) / 20.0
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                new_a = int(round(255 * (1.0 - t)))
                if new_a < a:
                    px[x, y] = (r, g, b, new_a)
                    softened += 1
    return rgba, cleared, softened


def main():
    for name in FILES:
        path = DIR / name
        img = Image.open(path)
        out, cleared, softened = process(img)
        bak = path.with_name(path.stem + ".bak.png")
        if not bak.exists():
            img.convert("RGBA").save(bak)
        out.save(path, optimize=True)
        c0 = out.getpixel((0, 0))
        c1 = out.getpixel((out.width // 2, out.height // 2))
        print(f"{name}: cleared={cleared} softened={softened} corner={c0} center={c1}")


if __name__ == "__main__":
    main()
