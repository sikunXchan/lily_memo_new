#!/usr/bin/env python3
"""Slice the dribble sprite sheet into frames and build a transparent looping GIF."""
import sys
from PIL import Image, ImageOps
import numpy as np

SRC = "public/B3A5D0EE-997F-4EB1-ACF2-68199B94327A.png"
OUT_GIF = "public/sikun-dribble.gif"
DURATION = 80  # ms per frame

im = Image.open(SRC).convert("RGB")
a = np.asarray(im).astype(int)
nonwhite = (a.max(axis=2) < 245) | ((a.max(axis=2) - a.min(axis=2)) > 18)

rowbands = [(55, 156), (208, 313), (364, 471), (520, 625),
            (671, 783), (837, 940), (990, 1095), (1147, 1248)]


def merge(raw, gap):
    m = []
    for s, e in raw:
        if m and s - m[-1][1] < gap:
            m[-1][1] = e
        else:
            m.append([s, e])
    return m


def runs(mask):
    raw = []; s = None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            raw.append([s, i]); s = None
    if s is not None:
        raw.append([s, len(mask)])
    return raw


# 1. Slice into raw frame crops (with the ball kept) using bear-body anchors.
crops = []
PAD_Y = 6
for ys, ye in rowbands:
    H = ye - ys
    sub = nonwhite[ys:ye, :]
    colext = sub.sum(axis=0)
    body = colext > 0.45 * H
    bb = [b for b in merge(runs(body), 15) if b[1] - b[0] > 25]
    centers = [(s + e) // 2 for s, e in bb]
    # frame boundaries: midpoints between bear centers
    bounds = [0]
    for i in range(len(centers) - 1):
        bounds.append((centers[i] + centers[i + 1]) // 2)
    bounds.append(im.width)
    y0 = max(0, ys - PAD_Y); y1 = min(im.height, ye + PAD_Y)
    for i in range(len(centers)):
        x0, x1 = bounds[i], bounds[i + 1]
        cell = im.crop((x0, y0, x1, y1))
        crops.append((cell, centers[i] - x0))  # keep bear center x within cell

print(f"frames: {len(crops)}")

# 2. White -> transparent, tight content bbox, record bear center & feet baseline.
rgba_frames = []
metas = []
for cell, bearcx in crops:
    ca = np.asarray(cell).astype(int)
    minc = ca.min(axis=2)
    alpha = (255 - minc).clip(0, 255)
    alpha[alpha < 30] = 0  # drop faint white halo
    rgba = np.dstack([ca, alpha]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    ys_, xs_ = np.where(alpha > 0)
    if len(xs_) == 0:
        continue
    bbox = (xs_.min(), ys_.min(), xs_.max() + 1, ys_.max() + 1)
    img = img.crop(bbox)
    cx = bearcx - bbox[0]               # bear center relative to cropped frame
    baseline = bbox[3] - bbox[1]        # bottom (feet) = full height of crop
    rgba_frames.append(img)
    metas.append((cx, baseline))

# 3. Common canvas, align by bear center-x and feet baseline.
max_left = max(cx for cx, _ in metas)
max_right = max(img.width - cx for img, (cx, _) in zip(rgba_frames, metas))
max_base = max(b for _, b in metas)
max_below = max(img.height - b for img, (_, b) in zip(rgba_frames, metas))
CW = int(max_left + max_right) + 8
CH = int(max_base + max_below) + 8
cx_anchor = int(max_left) + 4
base_anchor = int(max_base) + 4
print(f"canvas {CW}x{CH}")

canvas_frames = []
for img, (cx, base) in zip(rgba_frames, metas):
    canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    px = cx_anchor - int(cx)
    py = base_anchor - int(base)
    canvas.paste(img, (px, py), img)
    canvas_frames.append(canvas)

# 4. Quantize each frame to P with a reserved transparent index (binary alpha for GIF).
pal_frames = []
for c in canvas_frames:
    alpha = c.split()[3]
    mask = alpha.point(lambda p: 255 if p >= 128 else 0)
    rgb = c.convert("RGB")
    p = rgb.quantize(colors=255, method=Image.MEDIANCUT)
    p.paste(255, mask=ImageOps.invert(mask))
    p.info["transparency"] = 255
    pal_frames.append(p)

pal_frames[0].save(
    OUT_GIF, save_all=True, append_images=pal_frames[1:],
    duration=DURATION, loop=0, transparency=255, disposal=2, optimize=False,
)
print(f"wrote {OUT_GIF}  ({len(pal_frames)} frames, {DURATION}ms each)")
