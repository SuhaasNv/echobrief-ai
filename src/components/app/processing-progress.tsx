import { motion, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/processing-status";

interface ProcessingTrackProps {
  percent: number;
  /** Tailwind height class — the list uses a thinner bar than the detail page. */
  heightClassName?: string;
  className?: string;
}

/**
 * The gradient progress bar shown while a meeting is being processed.
 *
 * Animates `scaleX`, not `width`: width is a layout property, and this bar
 * re-animates on every poll on every card in the list. `origin-left` keeps it
 * growing from the left edge.
 *
 * The sweeping shimmer is gated on `useReducedMotion()`. The global CSS guard
 * in styles.css only neutralises CSS animations — this one is framer-motion
 * driving a transform from JS, so without the gate it loops forever for users
 * who explicitly asked for no motion.
 */
export function ProcessingTrack({
  percent,
  heightClassName = "h-1.5",
  className,
}: ProcessingTrackProps) {
  const reduceMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div
      className={`relative ${heightClassName} w-full overflow-hidden rounded-full bg-muted/30 ${className ?? ""}`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Processing progress"
    >
      <motion.div
        className="absolute inset-0 origin-left rounded-full bg-gradient-to-r from-brand to-violet"
        initial={false}
        animate={{ scaleX: clamped / 100 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.65, ease: EASE }}
      />
      {!reduceMotion && clamped < 100 && (
        <motion.div
          className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
          animate={{ x: ["-30%", "330%"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
        />
      )}
    </div>
  );
}
