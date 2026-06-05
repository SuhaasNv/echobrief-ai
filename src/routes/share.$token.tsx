import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Clock,
  Users,
  CheckCircle2,
  Calendar,
  Sparkles,
  ArrowRight,
  Loader2,
  Lock,
} from "lucide-react";
import { formatDate, formatDuration } from "@/lib/date-utils";

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Shared Meeting — EchoBrief" },
      {
        name: "description",
        content: "View shared meeting summary, key topics, decisions, and action items.",
      },
      { property: "og:title", content: "Shared Meeting — EchoBrief" },
      {
        property: "og:description",
        content: "View shared meeting summary and insights on EchoBrief.",
      },
    ],
  }),
  component: SharePage,
});

interface SharedMeeting {
  id: string;
  title: string;
  duration_sec: number | null;
  tags: string[];
  created_at: string;
  executive: string | null;
  key_topics: string[] | null;
  decisions: string[] | null;
  open_questions: string[] | null;
  action_items: Array<{
    description: string;
    assignee_name: string | null;
    due_date: string | null;
  }>;
}

function SharePage() {
  const { token } = Route.useParams();

  const query = useQuery<SharedMeeting>({
    queryKey: ["shared-meeting", token],
    queryFn: async () => {
      console.log("[share] Fetching shared meeting with token:", token);
      const res = await fetch(`/api/v1/share/${token}`);
      console.log("[share] Response status:", res.status);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to load meeting" }));
        console.error("[share] Error loading meeting:", err);
        throw new Error(err.message || "Failed to load meeting");
      }
      const data = await res.json();
      console.log("[share] Successfully loaded meeting:", data.title);
      return data;
    },
    retry: false,
  });

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <Lock className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">Meeting not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link may have expired, been disabled, or doesn't exist.
          </p>
          <div className="mt-6">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to EchoBrief
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const meeting = query.data;

  return (
    <div className="min-h-screen bg-background">
      {/* Header with branding */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              to="/"
              className="flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
            >
              <Sparkles className="h-4 w-4" />
              EchoBrief
            </Link>
            <Link
              to="/signup"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get EchoBrief
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-4xl px-4 py-12">
        {/* Meeting header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-accent/50 px-3 py-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(meeting.created_at)}
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {meeting.title}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {meeting.duration_sec && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {formatDuration(meeting.duration_sec)}
              </span>
            )}
            {meeting.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {meeting.tags.map((tag) => (
                  <span key={tag} className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Executive Summary */}
        {meeting.executive && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-12"
          >
            <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
              <Sparkles className="h-5 w-5 text-primary" />
              Executive Summary
            </h2>
            <div className="mt-4 rounded-lg border border-border/60 bg-surface p-6">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {meeting.executive}
              </p>
            </div>
          </motion.section>
        )}

        {/* Key Topics */}
        {meeting.key_topics && meeting.key_topics.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-12"
          >
            <h2 className="text-xl font-semibold text-foreground">Key Topics</h2>
            <div className="mt-4 space-y-2">
              {meeting.key_topics.map((topic, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-surface p-4"
                >
                  <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <p className="text-sm text-foreground">{topic}</p>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* Decisions */}
        {meeting.decisions && meeting.decisions.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="mt-12"
          >
            <h2 className="text-xl font-semibold text-foreground">Decisions Made</h2>
            <div className="mt-4 space-y-2">
              {meeting.decisions.map((decision, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-surface p-4"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  <p className="text-sm text-foreground">{decision}</p>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* Action Items */}
        {meeting.action_items.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            className="mt-12"
          >
            <h2 className="text-xl font-semibold text-foreground">Action Items</h2>
            <div className="mt-4 space-y-2">
              {meeting.action_items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-surface p-4"
                >
                  <div className="mt-1 h-4 w-4 shrink-0 rounded border-2 border-muted-foreground/30" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{item.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {item.assignee_name && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {item.assignee_name}
                        </span>
                      )}
                      {item.due_date && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(item.due_date)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* Open Questions */}
        {meeting.open_questions && meeting.open_questions.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            className="mt-12"
          >
            <h2 className="text-xl font-semibold text-foreground">Open Questions</h2>
            <div className="mt-4 space-y-2">
              {meeting.open_questions.map((question, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-surface p-4"
                >
                  <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-amber-500" />
                  <p className="text-sm text-foreground">{question}</p>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* CTA Footer */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.6 }}
          className="mt-16 rounded-lg border border-border/60 bg-gradient-to-br from-primary/5 to-primary/10 p-8 text-center"
        >
          <Sparkles className="mx-auto h-8 w-8 text-primary" />
          <h3 className="mt-4 text-lg font-semibold text-foreground">
            Turn your meetings into intelligence
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload calls and meetings. Get AI summaries, action items, and instant answers across
            every conversation.
          </p>
          <div className="mt-6">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 bg-surface/50 py-8">
        <div className="mx-auto max-w-4xl px-4 text-center text-xs text-muted-foreground">
          <p>
            Powered by{" "}
            <Link to="/" className="font-medium text-foreground hover:text-primary">
              EchoBrief
            </Link>
            {" · "}
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            {" · "}
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
