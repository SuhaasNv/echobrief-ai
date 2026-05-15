import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

interface TypewriterProps {
  words: string[];
  /** ms per character while typing */
  typeSpeed?: number;
  /** ms per character while deleting */
  deleteSpeed?: number;
  /** ms to hold the fully-typed word before deleting */
  holdMs?: number;
  /** ms to pause empty between words */
  pauseMs?: number;
  className?: string;
}

type Phase = "typing" | "holding" | "deleting" | "pausing";

/**
 * Animated typewriter that cycles through a list of phrases, retyping each
 * character then backspacing before moving to the next. Respects
 * `prefers-reduced-motion` — falls back to showing just the first word.
 *
 * Renders inline (so it can sit inside a heading) with a blinking caret.
 */
export function Typewriter({
  words,
  typeSpeed = 65,
  deleteSpeed = 30,
  holdMs = 1800,
  pauseMs = 280,
  className,
}: TypewriterProps) {
  const reduceMotion = useReducedMotion();

  // Index into `words`, current rendered substring, and animation phase.
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState(reduceMotion ? words[0] : "");
  const [phase, setPhase] = useState<Phase>(reduceMotion ? "holding" : "typing");

  useEffect(() => {
    if (reduceMotion) return;
    const word = words[idx];
    let timer: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      if (text.length < word.length) {
        timer = setTimeout(() => setText(word.slice(0, text.length + 1)), typeSpeed);
      } else {
        timer = setTimeout(() => setPhase("holding"), 10);
      }
    } else if (phase === "holding") {
      timer = setTimeout(() => setPhase("deleting"), holdMs);
    } else if (phase === "deleting") {
      if (text.length > 0) {
        timer = setTimeout(() => setText(text.slice(0, -1)), deleteSpeed);
      } else {
        timer = setTimeout(() => setPhase("pausing"), 10);
      }
    } else if (phase === "pausing") {
      timer = setTimeout(() => {
        setIdx((i) => (i + 1) % words.length);
        setPhase("typing");
      }, pauseMs);
    }

    return () => clearTimeout(timer);
  }, [text, phase, idx, words, typeSpeed, deleteSpeed, holdMs, pauseMs, reduceMotion]);

  return (
    <span className={className}>
      <span aria-live="polite">{text}</span>
      {!reduceMotion && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[0.85em] w-[3px] -mb-[0.1em] translate-y-[0.05em] rounded-[1px] bg-current align-baseline opacity-90 animate-[caret-blink_1s_steps(1)_infinite]"
        />
      )}
    </span>
  );
}
