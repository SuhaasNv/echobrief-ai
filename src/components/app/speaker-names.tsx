import { useState } from "react";
import { Check, Pencil, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useRenameSpeakers } from "@/lib/api/hooks";

export interface DiarizedSpeaker {
  /** Raw AssemblyAI label — "A", "B". */
  id: string;
  /** Already resolved server-side: a human name, or "Speaker A". */
  label: string;
  talk_time_sec: number;
  word_count: number;
}

interface SpeakerNamesProps {
  meetingId: string;
  speakers: DiarizedSpeaker[];
  /**
   * Candidate names lifted from the meeting's own content (action-item
   * assignees). Offered as one-tap fills — never applied automatically. Being
   * named in a meeting doesn't prove which voice you are, and a confidently
   * wrong name on a decision is worse than an anonymous one.
   */
  suggestions?: string[];
}

/** A speaker is "named" when its label is something other than the fallback. */
function customName(s: DiarizedSpeaker): string {
  return s.label === `Speaker ${s.id}` ? "" : s.label;
}

function formatTalkTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/**
 * Put real names on diarized voices.
 *
 * Diarization separates who spoke, but AssemblyAI only ever calls them "A" and
 * "B" — accurate and anonymous. Naming is per meeting because labels are
 * assigned per recording: "A" here is not "A" in the next meeting, so carrying
 * names across would confidently mislabel people.
 */
export function SpeakerNames({ meetingId, speakers, suggestions = [] }: SpeakerNamesProps) {
  const rename = useRenameSpeakers(meetingId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (speakers.length === 0) return null;

  const totalTalk = speakers.reduce((acc, s) => acc + s.talk_time_sec, 0);
  // Don't re-offer a name already in use on another voice.
  const taken = new Set(speakers.map((s) => customName(s)).filter(Boolean));
  const available = suggestions.filter((n) => !taken.has(n));

  function startEdit(s: DiarizedSpeaker) {
    setEditingId(s.id);
    setDraft(customName(s));
  }

  async function save(s: DiarizedSpeaker, value: string) {
    const next = value.trim();
    // Send the whole map, not just this one: the endpoint replaces
    // speaker_names wholesale, so omitting the others would wipe them.
    const names: Record<string, string> = {};
    for (const other of speakers) {
      names[other.id] = other.id === s.id ? next : customName(other);
    }
    setEditingId(null);
    try {
      await rename.mutateAsync(names);
      toast.success(next ? `Renamed to ${next}` : "Name cleared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename speaker");
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-border/60 bg-surface/60 p-4">
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-brand" />
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {speakers.length} {speakers.length === 1 ? "voice" : "voices"} detected
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {speakers.map((s) => {
          const share = totalTalk > 0 ? Math.round((s.talk_time_sec / totalTalk) * 100) : 0;
          const isEditing = editingId === s.id;

          return (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface px-2.5 py-1.5"
            >
              {isEditing ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(s, draft);
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    maxLength={80}
                    placeholder={`Speaker ${s.id}`}
                    aria-label={`Name for speaker ${s.id}`}
                    className="w-28 bg-transparent text-sm text-foreground focus:outline-none"
                  />
                  <button
                    type="submit"
                    aria-label="Save name"
                    className="text-muted-foreground transition-colors hover:text-success"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel"
                    onClick={() => setEditingId(null)}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(s)}
                  className="group flex items-center gap-1.5 text-left"
                  aria-label={`Rename ${s.label}`}
                >
                  <span className="text-sm text-foreground">{s.label}</span>
                  <Pencil className="h-3 w-3 text-muted-foreground/50 transition-colors group-hover:text-brand" />
                </button>
              )}
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatTalkTime(s.talk_time_sec)} · {share}%
              </span>
            </div>
          );
        })}
      </div>

      {editingId && available.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground/70">Mentioned in this meeting:</span>
          {available.map((name) => {
            const speaker = speakers.find((s) => s.id === editingId);
            return (
              <button
                key={name}
                type="button"
                // onMouseDown, not onClick: the name input is focused, and a
                // click would blur it before the handler ran on some browsers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (speaker) void save(speaker, name);
                }}
                className="rounded-full border border-border/60 bg-surface px-2 py-0.5 text-[11px] text-foreground transition-colors hover:border-brand hover:text-brand"
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-2.5 text-[11px] text-muted-foreground/70">
        Names apply to this meeting only — voice labels are assigned per recording.
      </p>
    </div>
  );
}
