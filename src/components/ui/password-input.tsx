"use client";

import { forwardRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

/**
 * Password field with an animated reveal toggle. Wraps the standard shadcn
 * Input styles so it drops into existing forms without visual drift.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const reduceMotion = useReducedMotion();

    return (
      <div className="relative">
        <input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent pr-10 pl-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className,
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-r-md"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={visible ? "shown" : "hidden"}
              initial={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: 0, scale: 0.6, rotate: -45, filter: "blur(2px)" }
              }
              animate={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: 1, scale: 1, rotate: 0, filter: "blur(0px)" }
              }
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, scale: 0.6, rotate: 45, filter: "blur(2px)" }
              }
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex"
            >
              {visible ? (
                <EyeOff className="h-4 w-4" strokeWidth={1.6} />
              ) : (
                <Eye className="h-4 w-4" strokeWidth={1.6} />
              )}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
