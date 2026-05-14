import { Link } from "@tanstack/react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`group inline-flex items-center gap-2 ${className}`}>
      <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2 8 Q4 4 6 8 T10 8 T14 8" />
          <path d="M2 11 Q4 9 6 11 T10 11 T14 11" opacity="0.55" />
        </svg>
        <span className="pointer-events-none absolute inset-0 rounded-md bg-brand/40 opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">EchoBrief</span>
    </Link>
  );
}
