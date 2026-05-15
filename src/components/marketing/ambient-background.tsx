import { motion, useReducedMotion } from "framer-motion";

/**
 * Ambient background for the landing page.
 *
 * Three blurred color "auroras" that slowly drift via GPU-only transforms,
 * a thin top accent line, a base radial gradient, and an SVG-noise overlay
 * to kill banding and add depth.
 *
 * All animations respect `prefers-reduced-motion`.
 */

// Inline SVG fractal noise — encoded as a data URI to avoid an extra request.
// (Cheaper than a PNG and resolution-independent.)
const NOISE_SVG = encodeURIComponent(
  `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
    <filter id="n">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0"/>
    </filter>
    <rect width="100%" height="100%" filter="url(#n)"/>
  </svg>`,
);

const NOISE_URL = `url("data:image/svg+xml;utf8,${NOISE_SVG}")`;

export function AmbientBackground() {
  const reduce = useReducedMotion();

  // Each blob has its own drift cadence so they never line up — makes the
  // motion feel organic instead of rhythmic.
  const blobs: Array<{
    className: string;
    duration: number;
    keyframes: { x: number[]; y: number[] };
  }> = [
    {
      className: "left-[8%] top-[-12%] h-[640px] w-[820px] bg-brand/30",
      duration: 32,
      keyframes: { x: [0, 60, -30, 0], y: [0, 50, -20, 0] },
    },
    {
      className: "right-[-6%] top-[35%] h-[520px] w-[720px] bg-violet/25",
      duration: 42,
      keyframes: { x: [0, -80, 40, 0], y: [0, -40, 60, 0] },
    },
    {
      className: "left-[25%] top-[78%] h-[560px] w-[760px] bg-brand/15",
      duration: 38,
      keyframes: { x: [0, -50, 70, 0], y: [0, 30, -50, 0] },
    },
  ];

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Soft base radial — anchors the eye to the hero */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 60% at 50% -10%, color-mix(in oklch, var(--color-brand), transparent 78%), transparent 65%)",
        }}
      />

      {/* Aurora blobs — slow GPU-only drift */}
      {blobs.map((b, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full blur-[120px] ${b.className}`}
          animate={reduce ? undefined : b.keyframes}
          transition={
            reduce
              ? undefined
              : {
                  duration: b.duration,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 1.5,
                }
          }
        />
      ))}

      {/* Top accent — hairline gradient line that fades from brand to nothing */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, color-mix(in oklch, var(--color-brand), transparent 40%), transparent)",
        }}
      />

      {/* SVG noise — kills the smooth-gradient bands and adds depth */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay dark:opacity-[0.08]"
        style={{ backgroundImage: NOISE_URL, backgroundSize: "240px 240px" }}
      />

      {/* Vignette — subtle darken at the very edges, keeps content focal */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 50%, transparent 60%, color-mix(in oklch, var(--color-background), transparent 0%) 100%)",
          opacity: 0.5,
        }}
      />
    </div>
  );
}
