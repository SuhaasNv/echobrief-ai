import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  /**
   * Size variant
   * - sm: h-3 w-3 (for buttons)
   * - md: h-4 w-4 (for inline use)
   * - lg: h-5 w-5 (for page centers)
   */
  size?: "sm" | "md" | "lg";
  /**
   * Whether to center the spinner in a flex container
   * Useful for full-page or section loading states
   */
  center?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

const SIZE_CLASSES = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
} as const;

/**
 * Loading spinner component
 * 
 * Replaces inline Loader2 usage with a standardized component.
 * Provides consistent sizing and optional centering.
 * 
 * @example
 * // Button spinner
 * <LoadingSpinner size="sm" />
 * 
 * @example
 * // Centered page loader
 * <LoadingSpinner size="lg" center />
 * 
 * @example
 * // Custom styling
 * <LoadingSpinner size="md" className="text-brand" />
 */
export function LoadingSpinner({
  size = "md",
  center = false,
  className,
}: LoadingSpinnerProps) {
  const spinner = (
    <Loader2
      className={cn(
        SIZE_CLASSES[size],
        "animate-spin text-muted-foreground",
        className,
      )}
    />
  );

  if (center) {
    return (
      <div className="flex items-center justify-center">
        {spinner}
      </div>
    );
  }

  return spinner;
}
