#!/usr/bin/env python3
"""Slice the level-icon source sheets in public/level_icon/ into individual
tier{1..9}.png files in public/level/.

  Tier1-5.PNG -> tier1..tier5  (5 bears in a row)
  Tier6-7.PNG -> tier6, tier7  (2 trophies)
  Tier8.PNG   -> tier8         (single, radiant)
  Tier9.PNG   -> tier9         (single, rainbow)
"""
from PIL import Image
import numpy as np

SRC = 'public/level_icon'
OUT = 'public/level'


def colprofile(im):
    return np.array(im)[:, :, 3].astype(np.float64).sum(axis=0)


def smooth(v, k=15):
    return np.convolve(v, np.ones(k) / k, mode='same')


def valley(sm, lo, hi):
    return lo + int(np.argmin(sm[lo:hi]))


def square_crop(im, x0, x1, out_size=256, pad=12):
    band = im.crop((x0, 0, x1, im.height))
    a = np.array(band)[:, :, 3]
    ys, xs = np.where(a > 16)
    if len(xs) == 0:
        return None
    l = max(0, xs.min() - pad); r = min(band.width, xs.max() + pad)
    t = max(0, ys.min() - pad); b = min(band.height, ys.max() + pad)
    crop = band.crop((l, t, r, b))
    w, h = crop.size
    s = max(w, h)
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    canvas.paste(crop, ((s - w) // 2, (s - h) // 2), crop)
    return canvas.resize((out_size, out_size), Image.LANCZOS)


def main():
    # Tier1-5
    im = Image.open(f'{SRC}/Tier1-5.PNG').convert('RGBA')
    sm = smooth(colprofile(im))
    v = [valley(sm, 330, 380), valley(sm, 610, 665), valley(sm, 890, 945), valley(sm, 1180, 1290)]
    bounds = [140] + v + [1505]
    for i in range(5):
        square_crop(im, bounds[i], bounds[i + 1]).save(f'{OUT}/tier{i + 1}.png')

    # Tier6-7
    im = Image.open(f'{SRC}/Tier6-7.PNG').convert('RGBA')
    sm = smooth(colprofile(im))
    vg = valley(sm, 900, 1244)
    for i, (x0, x1) in enumerate([(640, vg), (vg, 1510)]):
        square_crop(im, x0, x1).save(f'{OUT}/tier{6 + i}.png')

    # Tier8, Tier9
    for n, f in [(8, 'Tier8'), (9, 'Tier9')]:
        im = Image.open(f'{SRC}/{f}.PNG').convert('RGBA')
        square_crop(im, 0, im.width).save(f'{OUT}/tier{n}.png')

    print('sliced tier1..tier9 -> public/level/')


if __name__ == '__main__':
    main()
