#!/usr/bin/env python3
"""Slice the level-icon source sheets in public/level_icon/ into individual
transparent tier{1..15}.png files in public/level/.

The source sheets are drawn on a WHITE background (no alpha), each holding a
row of 1–3 trophies:

  Tier1-2.PNG   -> tier1, tier2          (bronze)
  Tier3-5.PNG   -> tier3, tier4, tier5   (silver)
  Tier6-8.PNG   -> tier6, tier7, tier8   (gold)
  Tier9-10.PNG  -> tier9, tier10         (crystal / ice)
  Tier11-12.PNG -> tier11, tier12        (emerald)
  Tier13-14.PNG -> tier13, tier14        (angelic / platinum)
  Tier15.PNG    -> tier15                (rainbow, the eternal top)

For each sheet we (1) knock the white background out to transparency with a
border flood-fill (so white highlights *inside* a trophy are kept), (2) split
the row into individual trophies at the empty gaps between them, and (3) crop
each trophy to a centered square PNG.
"""
from PIL import Image
import numpy as np
from scipy import ndimage

SRC = 'public/level_icon'
OUT = 'public/level'

# (filename, number of trophies in the sheet)
SHEETS = [
    ('Tier1-2.PNG', 2),
    ('Tier3-5.PNG', 3),
    ('Tier6-8.PNG', 3),
    ('Tier9-10.PNG', 2),
    ('Tier11-12.PNG', 2),
    ('Tier13-14.PNG', 2),
    ('Tier15.PNG', 1),
]

OUT_SIZE = 256
PAD = 14


def make_alpha(rgb):
    """Return an RGBA image with the white background removed.

    Only near-white pixels that are *connected to the border* are treated as
    background, so bright highlights inside a trophy stay opaque. Edges are
    feathered slightly so the cut-out doesn't show a hard white fringe.
    """
    arr = np.asarray(rgb).astype(np.float32)
    # "Whiteness": close to white AND not very saturated (catches faint shadows
    # without eating colored/metallic highlights).
    brightness = arr.min(axis=2)
    sat = arr.max(axis=2) - arr.min(axis=2)
    nearwhite = (brightness > 232) & (sat < 22)

    # Background = near-white region reachable from the image border.
    labels, n = ndimage.label(nearwhite)
    border = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border.discard(0)
    bg = np.isin(labels, list(border))

    alpha = np.where(bg, 0.0, 255.0).astype(np.float32)
    # Feather the boundary a touch for clean edges at display size.
    alpha = ndimage.gaussian_filter(alpha, sigma=0.8)

    out = np.dstack([arr, alpha]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def column_ink(rgba):
    """Per-column count of opaque pixels (used to find gaps between trophies)."""
    a = np.asarray(rgba)[:, :, 3]
    return (a > 24).sum(axis=0).astype(np.float64)


def split_columns(ink, n):
    """Split the width into n trophy spans at the empty gaps between them."""
    if n == 1:
        xs = np.where(ink > ink.max() * 0.02)[0]
        return [(int(xs.min()), int(xs.max()) + 1)]

    occupied = ink > max(2.0, ink.max() * 0.02)
    # Contiguous runs of occupied columns = individual trophies.
    runs = []
    start = None
    for x, on in enumerate(occupied):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append([start, x])
            start = None
    if start is not None:
        runs.append([start, len(occupied)])

    # Drop dust; merge runs separated by only a hairline gap.
    runs = [r for r in runs if (r[1] - r[0]) > ink.size * 0.01]
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < ink.size * 0.015:
            merged[-1][1] = r[1]
        else:
            merged.append(r)

    if len(merged) == n:
        return [(a, b) for a, b in merged]

    # Fallback: cut at the n-1 deepest valleys of a smoothed profile.
    k = max(5, ink.size // 120)
    sm = np.convolve(ink, np.ones(k) / k, mode='same')
    xs = np.where(ink > ink.max() * 0.02)[0]
    lo, hi = int(xs.min()), int(xs.max())
    cuts = []
    for i in range(1, n):
        c = lo + (hi - lo) * i // n
        w = (hi - lo) // (2 * n)
        cuts.append(c - w + int(np.argmin(sm[c - w:c + w])))
    edges = [lo] + cuts + [hi + 1]
    return [(edges[i], edges[i + 1]) for i in range(n)]


def square_crop(rgba, x0, x1):
    band = rgba.crop((x0, 0, x1, rgba.height))
    a = np.asarray(band)[:, :, 3]
    ys, xs = np.where(a > 24)
    if len(xs) == 0:
        return None
    l = max(0, xs.min() - PAD); r = min(band.width, xs.max() + PAD)
    t = max(0, ys.min() - PAD); b = min(band.height, ys.max() + PAD)
    crop = band.crop((l, t, r, b))
    w, h = crop.size
    s = max(w, h)
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    canvas.paste(crop, ((s - w) // 2, (s - h) // 2), crop)
    return canvas.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)


def main():
    tier = 1
    for fname, count in SHEETS:
        rgb = Image.open(f'{SRC}/{fname}').convert('RGB')
        rgba = make_alpha(rgb)
        for x0, x1 in split_columns(column_ink(rgba), count):
            img = square_crop(rgba, x0, x1)
            img.save(f'{OUT}/tier{tier}.png')
            tier += 1
    print(f'sliced tier1..tier{tier - 1} -> {OUT}/')


if __name__ == '__main__':
    main()
