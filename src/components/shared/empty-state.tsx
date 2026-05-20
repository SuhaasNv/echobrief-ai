import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  /**
   * Optional icon to display above the title
   */
  icon?: LucideIcon;
  /**
   * Main title text
   */
  title: string;
  /**
   * Optional description text (1-2 sentences)
   */
  description?: string;
  /**
   * Optional call-to-action button
   */
  action?: {
    label: string;
    onClick: () => void;
  };
  /**
   * Additional CSS classes for the container
   */
  className?: string;
}

/**
 * Empty state component
 * 
 * Standardized empty state UI used across the application.
 * Displays an optional icon, title, description, and action button.
 * 
 * @example
 * // Simple empty state
 * <EmptyState
 *   title="No meetings yet"
 *   description="Upload your first meeting to get started."
 * />
 * 
 * @example
 * // With icon and action
 * <EmptyState
 *   icon={FileAudio}
 *   title="No meetings found"
 *   description="Try adjusting your search or filters."
 *   action={{ label: "Clear filters", onClick: handleClear }}
 * />
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-surface/40 px-4 py-16 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="mb-4 rounded-full bg-muted/50 p-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      
      <h3 className="text-sm font-medium text-foreground">
        {title}
      </h3>
      
      {description && (
        <p className="mt-1 text-xs text-muted-foreground">
          {description}
        </p>
      )}
      
      {action && (
        <Button
          onClick={action.onClick}
          variant="outline"
          size="sm"
          className="mt-4"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
