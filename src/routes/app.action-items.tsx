import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { actionItems } from "@/lib/mock-data";

export const Route = createFileRoute("/app/action-items")({
  head: () => ({ meta: [{ title: "Action Items — EchoBrief" }] }),
  component: ActionItemsPage,
});

function ActionItemsPage() {
  const [items, setItems] = useState(actionItems);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  const toggle = (id: number) =>
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Action items</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {open.length} open · {done.length} completed
      </p>

      <div className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Open</p>
        <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-surface">
          {open.map((a, i) => (
            <div
              key={a.id}
              className={`group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40 ${
                i > 0 ? "border-t border-border/60" : ""
              }`}
            >
              <button onClick={() => toggle(a.id)} className="mt-0.5 text-muted-foreground hover:text-brand">
                <Circle className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{a.title}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {a.meeting} · <span className="font-mono">{a.owner}</span>
                </p>
              </div>
              <span className="rounded-md bg-accent px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{a.due}</span>
            </div>
          ))}
        </div>
      </div>

      {done.length > 0 && (
        <div className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Completed</p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-surface/50">
            {done.map((a, i) => (
              <div
                key={a.id}
                className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-border/60" : ""}`}
              >
                <button onClick={() => toggle(a.id)} className="mt-0.5 text-success">
                  <CheckCircle2 className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground line-through">{a.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/70">{a.meeting} · {a.owner}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
