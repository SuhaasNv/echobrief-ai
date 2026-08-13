# EchoBrief brand

## The mark — "The Handoff"

One block of time, split by a single stepped seam into two speaker masses.

The block is a meeting. The seam is the handoff between speakers. The two masses
are who was talking, and roughly how much. It is the Ribbon's argument — time
divided by *who spoke*, not by amplitude — restated in a square, because a
horizontal strip cannot survive an app icon.

The mark is structural rather than decorative, which is the whole test: the
division is a physical gap, so it still reads when the mark is one flat colour
and when it is 14px wide. Nothing about it depends on hue, gradient, or detail.

Two properties do the work:

- **One step, not a run of them.** The seam runs in from the left edge, turns
  down once at dead centre, and runs out the right edge. A single division is a
  handoff. Four small ones in the same direction were a staircase.
- **180° rotational symmetry.** The two masses are congruent under a half-turn
  about the centre of the square. Their areas are therefore *exactly* equal —
  42.6% each, with 14.9% channel — and neither mass is on top, because there is
  no consistent up. Turn the icon upside down and you get the same mark with the
  speakers swapped, which is what a conversation is.

What it deliberately is not: no waveform, no sparkle, no orb, no brain, no
speech bubble, no letter in a circle, and no ascending steps.

### What replaced, and why

The previous mark ("The Turn", `archive/the-turn/`, `concepts/concept-3-*`) used
the same two-mass idea with a four-step monotonic seam. Every step went the same
direction, which is the visual grammar of a growth chart. It read as analytics or
fintech no matter how the masses were balanced — balancing them to 40/43 was
tried and did not fix it, because the problem was the *direction* of the seam,
not the weight of the masses. Killing the run of steps kills the reading. The
argument, the palette, the physical gap, and the 24-unit riser all survive.

## Construction

Everything derives from one number set. `build-icons.py` holds the seam
centreline and offsets it by half the channel width to each side, so the channel
is exactly 12 units everywhere and the masses are provably equal. Nothing is
drawn by hand.

```
seam centreline (100-unit square):  (-10,38) → (50,38) → (50,62) → (110,62)
channel:                            12 units
upper mass:                         -10,32  56,32  56,56  110,56  110,-20  -10,-20
lower mass:                         -10,44  44,44  44,68  110,68  110,120  -10,120
```

Regenerate every SVG and PNG with:

```bash
python3 docs/brand/build-icons.py           # needs rsvg-convert + Pillow
python3 docs/brand/build-icons.py --sheets  # contact sheets only
```

## Colour

| Role | Hex | Token |
| --- | --- | --- |
| Ground / the seam | `#06070A` | `--background` |
| Upper mass — speaker one | `#4C99F8` | `--tint`, `--speaker-a` |
| Lower mass — speaker two | `#2FC183` | `--success`, `--speaker-c` |
| Mono mark, wordmark | `#F4F5F7` | `--label` |

Violet `#A27DFA` is **not** in the mark, and must not be. In this product violet
means "a model produced this" and appears only on AI output. A speaker mass in
violet would say a machine did the talking.

The two masses use the speaker palette because that is what they are. Any other
pair from that palette (`#4C99F8` `#A27DFA` `#2FC183` `#E6AC3D` `#7A869F`) is a
misuse unless you are deliberately illustrating the palette itself.

## Clear space

One riser — 24% of the mark's side — on all four sides. The riser is the
vertical jump in the seam, so the rule is measurable off the artwork itself
rather than remembered.

At a 100-unit mark that is 24 units. Nothing sets inside it.

## Minimum sizes

Measured, not assumed. Each size below was rendered at true pixel size and then
magnified with nearest-neighbour so the actual pixels could be counted; the
failure mode is the channel closing up under anti-aliasing.

| Asset | Floor | Comfortable |
| --- | --- | --- |
| Mark (2-tone or mono) | 14px | 18px |
| Wordmark | 80px wide | 100px wide |
| App icon | verified legible at 29pt (Settings) and 60pt (home screen) | — |

At 18px and above the channel is a clean dark line. At 14px it is a soft 1.7px
line but still continuous edge to edge, and the step still reads. At 12px the
vertical part of the step closes and the two masses fuse into one glyph. Do not
set the mark below 14px; use a different element instead.

This is 2px better than the previous mark, which floored at 16px — one turn in
the seam gives anti-aliasing fewer places to bridge than four did.

## Wordmark

Space Grotesk **Bold** (700), tracking **-0.02em**, set as "EchoBrief" — one
word, capital E, capital B, no space.

The negative tracking is doing work: Space Grotesk is wide, and at display size
the default fit lets the word fall apart into two halves either side of the
capital B. -0.02em holds it as a single word without crowding the `hoB` join.

`echobrief-wordmark.svg` ships as outlines, so it needs no font at render time.
Proportions are 4453 × 728 units (6.12:1), cap height 700.

In the lockup, the mark is **1.15 × cap height**, optically centred on the cap
band, with a gap of **0.44 × the mark's side**.

## Icon variants

| File | Appearance | Construction |
| --- | --- | --- |
| `icon.png` | default / light | Full-bleed, opaque, square corners. Ground shows only through the seam. |
| `icon-light.png` | iOS light | Same geometry, white ground, white seam. |
| `icon-dark.png` | iOS dark | Mark only, transparent background — iOS supplies the backdrop. |
| `icon-tinted.png` | iOS tinted | Greyscale, transparent. Upper mass white, lower mass 60% grey. |

The tinted variant works because the two masses carry different values, not just
different hues, so the two-speaker reading survives the system's monochrome
tint. A mark that distinguished its parts by hue alone would collapse here.

The icon is full-bleed with **sharp 90° corners** and **no alpha** — iOS applies
its own mask, and the App Store rejects alpha.

## What not to do

- Do not add steps to the seam. One turn is the mark. Two or more turns going
  the same way is a staircase, and a staircase is why the previous mark died.
- Do not move the turn off centre. Off-centre breaks the rotational symmetry,
  and with it the equal masses and the "neither speaker is on top" reading.
- Do not round the icon's corners. iOS masks it; baking corners produces a halo.
- Do not add gradients, glows, inner shadows, or bevels. The mark is flat.
- Do not change the channel width. It is 12 units against a 100-unit side, and
  it is what makes the mark legible at 14px.
- Do not recolour a mass to violet, or to a colour outside the speaker palette.
- Do not rotate, shear, or stretch. Uniform scale only. (A half-turn maps the
  mark onto itself but swaps the speaker colours, which says the wrong thing.)
- Do not outline the mark or add a keyline.
- Do not place the 2-tone mark on a mid-tone background — both masses lose
  contrast at once. Use the mono mark on anything that is not near-black or
  near-white.
- Do not reintroduce a waveform anywhere in the identity. The absence of one is
  the argument.

## Files

Sources are SVG and are the originals; the PNGs are generated from them by
`build-icons.py`. Nothing here is drawn by hand.

```
docs/brand/
  build-icons.py                   geometry + every SVG and PNG, reproducible
  echobrief-mark.svg               2-tone mark, transparent seam
  echobrief-mark-mono.svg          single flat colour
  echobrief-wordmark.svg           outlined, Space Grotesk Bold, -0.02em
  echobrief-lockup.svg             mark + wordmark
  echobrief-icon.svg               1024 full-bleed icon master
  echobrief-icon-light.svg         iOS light appearance
  echobrief-icon-dark.svg          iOS dark appearance
  echobrief-icon-tinted.svg        iOS tinted appearance
  echobrief-android-foreground.svg adaptive icon foreground (60% safe zone)
  echobrief-android-background.svg adaptive icon background
  echobrief-android-monochrome.svg themed-icon layer
  echobrief-splash.svg             splash mark
  proof-icon-sizes.png             every shipped variant at 180/120/87/60/29px
  variants-contact-sheet.png       the three candidates, 2-tone and flat
  concepts/                        concepts 1–3 (first round), 4–6 (this round)
  archive/the-turn/                the superseded mark, kept so this is reversible

apps/mobile/assets/                generated PNGs, wired in app.json
```

Filenames are unchanged from the previous mark, so `app.json` needed no edit.
Icon and adaptive-icon changes need a native rebuild. They do not appear on hot
reload.

## The three candidates

Rendered at 180/120/87/60/29px with an iOS corner mask, two-tone and one flat
colour — `variants-contact-sheet.png`. All three are non-monotonic or single
step, all three have exactly equal masses, all three survive one flat colour.

| Concept | Seam | Masses | Verdict |
| --- | --- | --- | --- |
| 4 · The Handoff | one turn at centre, 180° rotational | 42.6 / 42.6 | **ships** |
| 5 · The Interleave | two tabs, each mass crossing the centre, 180° rotational | 40.2 / 40.2 | dropped |
| 6 · The Interruption | one reversal, mirror symmetric | 40.4 / 40.4 | dropped |

**The Interleave** was the most literal picture of turn-taking and it is the best
of the three at 180px. It fails the size test: the two tabs and the short return
run at the right sit inside 20 units of each other, so at 60px they start to
merge and at 29px the flat version is a squiggle rather than a division. It also
has the most channel (19.7%), which is what makes it feel drawn rather than cut.

**The Interruption** survives every size, but it reads as an object rather than a
division — a T, a plug, a tab in a socket. Its mirror symmetry is the cause: one
mass becomes a discrete thing sitting inside the other, so one speaker plainly is
on top, which is the opposite of what the mark is meant to say.

**The Handoff** is the only one where the small sizes look like the large size.

## Competitive position

Checked against the shipped artwork of Otter, Granola, Descript, Fireflies,
Fathom, tl;dv, Rev, Krisp, Sembly, Read AI, Superhuman.

The territory this mark stays out of: **horizontal segmented bars** are
Descript's (a circle sliced into rounded bar segments, red) and Fathom's (three
thick rounded bars on a diagonal, cyan on black); **waveform / level-meter
capsules** are Otter's; **spirals** are Granola's and Rev's; **double-lobed
pairs** are Sembly's; **overlapping diamonds** are Superhuman's. Two of the first
three concepts explored for EchoBrief were bar-stack forms and both were dropped
partly for this reason.

The Handoff avoids all of these by being a *cut*, not an arrangement of parts:
there is one shape, the square, and one line through it. It is also not three
bars (two masses, and they are not bars), not a bubble, not a triangle in a
circle, and not a hamburger — the seam is one line, not three, and it changes
direction.

Two associations it does carry, stated plainly: at a glance the mono mark can
read as a **Z**, and the inset monochrome Android layer can read as a stylised
**2**. Both were judged acceptable — neither is a competitor's territory, neither
is a word, and both disappear the moment the mark is two-tone. The colour
position (azure `#4C99F8` + green `#2FC183` on near-black) is unclaimed in this
set; Otter is indigo, tl;dv electric blue, Fathom cyan-on-black, Granola
chartreuse.
