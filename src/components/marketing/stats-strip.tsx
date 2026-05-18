import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

interface Stat {
  value: number;
  suffix?: string;
  prefix?: string;
  label: string;
  /** how to format the number while counting (default: en-US thousands) */
  format?: (n: number) => string;
}

const STATS: Stat[] = [
  { value: 4_700_000, suffix: "+", label: "Minutes transcribed", format: (n) => abbrev(n) },
  { value: 92, suffix: "%", label: "Action items captured automatically" },
  { value: 23, suffix: "s", label: "Avg time to summary, 1-hour meeting" },
  { value: 99.94, suffix: "%", label: "API uptime past 90 days" },
];

function abbrev(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return Math.floor(n).toString();
}

export function StatsStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="px-6 py-16" ref={ref}>
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="grid divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-surface/40 sm:grid-cols-2 sm:divide-x lg:grid-cols-4"
        >
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={`relative p-6 sm:p-8 ${
                i >= 2 ? "border-t border-border/60 lg:border-t-0" : ""
              }`}
            >
              <CountUp stat={s} active={inView} delay={i * 0.08} />
              <p className="mt-2 text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function CountUp({
  stat,
  active,
  delay,
}: {
  stat: Stat;
  active: boolean;
  delay: number;
}) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(reduceMotion ? stat.value : 0);

  useEffect(() => {
    if (!active || reduceMotion) {
      if (reduceMotion) setDisplay(stat.value);
      return;
    }
    const start = performance.now() + delay * 1000;
    const duration = 1400;
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(stat.value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, delay, stat.value, reduceMotion]);

  const formatted = stat.format
    ? stat.format(display)
    : Number.isInteger(stat.value)
      ? Math.floor(display).toLocaleString()
      : display.toFixed(2);

  return (
    <p
      className="font-display text-5xl font-bold leading-none tracking-tighter text-foreground tabular-nums md:text-6xl"
      style={{ fontFeatureSettings: '"ss01", "cv01", "cv11"' }}
    >
      {stat.prefix}
      {formatted}
      <span className="ml-0.5 text-brand">{stat.suffix}</span>
    </p>
  );
}
