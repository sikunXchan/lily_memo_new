#!/usr/bin/env python3
"""Slice the level-icon source sheets in public/level_icon/ into individual
tier{1..23}.png files in public/level/.

The source sheets are already RGBA (background-removed by hand), each holding
a row of 1–3 trophies on a transparent background. The order below IS the tier
order — the rainbow trophy that used to be Tier 15 is now the very last one
(Tier 23 = キング):

  Tier1-2.PNG   -> tier1, tier2    ブロンズ
  Tier3-5.PNG   -> tier3..tier5    シルバー
  Tier6-8.PNG   -> tier6..tier8    ゴールド
  Tier9-10.PNG  -> tier9, tier10   プラチナ
  Tier11-12.PNG -> tier11, tier12  エメラルド
  Tier13-14.PNG -> tier13, tier14  ダイヤモンド
  tier15-16.PNG -> tier15, tier16  エリート
  tier17-18.PNG -> tier17, tier18  エース
  tier19-20.PNG -> tier19, tier20  チャンピオン Ⅰ/Ⅱ
  tier21-22.PNG -> tier21, tier22  チャンピオン Ⅲ/Ⅳ
  Tier15.PNG    -> tier23          キング（虹）
"""
from PIL import Image
import numpy as np

SRC = 'public/level_icon'
OUT = 'public/level'

SHEETS = [
    ('Tier1-2.PNG',   2),
    ('Tier3-5.PNG',   3),
    ('Tier6-8.PNG',   3),
    ('Tier9-10.PNG',  2),
    ('Tier11-12.PNG', 2),
    ('Tier13-14.PNG', 2),
    ('tier15-16.PNG', 2),
    ('tier17-18.PNG', 2),
    ('tier19-20.PNG', 2),
    ('tier21-22.PNG', 2),
    ('Tier15.PNG',    1),
]

OUT_SIZE = 256
PAD = 16   # padding around each trophy before resizing


def column_ink(rgba):
    """Per-column sum of alpha values — used to find gaps between trophies."""
    return np.array(rgba)[:, :, 3].astype(np.float64).sum(axis=0)


def split_columns(ink, n):
    """Split the sheet width into n trophy spans at the lowest-ink valleys."""
    if n == 1:
        xs = np.where(ink > ink.max() * 0.01)[0]
        return [(int(xs.min()), int(xs.max()) + 1)]

    # Smooth the profile and find the n-1 deepest valleys between trophies.
    k = max(5, ink.size // 80)
    sm = np.convolve(ink, np.ones(k) / k, mode='same')
    xs = np.where(ink > ink.max() * 0.01)[0]
    lo, hi = int(xs.min()), int(xs.max())
    span = (hi - lo) // n
    cuts = []
    for i in range(1, n):
        c = lo + span * i
        w = span // 3
        cuts.append(c - w + int(np.argmin(sm[c - w: c + w])))
    edges = [lo] + cuts + [hi + 1]
    return [(edges[i], edges[i + 1]) for i in range(n)]


def square_crop(rgba, x0, x1):
    """Crop one trophy column, pad, and resize to OUT_SIZE × OUT_SIZE."""
    band = rgba.crop((x0, 0, x1, rgba.height))
    a = np.array(band)[:, :, 3]
    ys, xs = np.where(a > 16)
    if len(xs) == 0:
        return None
    l = max(0, xs.min() - PAD)
    r = min(band.width,  xs.max() + PAD)
    t = max(0, ys.min() - PAD)
    b = min(band.height, ys.max() + PAD)
    crop = band.crop((l, t, r, b))
    w, h = crop.size
    s = max(w, h)
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    canvas.paste(crop, ((s - w) // 2, (s - h) // 2), crop)
    return canvas.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)


def main():
    tier = 1
    for fname, count in SHEETS:
        im = Image.open(f'{SRC}/{fname}').convert('RGBA')
        for x0, x1 in split_columns(column_ink(im), count):
            img = square_crop(im, x0, x1)
            if img:
                img.save(f'{OUT}/tier{tier}.png')
            tier += 1
    print(f'sliced tier1..{tier - 1} -> {OUT}/')


if __name__ == '__main__':
    main()
