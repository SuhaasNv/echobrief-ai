"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";

/**
 * Brand-colored stroke that fills in as the user scrolls down the page and
 * retracts on scroll up. Rendered absolutely inside its parent — the parent
 * must be `relative` and clip its horizontal overflow.
 */
export function ScrollFollowLine() {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  const pathLength = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.04, 0.95, 1], [0, 0.6, 0.6, 0.2]);

  if (reduceMotion) return null;

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-0 overflow-hidden"
    >
      <svg
        className="absolute right-0 top-0 h-full w-[42vw] max-w-[640px] text-brand"
        viewBox="0 0 640 4800"
        fill="none"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <motion.path
          d="M520 0
             C 520 280, 120 360, 280 640
             C 420 880, 580 980, 460 1240
             C 360 1460, 80 1540, 220 1820
             C 340 2060, 560 2180, 420 2440
             C 300 2680, 60 2780, 200 3060
             C 320 3300, 540 3400, 400 3680
             C 280 3920, 60 4060, 240 4320
             C 360 4500, 540 4600, 460 4800"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            pathLength,
            opacity,
          }}
        />
      </svg>
    </div>
  );
}

export default ScrollFollowLine;
