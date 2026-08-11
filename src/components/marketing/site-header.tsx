import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

interface NavItem {
  label: string;
  to: string;
  hash?: string;
}

const NAV: NavItem[] = [
  { label: "Features", to: "/", hash: "features" },
  { label: "Pricing", to: "/", hash: "pricing" },
  { label: "About", to: "/about" },
];

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

export function SiteHeader() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (latest) => {
    setScrolled(latest > 6);
  });

  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: EASE, delay: 0.05 }}
      className="sticky top-0 z-50 w-full"
    >
      <div
        className={`w-full transition-[background-color,border-color,backdrop-filter,box-shadow] duration-300 ${
          scrolled
            ? "border-b border-border/60 bg-background/75 shadow-[0_1px_0_0_rgba(255,255,255,0.02)] backdrop-blur-xl"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3.5">
          {/* Center nav with animated underlines */}
          <nav className="hidden flex-1 items-center justify-center gap-0.5 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.label} item={n} />
            ))}
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-1.5">
            <AnimatedThemeToggler />
            <Link
              to="/login"
              className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Sign in
            </Link>
            <Button asChild size="sm" className="group rounded-full">
              <Link to="/signup">
                Get started
                <ArrowRight className="ml-0.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </motion.header>
  );
}

function NavLink({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.to}
      hash={item.hash}
      className="group relative inline-flex items-center px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {item.label}
      {/* Animated underline — grows from center on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-3 -bottom-0.5 h-px origin-center scale-x-0 bg-foreground transition-transform duration-300 ease-out group-hover:scale-x-100"
      />
    </Link>
  );
}
