import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const nav = [
  { label: "Product", to: "/" },
  { label: "Features", to: "/" },
  { label: "Pricing", to: "/" },
  { label: "Customers", to: "/" },
  { label: "Changelog", to: "/" },
];

export function SiteHeader() {
  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-50 w-full"
    >
      <div className="mx-auto mt-4 flex max-w-6xl items-center justify-between rounded-full border border-border/60 bg-background/60 px-4 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <Link
                key={n.label}
                to={n.to}
                className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            Sign in
          </Link>
          <Button asChild size="sm" className="rounded-full">
            <Link to="/signup">Get started</Link>
          </Button>
        </div>
      </div>
    </motion.header>
  );
}
