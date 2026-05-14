import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileAudio, X, CheckCircle2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/app/upload")({
  head: () => ({ meta: [{ title: "Upload — EchoBrief" }] }),
  component: UploadPage,
});

type UFile = { id: number; name: string; size: string; progress: number; done: boolean };

function UploadPage() {
  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState<UFile[]>([]);

  const addDemo = useCallback(() => {
    const demos = [
      { name: "weekly-leadership.mp3", size: "32.4 MB" },
      { name: "acme-discovery.wav", size: "84.1 MB" },
    ];
    setFiles((prev) => [
      ...prev,
      ...demos.map((d, i) => ({ id: Date.now() + i, name: d.name, size: d.size, progress: 0, done: false })),
    ]);
  }, []);

  useEffect(() => {
    if (!files.some((f) => !f.done)) return;
    const t = setInterval(() => {
      setFiles((prev) =>
        prev.map((f) => {
          if (f.done) return f;
          const next = Math.min(100, f.progress + Math.random() * 18);
          return { ...f, progress: next, done: next >= 100 };
        }),
      );
    }, 350);
    return () => clearInterval(t);
  }, [files]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Upload meetings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Drop audio or video files. We'll transcribe, summarize, and index in under a minute.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addDemo(); }}
        onClick={addDemo}
        className={`group relative mt-8 cursor-pointer overflow-hidden rounded-2xl border border-dashed transition-all ${
          drag ? "border-brand/60 bg-brand/5" : "border-border bg-surface hover:bg-surface-elevated"
        }`}
      >
        <div className="absolute inset-0 bg-grid bg-grid-fade opacity-30" />
        <div className="relative flex flex-col items-center justify-center px-6 py-20 text-center">
          <motion.div
            animate={{ y: drag ? -4 : 0 }}
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-violet shadow-glow"
          >
            <UploadCloud className="h-6 w-6 text-white" />
          </motion.div>
          <p className="mt-5 text-base font-medium">Drop files to transcribe</p>
          <p className="mt-1 text-sm text-muted-foreground">or click to browse</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
            {["MP3", "WAV", "M4A", "MP4", "MOV", "Zoom"].map((t) => (
              <span key={t} className="rounded-md bg-accent px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground/70">Max 5GB per file · Encrypted in transit</p>
        </div>
      </div>

      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-xl border border-border/70 bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <p className="text-sm font-medium">Processing queue</p>
              <span className="font-mono text-[10px] text-muted-foreground">{files.length} files</span>
            </div>
            <div className="divide-y divide-border/60">
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent">
                    <FileAudio className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium">{f.name}</p>
                      <span className="font-mono text-[11px] text-muted-foreground">{f.size}</span>
                    </div>
                    {/* Waveform progress */}
                    <div className="mt-2 flex h-6 items-center gap-[2px]">
                      {Array.from({ length: 60 }).map((_, i) => {
                        const reached = (i / 60) * 100 < f.progress;
                        return (
                          <span
                            key={i}
                            className={`w-[3px] rounded-full transition-colors ${reached ? "bg-brand" : "bg-foreground/15"}`}
                            style={{ height: `${20 + Math.abs(Math.sin(i * 0.6)) * 70}%` }}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        {f.done ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3 w-3" /> Ready · summary generated
                          </span>
                        ) : f.progress < 60 ? (
                          "Uploading…"
                        ) : (
                          <span className="inline-flex items-center gap-1 text-brand">
                            <Sparkles className="h-3 w-3" /> Transcribing & summarizing…
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">{Math.round(f.progress)}%</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
