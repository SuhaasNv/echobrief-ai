#!/usr/bin/env python3
"""
EchoBrief mark + icon builder.

The mark is a square of time split by a physical channel into two speaker
masses. Everything downstream is derived from ONE number set: a rectilinear
seam centreline, offset by half the channel width to each side. Nothing is
drawn by hand, so the channel is exactly 12 units on a 100 unit side
everywhere, and the two masses are provably equal in area.

Usage (from anywhere):
    python3 docs/brand/build-icons.py            # concepts + production + PNGs + proofs
    python3 docs/brand/build-icons.py --sheets   # contact sheets only

Requires: rsvg-convert (brew install librsvg), Pillow.
"""
import argparse
import math
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- constants
CH = 12.0                 # channel width, in units of a 100-unit side
HALF = CH / 2.0
GROUND = "#06070A"
AZURE = "#4C99F8"         # speaker one
GREEN = "#2FC183"         # speaker two
LABEL = "#F4F5F7"
TINT_HI = "#FFFFFF"       # tinted: upper mass
TINT_LO = "#9A9A9A"       # tinted: lower mass (value separation, not hue)

BRAND = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(BRAND))
ASSETS = os.path.join(REPO, "apps", "mobile", "assets")
CONCEPTS = os.path.join(BRAND, "concepts")

# ---------------------------------------------------------------- geometry
# Seam centrelines. Each must start and end with a horizontal run that runs
# off both edges, and alternate horizontal / vertical.
SEAMS = {
    # SHIPPING. One decisive step at dead centre. The two masses are related
    # by a 180 degree rotation about (50,50), so neither is "up".
    "handoff":      [(-10, 38), (50, 38), (50, 62), (110, 62)],
    # Two tabs, each mass reaching across the centre line into the other half.
    "interleave":   [(-10, 50), (30, 50), (30, 34), (50, 34),
                     (50, 66), (70, 66), (70, 50), (110, 50)],
    # Seam reverses once: one mass pushes a block into the middle of the other.
    "interruption": [(-10, 38), (30, 38), (30, 68), (70, 68), (70, 38), (110, 38)],
}
SHIPPING = "handoff"


def _segments(pts):
    return [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]


def _seg_offsets(pts, side):
    """side 'A' = the mass containing the top edge; 'B' = the bottom."""
    offs = []
    for (x0, y0), (x1, y1) in _segments(pts):
        if y0 == y1:
            offs.append(("h", y0 - HALF if side == "A" else y0 + HALF))
        elif x0 == x1:
            down = y1 > y0
            if side == "A":
                offs.append(("v", x0 + HALF if down else x0 - HALF))
            else:
                offs.append(("v", x0 - HALF if down else x0 + HALF))
        else:
            raise ValueError("seam centreline must be rectilinear")
    return offs


def mass(pts, side):
    """The polygon for one speaker mass, run off the artboard on all sides."""
    offs = _seg_offsets(pts, side)
    kind, val = offs[0]
    assert kind == "h", "seam must start with a horizontal run"
    out = [(pts[0][0], val)]
    for i in range(1, len(pts) - 1):
        a, b = offs[i - 1], offs[i]
        h, v = (a, b) if a[0] == "h" else (b, a)
        assert h[0] == "h" and v[0] == "v", "seam segments must alternate"
        out.append((v[1], h[1]))
    kind, val = offs[-1]
    assert kind == "h", "seam must end with a horizontal run"
    out.append((pts[-1][0], val))
    far = -20.0 if side == "A" else 120.0
    return out + [(out[-1][0], far), (out[0][0], far)]


def _clip_square(poly, lo=0.0, hi=100.0):
    def half(poly, axis, bound, greater):
        inside = (lambda p: p[axis] >= bound) if greater else (lambda p: p[axis] <= bound)
        out = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            ia, ib = inside(a), inside(b)
            if ia or ib:
                if ia:
                    out.append(a)
                if ia != ib:
                    t = (bound - a[axis]) / (b[axis] - a[axis])
                    out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
        return out
    for axis, bound, greater in ((0, lo, True), (0, hi, False), (1, lo, True), (1, hi, False)):
        poly = half(poly, axis, bound, greater)
        if not poly:
            return []
    return poly


def area_pct(poly):
    poly = _clip_square(poly)
    s = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
            for i in range(len(poly)))
    return abs(s) / 2.0 / 100.0


def pts_attr(poly):
    return " ".join(f"{x:g},{y:g}" for x, y in poly)


# ---------------------------------------------------------------- svg emit
def _masses(name, ca, cb):
    seam = SEAMS[name]
    return (f'  <polygon points="{pts_attr(mass(seam, "A"))}" fill="{ca}"/>\n'
            f'  <polygon points="{pts_attr(mass(seam, "B"))}" fill="{cb}"/>\n')


def svg_fullbleed(name, ground, ca=AZURE, cb=GREEN, size=1024, title="EchoBrief app icon"):
    g = f'  <rect width="100" height="100" fill="{ground}"/>\n' if ground else ""
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
            f'width="{size}" height="{size}">\n  <title>{title}</title>\n{g}'
            f'{_masses(name, ca, cb)}</svg>\n')


def svg_inset(name, inset, ca=AZURE, cb=GREEN, ground=None, size=1024,
              title="EchoBrief mark", cid="m"):
    """Mark set inside a rounded square occupying `inset` of the artboard."""
    side = 100.0 * inset
    off = (100.0 - side) / 2.0
    r = side * 0.16
    g = f'  <rect width="100" height="100" fill="{ground}"/>\n' if ground else ""
    body = _masses(name, ca, cb)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
            f'width="{size}" height="{size}">\n  <title>{title}</title>\n{g}'
            f'  <defs><clipPath id="{cid}"><rect x="{off:g}" y="{off:g}" '
            f'width="{side:g}" height="{side:g}" rx="{r:g}"/></clipPath></defs>\n'
            f'  <g clip-path="url(#{cid})" transform="translate({off:g} {off:g}) '
            f'scale({inset:g})">\n{body}  </g>\n</svg>\n')


def svg_mark(name, ca=AZURE, cb=GREEN):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
            'width="100" height="100">\n  <title>EchoBrief — The Handoff</title>\n'
            '  <defs><clipPath id="e-clip"><rect width="100" height="100" rx="16"/></clipPath></defs>\n'
            f'  <g clip-path="url(#e-clip)">\n{_masses(name, ca, cb)}  </g>\n</svg>\n')


# ---------------------------------------------------------------- raster
def render(svg_path, px, out=None):
    out = out or os.path.join("/tmp", ".eb-render.png")
    subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), svg_path, "-o", out], check=True)
    return Image.open(out).convert("RGBA")


def write_png(svg_path, png_path, px, mode):
    im = render(svg_path, px)
    if mode == "RGB":
        flat = Image.new("RGB", im.size, (6, 7, 10))
        flat.paste(im, mask=im.split()[3])
        flat.save(png_path)
    else:
        im.save(png_path)
    print(f"  {os.path.relpath(png_path, REPO):44s} {px}x{px} {mode}")


def ios_mask(px, ss=8):
    """Apple continuous-corner square, approximated by a superellipse (n=5)."""
    big = px * ss
    m = Image.new("L", (big, big), 0)
    a, n, N = big / 2.0, 5.0, 1440
    pts = []
    for i in range(N):
        t = 2.0 * math.pi * i / N
        ct, st = math.cos(t), math.sin(t)
        pts.append((a + a * abs(ct) ** (2.0 / n) * (1 if ct >= 0 else -1),
                    a + a * abs(st) ** (2.0 / n) * (1 if st >= 0 else -1)))
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m.resize((px, px), Image.LANCZOS)


def _font(sz, mono=True):
    for p in ("/System/Library/Fonts/SFNSMono.ttf",
              "/System/Library/Fonts/Supplemental/Arial.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


SIZES = [180, 120, 87, 60, 29]


def contact_sheet(rows, path, bg=(24, 25, 28), label_w=260, pad=28, gap=36):
    """rows: (label, svg_path, masked, tile_rgb_or_None, tint_rgb_or_None)."""
    row_h = SIZES[0] + 42
    W = label_w + sum(s + gap for s in SIZES) + pad * 2
    H = pad * 2 + len(rows) * (row_h + gap)
    sheet = Image.new("RGBA", (W, H), bg + (255,))
    d = ImageDraw.Draw(sheet)
    f, fs = _font(15), _font(11)
    y = pad
    for label, svg, masked, tile, tint in rows:
        d.text((pad, y + row_h // 2 - 10), label, font=f, fill=(230, 232, 236))
        x = pad + label_w
        for s in SIZES:
            im = render(svg, s)
            if tint:
                px = im.load()
                for j in range(s):
                    for i in range(s):
                        r, g, b, al = px[i, j]
                        lum = (r * 299 + g * 587 + b * 114) // 1000
                        px[i, j] = (tint[0] * lum // 255, tint[1] * lum // 255,
                                    tint[2] * lum // 255, al)
            if tile:
                back = Image.new("RGBA", (s, s), tile + (255,))
                back.alpha_composite(im)
                im = back
            if masked:
                a = im.split()[3].point(lambda v: v)
                m = ios_mask(s)
                im.putalpha(Image.composite(m, Image.new("L", (s, s), 0), a.point(lambda v: 255 if v else 0)))
            oy = y + (SIZES[0] - s) // 2
            sheet.alpha_composite(im, (x, oy))
            d.text((x, y + SIZES[0] + 14), f"{s}px", font=fs, fill=(150, 154, 162))
            x += s + gap
        y += row_h + gap
    sheet.convert("RGB").save(path)
    print(f"  {os.path.relpath(path, REPO)}  {sheet.size[0]}x{sheet.size[1]}")


# ---------------------------------------------------------------- outputs
CONCEPT_FILES = {
    "handoff": ("concept-4-the-handoff.svg", "EchoBrief concept 4 — The Handoff",
                "One block of time, one decisive step. The two masses are congruent "
                "under a 180 degree rotation, so neither reads as being on top."),
    "interleave": ("concept-5-the-interleave.svg", "EchoBrief concept 5 — The Interleave",
                   "Each mass reaches across the centre into the other's half. "
                   "The seam changes direction twice, so it cannot read as a run of steps."),
    "interruption": ("concept-6-the-interruption.svg", "EchoBrief concept 6 — The Interruption",
                     "The seam reverses once: one speaker's block is driven into the "
                     "middle of the other's."),
}


def build_concepts():
    print("concepts")
    for name, (fn, title, desc) in CONCEPT_FILES.items():
        svg = svg_inset(name, 0.72, ground=GROUND, title=title, cid="c")
        svg = svg.replace("</title>\n", f"</title>\n  <desc>{desc}</desc>\n", 1)
        p = os.path.join(CONCEPTS, fn)
        open(p, "w").write(svg)
        a, b = area_pct(mass(SEAMS[name], "A")), area_pct(mass(SEAMS[name], "B"))
        print(f"  {os.path.relpath(p, REPO):50s} masses {a:.1f}% / {b:.1f}%  "
              f"channel {100 - a - b:.1f}%")


def build_variant_sheet():
    print("variant contact sheet")
    tmp = "/tmp"
    rows = []
    for name in SEAMS:
        two = os.path.join(tmp, f"eb-{name}.svg")
        flat = os.path.join(tmp, f"eb-{name}-flat.svg")
        open(two, "w").write(svg_fullbleed(name, GROUND))
        open(flat, "w").write(svg_fullbleed(name, GROUND, ca=LABEL, cb=LABEL))
        rows.append((f"{CONCEPT_FILES[name][1].split('— ')[1]}", two, True, None, None))
        rows.append(("  └ one flat colour", flat, True, None, None))
    contact_sheet(rows, os.path.join(BRAND, "variants-contact-sheet.png"))


def build_production(name=SHIPPING):
    print("production svg")
    files = {
        "echobrief-icon.svg":         svg_fullbleed(name, GROUND),
        "echobrief-icon-light.svg":   svg_fullbleed(name, "#FFFFFF"),
        "echobrief-icon-dark.svg":    svg_inset(name, 0.72, title="EchoBrief app icon (dark)"),
        "echobrief-icon-tinted.svg":  svg_inset(name, 0.72, ca=TINT_HI, cb=TINT_LO,
                                                title="EchoBrief app icon (tinted)"),
        "echobrief-mark.svg":         svg_mark(name),
        "echobrief-mark-mono.svg":    svg_mark(name, ca=LABEL, cb=LABEL),
        "echobrief-android-foreground.svg": svg_inset(name, 0.60, title="EchoBrief adaptive foreground"),
        "echobrief-android-background.svg":
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" '
            f'height="1024"><rect width="100" height="100" fill="{GROUND}"/></svg>\n',
        "echobrief-android-monochrome.svg": svg_inset(name, 0.60, ca="#FFFFFF", cb="#FFFFFF",
                                                      title="EchoBrief themed icon"),
        "echobrief-splash.svg":       svg_inset(name, 0.86, title="EchoBrief splash mark"),
    }
    for fn, svg in files.items():
        open(os.path.join(BRAND, fn), "w").write(svg)
        print(f"  {os.path.relpath(os.path.join(BRAND, fn), REPO)}")

    print("png assets")
    b = lambda f: os.path.join(BRAND, f)
    a = lambda f: os.path.join(ASSETS, f)
    write_png(b("echobrief-icon.svg"), a("icon.png"), 1024, "RGB")
    write_png(b("echobrief-icon-light.svg"), a("icon-light.png"), 1024, "RGB")
    write_png(b("echobrief-icon-dark.svg"), a("icon-dark.png"), 1024, "RGBA")
    write_png(b("echobrief-icon-tinted.svg"), a("icon-tinted.png"), 1024, "RGBA")
    write_png(b("echobrief-android-foreground.svg"), a("android-icon-foreground.png"), 1024, "RGBA")
    write_png(b("echobrief-android-background.svg"), a("android-icon-background.png"), 1024, "RGB")
    write_png(b("echobrief-android-monochrome.svg"), a("android-icon-monochrome.png"), 1024, "RGBA")
    write_png(b("echobrief-icon.svg"), a("favicon.png"), 192, "RGB")
    write_png(b("echobrief-splash.svg"), a("splash-icon.png"), 1024, "RGBA")


def build_proof():
    print("size proof")
    b = lambda f: os.path.join(BRAND, f)
    rows = [
        ("icon.png (default)", b("echobrief-icon.svg"), True, None, None),
        ("icon-light.png", b("echobrief-icon-light.svg"), True, None, None),
        ("icon-dark.png on system dark", b("echobrief-icon-dark.svg"), False, (10, 11, 14), None),
        ("icon-tinted.png (simulated)", b("echobrief-icon-tinted.svg"), False, (10, 11, 14), (110, 160, 235)),
        ("android foreground", b("echobrief-android-foreground.svg"), False, (6, 7, 10), None),
        ("android monochrome", b("echobrief-android-monochrome.svg"), False, (6, 7, 10), None),
        ("mark-mono (one flat colour)", b("echobrief-mark-mono.svg"), False, None, None),
    ]
    contact_sheet(rows, os.path.join(BRAND, "proof-icon-sizes.png"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheets", action="store_true", help="contact sheets only")
    args = ap.parse_args()
    if args.sheets:
        build_concepts()
        build_variant_sheet()
    else:
        build_concepts()
        build_variant_sheet()
        build_production()
        build_proof()
