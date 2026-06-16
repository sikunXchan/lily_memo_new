#!/usr/bin/env python3
"""Slice the level-icon source sheets in public/level_icon/ into individual
tier{1..15}.png files in public/level/.

The source sheets are already RGBA (background-removed by hand), each holding
a row of 1–3 trophies on a transparent background:

  Tier1-2.PNG   -> tier1, tier2
  Tier3-5.PNG   -> tier3, tier4, tier5
  Tier6-8.PNG   -> tier6, tier7, tier8
  Tier9-10.PNG  -> tier9, tier10
  Tier11-12.PNG -> tier11, tier12
  Tier13-14.PNG -> tier13, tier14
  Tier15.PNG    -> tier15
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
