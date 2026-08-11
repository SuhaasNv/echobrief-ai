import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Trash2,
  CheckSquare,
  Square,
  ChevronRight,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import type { ActionItem } from "@/lib/schemas";
import { useActionItems, usePatchActionItem, useDeleteActionItem } from "@/lib/api/hooks";
import { useLabels, useActiveWorkspaceKind } from "@/lib/workspace-store";
import { formatDue, isOverdue } from "@/lib/date-utils";

export const Route = createFileRoute("/app/action-items")({
  head: () => ({ meta: [{ title: "Action Items — EchoBrief" }] }),
  component: ActionItemsPage,
});

function ActionItemsPage() {
  const { data, isLoading, isError, refetch } = useActionItems();
  const patch = usePatchActionItem();
  const del = useDeleteActionItem();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const labels = useLabels();
  const kind = useActiveWorkspaceKind();

  const items = useMemo(() => data?.items ?? [], [data]);
  const open = useMemo(() => items.filter((i) => !i.completed), [items]);
  const done = useMemo(() => items.filter((i) => i.completed), [items]);
  const overdue = useMemo(() => open.filter((i) => isOverdue(i.due_date)).length, [open]);

  const allOpenIds = useMemo(() => new Set(open.map((i) => i.id)), [open]);
  const allDoneIds = useMemo(() => new Set(done.map((i) => i.id)), [done]);

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  const bulkComplete = async (completed: boolean) => {
    const ids = [...selected];
    // Swallowing rejections and always toasting success meant a fully failed
    // batch reported "N items completed" while the optimistic updates rolled
    // the rows straight back. Count what actually landed.
    const results = await Promise.allSettled(
      ids.map((id) => patch.mutateAsync({ id, patch: { completed } })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    const ok = ids.length - failed;
    const verb = completed ? "completed" : "reopened";
    if (ok > 0) toast.success(`${ok} item${ok === 1 ? "" : "s"} ${verb}`);
    if (failed > 0) toast.error(`${failed} item${failed === 1 ? "" : "s"} couldn't be updated`);
    setSelected(new Set());
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (
      !confirm(
        `Delete ${ids.length} action item${ids.length === 1 ? "" : "s"}? This can't be undone.`,
      )
    )
      return;
    const results = await Promise.allSettled(ids.map((id) => del.mutateAsync(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    const ok = ids.length - failed;
    if (ok > 0) toast.success(`Deleted ${ok}`);
    if (failed > 0) toast.error(`${failed} item${failed === 1 ? "" : "s"} couldn't be deleted`);
    setSelected(new Set());
  };

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center">
        <h2 className="text-lg font-medium">Could not load action items.</h2>
        <button
          onClick={() => refetch()}
          className="mt-3 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  const allSelected = selected.size === items.length && items.length > 0;
  const hasSelection = selected.size > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{labels.actions.plural}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {kind === "student" ? "From your lectures" : "Extracted from every meeting"} ·{" "}
            {items.length} total ·{" "}
            {overdue > 0 && <span className="text-destructive">{overdue} overdue · </span>}
            {open.length} open · {done.length} completed
          </p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Open" value={open.length} accent="text-foreground" icon={Circle} />
        <Kpi label="Completed" value={done.length} accent="text-success" icon={CheckCircle2} />
        <Kpi
          label="Overdue"
          value={overdue}
          accent={overdue > 0 ? "text-destructive" : "text-muted-foreground"}
          icon={AlertTriangle}
        />
        <Kpi
          label="Across meetings"
          value={new Set(items.map((i) => i.meeting_id)).size}
          accent="text-foreground"
          icon={Clock}
        />
      </div>

      {items.length === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-border/70 bg-surface/40 py-16 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No action items yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload a meeting and EchoBrief will extract them automatically.
          </p>
        </div>
      ) : (
        <>
          {/* Bulk action bar */}
          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-surface px-3 py-2">
            <button
              type="button"
              onClick={selectAll}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {allSelected ? (
                <CheckSquare className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            {hasSelection && (
              <>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {selected.size} selected
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => bulkComplete(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Mark done
                  </button>
                  <button
                    type="button"
                    onClick={() => bulkComplete(false)}
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Circle className="h-3 w-3" /> Mark open
                  </button>
                  <button
                    type="button"
                    onClick={bulkDelete}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive hover:bg-destructive/20"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Two-column Kanban-style: open on left, done on right */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Column
              label="Open"
              icon={Circle}
              accent="text-brand"
              items={open}
              selected={selected}
              onToggleSelect={toggleSelect}
              onToggleDone={(item) =>
                patch.mutate({ id: item.id, patch: { completed: !item.completed } })
              }
              onDelete={(item) => del.mutate(item.id)}
              hasSelection={hasSelection}
            />
            <Column
              label="Completed"
              icon={CheckCircle2}
              accent="text-success"
              items={done}
              selected={selected}
              onToggleSelect={toggleSelect}
              onToggleDone={(item) =>
                patch.mutate({ id: item.id, patch: { completed: !item.completed } })
              }
              onDelete={(item) => del.mutate(item.id)}
              hasSelection={hasSelection}
              dimmed
            />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: number;
  accent: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <p className={`mt-3 font-mono text-3xl font-semibold tracking-tight ${accent}`}>{value}</p>
    </div>
  );
}

function Column({
  label,
  icon: Icon,
  accent,
  items,
  selected,
  onToggleSelect,
  onToggleDone,
  onDelete,
  hasSelection,
  dimmed = false,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  items: ActionItem[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleDone: (item: ActionItem) => void;
  onDelete: (item: ActionItem) => void;
  hasSelection: boolean;
  dimmed?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">· {items.length}</span>
      </div>
      <div
        className={`overflow-hidden rounded-xl border border-border/70 ${dimmed ? "bg-surface/50" : "bg-surface"}`}
      >
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">Empty.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((a) => {
              const isSel = selected.has(a.id);
              const overdueFlag = !a.completed && isOverdue(a.due_date);
              return (
                <li
                  key={a.id}
                  className={`group flex items-start gap-3 px-4 py-3 transition-colors ${
                    isSel ? "bg-accent/40" : "hover:bg-accent/30"
                  }`}
                >
                  {/* Selection checkbox (only when in bulk mode or by hover) */}
                  <button
                    type="button"
                    onClick={() => onToggleSelect(a.id)}
                    aria-label={isSel ? "Deselect" : "Select"}
                    className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                      isSel
                        ? "border-brand bg-brand text-white"
                        : "border-border/70 text-transparent hover:border-foreground/40"
                    } ${hasSelection ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                  >
                    {isSel && <CheckSquare className="h-3 w-3" />}
                  </button>

                  {/* Complete toggle */}
                  <button
                    type="button"
                    onClick={() => onToggleDone(a)}
                    aria-label={a.completed ? "Reopen" : "Mark done"}
                    className={`mt-0.5 shrink-0 transition-colors ${
                      a.completed ? "text-success" : "text-muted-foreground hover:text-brand"
                    }`}
                  >
                    {a.completed ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </button>

                  {/* Body */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${a.completed ? "text-muted-foreground line-through" : ""}`}
                    >
                      {a.description}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {a.meeting_title ? (
                        <Link
                          to="/app/meetings/$id"
                          params={{ id: a.meeting_id }}
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          {a.meeting_title} <ChevronRight className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="italic">Untitled meeting</span>
                      )}
                      {a.assignee_name && (
                        <>
                          {" "}
                          · <span className="font-mono">{a.assignee_name}</span>
                        </>
                      )}
                    </p>
                  </div>

                  {/* Due + delete */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 font-mono text-[10px] ${
                        overdueFlag
                          ? "bg-destructive/15 text-destructive"
                          : "bg-accent text-muted-foreground"
                      }`}
                    >
                      {formatDue(a.due_date)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDelete(a)}
                      aria-label="Delete"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
