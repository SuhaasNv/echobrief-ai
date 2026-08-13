import { useState } from "react";
// framer-motion, not motion/react: that is what the rest of the web app imports
// (the mobile app is the one on the new package). Mixing the two ships both.
import { motion } from "framer-motion";
import { AlertTriangle, BadgeCheck, Gift, TrendingUp, Wallet } from "lucide-react";

import {
  useAdminBillingMetrics,
  useAdminSubscriptions,
  useAdminUsers,
  useGrantTier,
  useRevokeTier,
  type AdminSubscriptionRow,
} from "@/lib/api/hooks";

/**
 * Revenue and entitlement console.
 *
 * Two jobs on one screen, and they belong together: the numbers say how the
 * business is doing, and the table below says exactly who is paying and who was
 * comped. Splitting them would let the first be read without the second, which
 * is how a founder talks themselves into believing five friends on free Pro are
 * traction.
 *
 * The design rule throughout: **never show a number that flatters**. Comped
 * accounts are counted separately from paying ones, Apple's cut is subtracted
 * before the headline net, and transcription cost sits next to revenue rather
 * than on another screen — because a $9 plan on a per-minute API can be
 * gross-margin-negative while MRR is still going up.
 */

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** A tile in the money grid. `tone` marks a figure that can legitimately be bad. */
function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number | undefined;
  sub?: string | null;
  icon: typeof Wallet;
  tone?: "neutral" | "good" | "bad";
}) {
  const valueTone =
    tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-foreground";
  return (
    <div className="bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <p className={`mt-3 font-mono text-3xl font-semibold tracking-tight ${valueTone}`}>
        {value ?? "—"}
      </p>
      {sub && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * Grant / revoke, with the reason required rather than optional.
 *
 * An entitlement nobody can explain later is indistinguishable from a bug, and
 * the first time you see `pro` on an account you do not recognise you will want
 * to know who did it and why. The field is small; the alternative is archaeology.
 */
function GrantPanel() {
  const users = useAdminUsers();
  const grant = useGrantTier();
  const revoke = useRevokeTier();

  const [userId, setUserId] = useState("");
  const [tier, setTier] = useState("pro");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const busy = grant.isPending || revoke.isPending;
  const canSubmit = userId !== "" && reason.trim().length >= 3 && !busy;

  /**
   * Server errors are surfaced verbatim.
   *
   * The two 409s this endpoint returns are the useful ones — "they have a live
   * App Store subscription" and "Apple bills this, refund it there instead" —
   * and each explains what to do next. Replacing them with "Something went
   * wrong" would throw away the only part worth reading.
   */
  function describe(err: unknown): string {
    if (err && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return "Request failed.";
  }

  return (
    <section>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Grant or revoke
      </p>

      <div className="mt-3 rounded-md border border-border/70 bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <label className="block">
            <span className="text-xs text-muted-foreground">User</span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="mt-1 w-full rounded border border-border/70 bg-background px-2 py-1.5 font-mono text-sm"
            >
              <option value="">Select a user…</option>
              {users.data?.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                  {u.tier && u.tier !== "free" ? ` — ${u.tier}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground">Tier</span>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="mt-1 w-full rounded border border-border/70 bg-background px-2 py-1.5 font-mono text-sm"
            >
              {/* Only what is sold. student and team still exist server-side
                  and any account already on one keeps working, but offering
                  them here would let an admin put someone on a plan the product
                  cannot deliver — team has no team. */}
              <option value="pro">pro</option>
              <option value="free">free</option>
            </select>
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-xs text-muted-foreground">Reason (required)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Friend testing the app"
            className="mt-1 w-full rounded border border-border/70 bg-background px-2 py-1.5 font-mono text-sm"
          />
        </label>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              setNote(null);
              grant.mutate(
                { user_id: userId, tier, reason: reason.trim() },
                {
                  onSuccess: (r) => {
                    setNote({ kind: "ok", text: `${r.email} is now ${r.tier}.` });
                    setReason("");
                  },
                  onError: (e) => setNote({ kind: "err", text: describe(e) }),
                },
              );
            }}
            className="rounded bg-foreground px-3 py-1.5 font-mono text-xs font-medium text-background disabled:opacity-40"
          >
            {grant.isPending ? "Granting…" : "Grant"}
          </button>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              setNote(null);
              revoke.mutate(
                { user_id: userId, reason: reason.trim() },
                {
                  onSuccess: () => {
                    setNote({ kind: "ok", text: "Reverted to free. No data was deleted." });
                    setReason("");
                  },
                  onError: (e) => setNote({ kind: "err", text: describe(e) }),
                },
              );
            }}
            className="rounded border border-red-500/40 px-3 py-1.5 font-mono text-xs font-medium text-red-400 disabled:opacity-40"
          >
            {revoke.isPending ? "Revoking…" : "Revoke"}
          </button>

          {note && (
            <p
              className={`font-mono text-[11px] ${
                note.kind === "ok" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {note.text}
            </p>
          )}
        </div>

        <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Revoking never deletes recordings — retention reverts going forward and everything already
          captured stays. Subscriptions billed by Apple cannot be changed here; refund them in App
          Store Connect and the webhook will downgrade the account.
        </p>
      </div>
    </section>
  );
}

function SubscriptionTable({ rows }: { rows: AdminSubscriptionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border/70 bg-surface p-8 text-center">
        <p className="font-mono text-xs text-muted-foreground">No paid or comped accounts yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/70">
      <table className="w-full min-w-[720px] text-left">
        <thead className="bg-surface/60">
          <tr className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <th className="px-4 py-2 font-normal">Account</th>
            <th className="px-4 py-2 font-normal">Tier</th>
            <th className="px-4 py-2 font-normal">Source</th>
            <th className="px-4 py-2 font-normal">Renews</th>
            <th className="px-4 py-2 font-normal">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.user_id} className="border-t border-border/50 bg-surface">
              <td className="px-4 py-2.5 font-mono text-xs">{s.email}</td>
              <td className="px-4 py-2.5">
                <span className="font-mono text-xs">{s.tier}</span>
                {/* Status only when it is NOT the ordinary case. A row reading
                    "active" on every line is noise that hides the one row that
                    says "grace". */}
                {s.status !== "active" && (
                  <span className="ml-2 font-mono text-[10px] text-amber-400">{s.status}</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={`font-mono text-[10px] ${
                    s.provider === "apple" ? "text-emerald-400" : "text-muted-foreground"
                  }`}
                >
                  {s.provider === "apple"
                    ? "App Store"
                    : s.provider === "manual"
                      ? "Comped"
                      : s.provider}
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                {s.current_period_end
                  ? new Date(s.current_period_end).toLocaleDateString()
                  : s.provider === "manual"
                    ? "Open-ended"
                    : "—"}
                {!s.auto_renew && s.provider === "apple" && (
                  <span className="ml-2 text-amber-400">no renew</span>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                {s.granted_reason ?? "—"}
                {s.granted_by_email && (
                  <span className="ml-1 opacity-60">· {s.granted_by_email}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RevenueSection() {
  const metrics = useAdminBillingMetrics();
  const subs = useAdminSubscriptions();

  const m = metrics.data;
  const margin = m?.revenue.margin_usd ?? 0;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Revenue
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            net assumes Apple Small Business Program (15%)
          </p>
        </div>

        <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-border/70 bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "MRR",
              value: m ? money(m.revenue.mrr_usd) : undefined,
              sub: m ? `${money(m.revenue.arr_usd)} ARR` : null,
              icon: TrendingUp,
              tone: "neutral" as const,
            },
            {
              label: "Net after Apple",
              value: m ? money(m.revenue.net_after_apple_usd) : undefined,
              sub: "15% store commission",
              icon: Wallet,
              tone: "neutral" as const,
            },
            {
              label: "Transcription cost",
              value: m ? money(m.revenue.cost_usd) : undefined,
              sub: m ? `${m.usage_this_period.transcription_minutes} min this period` : null,
              icon: AlertTriangle,
              tone: "neutral" as const,
            },
            {
              label: "Margin",
              value: m ? money(margin) : undefined,
              sub: "net revenue − transcription",
              icon: TrendingUp,
              // The one figure allowed to be red. A negative margin on a
              // per-minute API is the failure mode this whole panel exists to
              // make visible early.
              tone: margin < 0 ? ("bad" as const) : ("good" as const),
            },
          ].map((k, i) => (
            <motion.div
              key={k.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Stat {...k} />
            </motion.div>
          ))}
        </div>
      </section>

      <section>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Accounts
        </p>
        <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-border/70 bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Paying"
            value={m?.subscriptions.paying}
            sub="App Store subscriptions"
            icon={BadgeCheck}
            tone="good"
          />
          {/* Kept visually distinct from Paying, and never added to it. Comped
              accounts are a cost, not revenue — folding them together is the
              single easiest way to lie to yourself about traction. */}
          <Stat
            label="Comped"
            value={m?.subscriptions.comped}
            sub="granted, not sold"
            icon={Gift}
          />
          <Stat
            label="Cancelling"
            value={m?.subscriptions.cancelling}
            sub="access until period end"
            icon={AlertTriangle}
            tone={m && m.subscriptions.cancelling > 0 ? "bad" : "neutral"}
          />
          <Stat
            label="Billing retry"
            value={m?.subscriptions.grace}
            sub="in Apple grace window"
            icon={AlertTriangle}
          />
        </div>
      </section>

      <GrantPanel />

      <section>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Paid and comped accounts
        </p>
        <div className="mt-3">
          {subs.isLoading ? (
            <div className="rounded-md border border-border/70 bg-surface p-8">
              <div className="h-4 w-40 animate-pulse rounded bg-muted/40" />
            </div>
          ) : (
            <SubscriptionTable rows={subs.data?.subscriptions ?? []} />
          )}
        </div>
      </section>
    </div>
  );
}
