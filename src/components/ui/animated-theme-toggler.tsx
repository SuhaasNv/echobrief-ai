"use client";

import { useEffect, useId, useRef, type MutableRefObject } from "react";
import { motion } from "framer-motion";
import { useTheme } from "@/components/theme/theme-provider";

/**
 * Animated Theme Toggler — sun↔moon morph.
 *
 * Sun rays shrink and rotate away.
 * Center circle swells into a moon body.
 * A mask carves the crescent. Spring physics throughout.
 * A soft switch-click sounds on toggle (opt-out via prop).
 *
 * Adapted from a 21st.dev component. Wired into our ThemeProvider so
 * localStorage + system-preference stay in sync; we do NOT touch
 * `document.documentElement` directly.
 */

export interface AnimatedThemeTogglerProps {
  sound?: boolean;
  className?: string;
}

/* ── Audio ── */

let _ctx: AudioContext | null = null;
let _buf: AudioBuffer | null = null;

function audioCtx(): AudioContext {
  if (!_ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    _ctx = new Ctor();
  }
  if (_ctx.state === "suspended") void _ctx.resume();
  return _ctx;
}

function ensureBuf(ac: AudioContext): AudioBuffer {
  if (_buf && _buf.sampleRate === ac.sampleRate) return _buf;
  const rate = ac.sampleRate;
  const len = Math.floor(rate * 0.006);
  const buf = ac.createBuffer(1, len, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const sine = Math.sin(2 * Math.PI * 3400 * t);
    const noise = Math.random() * 2 - 1;
    ch[i] = (sine * 0.6 + noise * 0.4) * (1 - t) ** 3;
  }
  _buf = buf;
  return buf;
}

function tick(last: MutableRefObject<number>): void {
  const now = performance.now();
  if (now - last.current < 80) return;
  last.current = now;
  try {
    const ac = audioCtx();
    const buf = ensureBuf(ac);
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    src.buffer = buf;
    gain.gain.value = 0.08;
    src.connect(gain);
    gain.connect(ac.destination);
    src.start();
  } catch {
    /* silent — autoplay policies, etc. */
  }
}

/* ── Component ── */

export function AnimatedThemeToggler({
  sound = true,
  className,
}: AnimatedThemeTogglerProps) {
  const rawId = useId();
  const maskId = `att${rawId.replace(/:/g, "")}`;
  const lastSnd = useRef(0);
  const isFirst = useRef(true);

  const { resolved, setTheme } = useTheme();
  const isDark = resolved === "dark";

  useEffect(() => {
    // Skip the entry animation on first paint — resolved theme is already
    // applied by the no-flash boot script before this component mounts.
    const id = requestAnimationFrame(() => {
      isFirst.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const toggle = () => {
    setTheme(isDark ? "light" : "dark");
    if (sound) tick(lastSnd);
  };

  const spring = isFirst.current
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 380, damping: 30 } as const);

  return (
    <motion.button
      type="button"
      onClick={toggle}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.86 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${className ?? ""}`}
    >
      <motion.svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        initial={false}
        animate={{ rotate: isDark ? 270 : 0 }}
        transition={spring}
        style={{ overflow: "visible" }}
      >
        {/* Mask carves the crescent from the center circle */}
        <mask id={maskId}>
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <motion.circle
            initial={false}
            animate={{ cx: isDark ? 17 : 33, cy: isDark ? 8 : 0 }}
            transition={spring}
            r={9}
            fill="black"
          />
        </mask>

        {/* Center body — small sun circle or large crescent moon */}
        <motion.circle
          cx={12}
          cy={12}
          fill="currentColor"
          stroke="none"
          mask={`url(#${maskId})`}
          initial={false}
          animate={{ r: isDark ? 9 : 5 }}
          transition={spring}
        />

        {/* Rays — shrink and rotate away when dark */}
        <motion.g
          initial={false}
          animate={{
            opacity: isDark ? 0 : 1,
            scale: isDark ? 0 : 1,
            rotate: isDark ? -30 : 0,
          }}
          transition={spring}
          style={{ transformOrigin: "12px 12px" }}
        >
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="5.64" y1="5.64" x2="4.22" y2="4.22" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          <line x1="5.64" y1="18.36" x2="4.22" y2="19.78" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        </motion.g>
      </motion.svg>
    </motion.button>
  );
}

export default AnimatedThemeToggler;
