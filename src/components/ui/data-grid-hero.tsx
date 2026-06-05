"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Generative hero with animated grid background.
 *
 * Adapted from a 21st.dev component (originally JS + PropTypes). Converted
 * to TypeScript, theme-aware colors (defaults to our brand blue), and
 * `prefers-reduced-motion` safe.
 *
 * Cells are created imperatively in a single useEffect so the grid is
 * cheap to update when props change. The animation itself is CSS — see
 * the `cell-pulse` keyframe and `.grid-cell` styles in src/styles.css.
 */

export type GridAnimationType = "pulse" | "wave" | "random";

export interface DataGridHeroProps {
  rows?: number;
  cols?: number;
  /** Gap between cells, px */
  spacing?: number;
  /** Pulse cycle duration, seconds */
  duration?: number;
  /** CSS color for cells — accepts var(), oklch(), hsl(), etc */
  color?: string;
  animationType?: GridAnimationType;
  pulseEffect?: boolean;
  mouseGlow?: boolean;
  opacityMin?: number;
  opacityMax?: number;
  /** Container background — pass "transparent" if you have a parent bg */
  background?: string;
  children?: ReactNode;
  className?: string;
}

const DEFAULTS: Required<Omit<DataGridHeroProps, "children" | "className">> = {
  rows: 20,
  cols: 30,
  spacing: 6,
  duration: 6,
  color: "var(--color-brand)",
  animationType: "pulse",
  pulseEffect: true,
  mouseGlow: true,
  opacityMin: 0.08,
  opacityMax: 0.38,
  background: "transparent",
};

export function DataGridHero(props: DataGridHeroProps) {
  const cfg = { ...DEFAULTS, ...props };
  const {
    rows,
    cols,
    spacing,
    duration,
    color,
    animationType,
    pulseEffect,
    mouseGlow,
    opacityMin,
    opacityMax,
    background,
    children,
    className,
  } = cfg;

  const gridRef = useRef<HTMLDivElement>(null);

  // Build grid cells whenever config changes.
  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches !== undefined &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    container.innerHTML = "";
    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    container.style.gap = `${spacing}px`;
    container.style.setProperty("--mouse-glow-opacity", mouseGlow ? "1" : "0");

    const total = rows * cols;
    const centerRow = Math.floor(rows / 2);
    const centerCol = Math.floor(cols / 2);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.style.backgroundColor = color;
      cell.style.setProperty("--opacity-min", String(opacityMin));
      cell.style.setProperty("--opacity-max", String(opacityMax));

      if (pulseEffect && !reduced) {
        let delay: number;
        const r = Math.floor(i / cols);
        const c = i % cols;

        if (animationType === "wave") {
          delay = (r + c) * 0.1;
        } else if (animationType === "random") {
          delay = Math.random() * duration;
        } else {
          const dr = Math.abs(r - centerRow);
          const dc = Math.abs(c - centerCol);
          delay = Math.sqrt(dr * dr + dc * dc) * 0.2;
        }

        cell.style.animation = `cell-pulse ${duration}s infinite alternate`;
        cell.style.animationDelay = `${delay.toFixed(3)}s`;
      } else {
        // Static — settle at the midpoint so the grid still reads visually.
        cell.style.opacity = String((opacityMin + opacityMax) / 2);
      }

      frag.appendChild(cell);
    }
    container.appendChild(frag);
  }, [
    rows,
    cols,
    spacing,
    color,
    animationType,
    pulseEffect,
    duration,
    opacityMin,
    opacityMax,
    mouseGlow,
  ]);

  // Mouse-follow glow — sets CSS vars on the grid container.
  useEffect(() => {
    if (!mouseGlow) return;
    const el = gridRef.current;
    if (!el) return;

    const handler = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      el.style.setProperty("--mouse-x", `${x}px`);
      el.style.setProperty("--mouse-y", `${y}px`);
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [mouseGlow]);

  return (
    <div className={`data-grid-hero ${className ?? ""}`} style={{ background }}>
      <div ref={gridRef} className="grid-container" aria-hidden="true" />
      {children !== undefined && <div className="hero-content">{children}</div>}
    </div>
  );
}

export default DataGridHero;
