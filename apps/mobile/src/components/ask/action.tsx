import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useQueryClient } from "@tanstack/react-query";
// The subpath, not the barrel: `@echobrief/shared` re-exports the Zod schema
// file, and pulling Zod into the app bundle is a trade this app has already
// declined once (see lib/audio/segment-upload.ts). This module has no imports.
import type { AskActionCandidate, AskActionPlan } from "@echobrief/shared/ask-actions";

import { useToggleActionItem } from "@/lib/api/action-items";
import {
  DELETE_UNDO_MS,
  scheduleMeetingDelete,
  undoMeetingDelete,
  useMeetingDeletePending,
  useRenameMeeting,
} from "@/lib/api/meetings";
import { formatListDate } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { Eyebrow } from "./eyebrow";
import { usePressScale } from "./press-scale";
import { PillButton } from "./question";

/**
 * What an instruction looks like on the Ask screen.
 *
 * THE ONE THING THIS FILE HAS TO GET RIGHT is that a reader can never mistake a
 * proposal for a receipt. Three signals carry that, and they are redundant on
 * purpose — any one of them alone is something a distracted person misses:
 *
 *   TENSE.  A proposal is written in the future ("This will delete…"); a
 *           receipt is written in the past ("Deleted…"). This is the signal that
 *           survives being read aloud by VoiceOver, where colour does not exist.
 *   COLOUR. Only a proposal and a failure wear the danger palette. A receipt is
 *           an ordinary surface card, because by then nothing is wrong.
 *   CONTROLS. A proposal's buttons are the decision itself ("Delete recording" /
 *           "Keep it"). A receipt's single button is the way back ("Undo").
 *
 * NOTHING IS EXECUTED BY THE SERVER. Every write here goes through the same
 * hooks the rest of the app uses — useToggleActionItem, useRenameMeeting,
 * scheduleMeetingDelete — so an action taken from Ask hits the identical
 * endpoint, optimistic update, rollback and cache invalidation as the same
 * action taken from its own screen. There is no second implementation of
 * "delete a meeting" to drift out of sync, and the meetings list cannot be left
 * stale by a mutation it never saw.
 */

// ----------------------------------------------------------------------------
// Shared frame
// ----------------------------------------------------------------------------

type CardTone = "neutral" | "danger";

function ActionShell({
  tone,
  eyebrow,
  alert = false,
  children,
}: {
  tone: CardTone;
  eyebrow: string;
  /** Destructive proposals and failures interrupt; receipts do not. */
  alert?: boolean;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(200)}
      className={`gap-3 rounded-card border p-4 ${
        tone === "danger" ? "border-danger/40 bg-danger/10" : "border-edge bg-surface"
      }`}
      style={{ borderCurve: "continuous" }}
      accessibilityRole={alert ? "alert" : undefined}
      accessibilityLiveRegion={alert ? "assertive" : "polite"}
    >
      <Eyebrow tone={tone === "danger" ? "danger" : "tertiary"}>{eyebrow}</Eyebrow>
      {children}
    </Animated.View>
  );
}

/**
 * The thing being acted on, rendered so it can be recognised rather than merely
 * identified. Two lines: what it is, and enough context to be sure it is the
 * right one — which for a recording means the day and the length, and for a
 * task means which conversation it came out of.
 */
function TargetLine({ candidate }: { candidate: AskActionCandidate }) {
  const when = formatListDate(candidate.occurred_at);
  const context = [candidate.detail, when].filter((part) => part && part.length > 0).join(" · ");

  return (
    <View className="gap-1">
      <Text className="text-[15px] font-semibold leading-[20px] text-label">{candidate.label}</Text>
      {context ? (
        <Text className="text-[13px] leading-[18px] text-label-secondary">{context}</Text>
      ) : null}
    </View>
  );
}

/** One row of a "which did you mean" list. */
function CandidateRow({
  candidate,
  onPress,
}: {
  candidate: AskActionCandidate;
  onPress: () => void;
}) {
  const press = usePressScale();
  const when = formatListDate(candidate.occurred_at);
  const context = [candidate.detail, when].filter((part) => part && part.length > 0).join(" · ");

  return (
    <Animated.View style={press.style}>
      <Pressable
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          haptics.select();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={candidate.label}
        accessibilityHint={context ? `From ${context}` : undefined}
        className="min-h-[44px] justify-center gap-1 rounded-control border border-edge bg-background px-3.5 py-2.5 active:bg-elevated"
        style={{ borderCurve: "continuous" }}
      >
        <Text className="text-[15px] leading-[20px] text-label">{candidate.label}</Text>
        {context ? (
          <Text className="text-[13px] leading-[18px] text-label-tertiary">{context}</Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function Body({ children }: { children: string }) {
  return <Text className="text-[15px] leading-[21px] text-label-secondary">{children}</Text>;
}

// ----------------------------------------------------------------------------
// Reversible actions — run on arrival, report afterwards
// ----------------------------------------------------------------------------

/**
 * Where a reversible action is in its life.
 *
 * "running" exists because these are network calls and a card that shows the
 * finished state before the server has agreed is lying for as long as the
 * request takes. "failed" is a real destination, not a rollback to nothing: the
 * underlying hooks already roll the cache back and raise an alert, so the card's
 * job is to stop claiming the thing happened.
 */
type RunStage = "running" | "done" | "undoing" | "undone" | "failed";

function useRunStage() {
  const [stage, setStage] = useState<RunStage>("running");
  /**
   * Guards the fire-on-mount so it happens exactly once. An effect that writes
   * to the database must never rely on a dependency array alone — a remount
   * under StrictMode, or a parent re-render that swaps this subtree, would
   * otherwise issue the mutation a second time.
   */
  const fired = useRef(false);
  return { stage, setStage, fired };
}

function CompleteCard({ target }: { target: AskActionCandidate }) {
  const toggle = useToggleActionItem();
  const { stage, setStage, fired } = useRunStage();

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    toggle
      .mutateAsync({ id: target.id, completed: true })
      .then(() => {
        haptics.success();
        setStage("done");
      })
      .catch(() => {
        // The hook has already rolled the list back and said so in an alert.
        setStage("failed");
      });
  }, [fired, setStage, target.id, toggle]);

  const undo = useCallback(() => {
    setStage("undoing");
    toggle
      .mutateAsync({ id: target.id, completed: false })
      .then(() => setStage("undone"))
      // Re-completing is idempotent, so landing back on "done" is honest:
      // the item is still checked off and the pill still offers the way out.
      .catch(() => setStage("done"));
  }, [setStage, target.id, toggle]);

  if (stage === "failed") {
    return (
      <ActionShell tone="danger" eyebrow="Could not check that off" alert>
        <TargetLine candidate={target} />
        <Body>It is still open. Nothing else was changed.</Body>
      </ActionShell>
    );
  }

  if (stage === "undone") {
    return (
      <ActionShell tone="neutral" eyebrow="Put back">
        <TargetLine candidate={target} />
        <Body>This is open again.</Body>
      </ActionShell>
    );
  }

  return (
    <ActionShell tone="neutral" eyebrow={stage === "done" ? "Done" : "Checking off"}>
      <TargetLine candidate={target} />
      <Body>
        {stage === "done"
          ? "Checked off in your actions."
          : "Marking this as done in your actions."}
      </Body>
      {stage === "done" || stage === "undoing" ? (
        <PillButton
          label={stage === "undoing" ? "Putting it back…" : "Undo"}
          disabled={stage === "undoing"}
          onPress={undo}
          accessibilityHint="Marks this action item as open again"
        />
      ) : null}
    </ActionShell>
  );
}

function RenameCard({
  target,
  newTitle,
  previousTitle,
}: {
  target: AskActionCandidate;
  newTitle: string;
  previousTitle: string;
}) {
  const rename = useRenameMeeting(target.id);
  const { stage, setStage, fired } = useRunStage();

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    rename
      .mutateAsync(newTitle)
      .then(() => {
        haptics.success();
        setStage("done");
      })
      .catch(() => setStage("failed"));
  }, [fired, newTitle, rename, setStage]);

  const undo = useCallback(() => {
    setStage("undoing");
    rename
      .mutateAsync(previousTitle)
      .then(() => setStage("undone"))
      .catch(() => setStage("done"));
  }, [previousTitle, rename, setStage]);

  if (stage === "failed") {
    return (
      <ActionShell tone="danger" eyebrow="Could not rename that" alert>
        <Body>{`It is still called "${previousTitle}".`}</Body>
      </ActionShell>
    );
  }

  if (stage === "undone") {
    return (
      <ActionShell tone="neutral" eyebrow="Put back">
        <Body>{`Back to "${previousTitle}".`}</Body>
      </ActionShell>
    );
  }

  return (
    <ActionShell tone="neutral" eyebrow={stage === "done" ? "Renamed" : "Renaming"}>
      <TargetLine candidate={{ ...target, label: stage === "done" ? newTitle : previousTitle }} />
      <Body>
        {stage === "done" ? `Was "${previousTitle}".` : `Changing the name to "${newTitle}".`}
      </Body>
      {stage === "done" || stage === "undoing" ? (
        <PillButton
          label={stage === "undoing" ? "Putting it back…" : "Undo"}
          disabled={stage === "undoing"}
          onPress={undo}
          accessibilityHint={`Restores the name "${previousTitle}"`}
        />
      ) : null}
    </ActionShell>
  );
}

// ----------------------------------------------------------------------------
// Irreversible action — propose, wait for a tap, then report
// ----------------------------------------------------------------------------

type DeleteStage = "proposed" | "kept" | "deleting" | "undone";

/**
 * The only card in Ask that does nothing until it is touched.
 *
 * The proposal names the recording, its day and its length, and says in plain
 * words what disappears with it — not "this action cannot be undone", which
 * tells the reader nothing about what they are weighing. Someone who asked to
 * delete "the mic test" and is looking at a 42-minute recording from Tuesday
 * needs to notice that in the half second before their thumb lands, and the only
 * thing that lets them notice is being told which recording it is.
 *
 * On confirmation this goes through `scheduleMeetingDelete` rather than firing
 * the DELETE itself, which buys the same five-second window the meetings list
 * has: for that window nothing has been sent, so the undo is real rather than a
 * re-creation from cache. That matters more here than it does on the list — on
 * the list the user swiped a specific row, and here they described one.
 */
function ConfirmDeleteCard({ target }: { target: AskActionCandidate }) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<DeleteStage>("proposed");
  const pending = useMeetingDeletePending(target.id);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (stage !== "deleting" || !pending) {
      setRemaining(0);
      return;
    }

    const deadline = Date.now() + DELETE_UNDO_MS;
    setRemaining(Math.ceil(DELETE_UNDO_MS / 1000));

    // Ticked against a fixed deadline rather than decremented, for the reason
    // the failure card spells out: a decrementing counter drifts by however long
    // the app spent in the background and keeps counting past the window.
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 500);
    return () => clearInterval(id);
  }, [pending, stage]);

  const when = formatListDate(target.occurred_at);
  const described = [target.detail, when].filter((p) => p && p.length > 0).join(", ");

  if (stage === "kept") {
    return (
      <ActionShell tone="neutral" eyebrow="Kept">
        <TargetLine candidate={target} />
        <Body>Nothing was deleted.</Body>
      </ActionShell>
    );
  }

  if (stage === "undone") {
    return (
      <ActionShell tone="neutral" eyebrow="Kept">
        <TargetLine candidate={target} />
        <Body>The delete was stopped before it was sent. This recording is untouched.</Body>
      </ActionShell>
    );
  }

  if (stage === "deleting") {
    /**
     * `pending` is true for the whole undo window and false once the request
     * has been committed, which is exactly the condition for offering an undo.
     * It reads true on the very first render after the tap because
     * scheduleMeetingDelete writes the registry synchronously, before setStage
     * queues this render — so there is no frame in which this claims the
     * recording is already gone.
     */
    return (
      <ActionShell tone="neutral" eyebrow={pending ? "Deleting" : "Deleted"}>
        <TargetLine candidate={target} />
        <Body>
          {pending
            ? "This is about to be deleted. There is still time to stop it."
            : "The recording, its transcript and its summary are gone."}
        </Body>
        {pending ? (
          <PillButton
            label={remaining > 0 ? `Undo (${remaining})` : "Undo"}
            onPress={() => {
              undoMeetingDelete(target.id);
              setStage("undone");
            }}
            accessibilityHint="Stops the deletion before it is sent"
          />
        ) : null}
      </ActionShell>
    );
  }

  return (
    <ActionShell tone="danger" eyebrow="Confirm — nothing has happened yet" alert>
      <TargetLine candidate={target} />
      <Body>
        {`Deleting this will destroy the recording itself, its transcript, its summary and any action items that came out of it${
          described ? ` (${described})` : ""
        }. Puffin cannot get it back.`}
      </Body>
      <View className="flex-row flex-wrap gap-2">
        <PillButton
          label="Delete recording"
          tone="danger"
          onPress={() => {
            // Registry first, stage second — see the note in the "deleting" branch.
            scheduleMeetingDelete(target.id, target.label, queryClient);
            setStage("deleting");
          }}
          accessibilityHint="Permanently deletes this recording after a short undo window"
        />
        <PillButton
          label="Keep it"
          onPress={() => setStage("kept")}
          accessibilityHint="Dismisses this without deleting anything"
        />
      </View>
    </ActionShell>
  );
}

// ----------------------------------------------------------------------------
// Ambiguity and dead ends
// ----------------------------------------------------------------------------

const BLOCKED_COPY: Record<string, string> = {
  complete_action_item_not_found: "No open action item matches that. Nothing was changed.",
  complete_action_item_already_done: "That one is already checked off.",
  complete_action_item_nothing_to_act_on: "You have no open action items right now.",
  rename_meeting_not_found: "No recording matches that. Nothing was renamed.",
  rename_meeting_missing_title: 'Say what to call it — try "rename it to Q3 planning".',
  rename_meeting_nothing_to_act_on: "There are no recordings here yet.",
  delete_meeting_not_found: "No recording matches that. Nothing was deleted.",
  delete_meeting_nothing_to_act_on: "There are no recordings here yet.",
};

function BlockedCard({ plan }: { plan: Extract<AskActionPlan, { outcome: "blocked" }> }) {
  const copy =
    BLOCKED_COPY[`${plan.action}_${plan.reason}`] ?? "Nothing matched that, so nothing changed.";

  return (
    <ActionShell tone="neutral" eyebrow="Nothing to do">
      {plan.hint.length > 0 ? (
        <Text className="text-[15px] font-semibold leading-[20px] text-label">
          {`You said "${plan.hint}"`}
        </Text>
      ) : null}
      <Body>{copy}</Body>
    </ActionShell>
  );
}

/**
 * More than one thing fits, so the app asks.
 *
 * Tapping a row does not go back through the model: the plan already carries the
 * verb and, for a rename, the new name, so the choice is the only thing that was
 * missing. A destructive verb still lands on the confirm card afterwards rather
 * than executing — picking which recording is not the same as agreeing to lose
 * it.
 */
function ClarifyCard({
  plan,
  onChoose,
}: {
  plan: Extract<AskActionPlan, { outcome: "clarify" }>;
  onChoose: (plan: AskActionPlan) => void;
}) {
  const choose = useCallback(
    (candidate: AskActionCandidate) => {
      if (plan.action === "complete_action_item") {
        onChoose({ outcome: "run", action: "complete_action_item", target: candidate });
        return;
      }
      if (plan.action === "delete_meeting") {
        onChoose({ outcome: "confirm", action: "delete_meeting", target: candidate });
        return;
      }
      // A rename with no name never reaches here — planAskAction blocks it
      // before resolving a target — but the wire type allows null, so the
      // impossible case degrades to leaving the list up rather than renaming
      // something to an empty string.
      if (plan.new_title) {
        onChoose({
          outcome: "run",
          action: "rename_meeting",
          target: candidate,
          new_title: plan.new_title,
          previous_title: candidate.label,
        });
      }
    },
    [onChoose, plan.action, plan.new_title],
  );

  const verb =
    plan.action === "complete_action_item"
      ? "check off"
      : plan.action === "rename_meeting"
        ? "rename"
        : "delete";

  return (
    <ActionShell tone="neutral" eyebrow="Which one?">
      <Body>
        {plan.hint.length > 0
          ? `More than one thing matches "${plan.hint}". Pick the one to ${verb}.`
          : `Pick the one to ${verb}.`}
      </Body>
      <View className="gap-2">
        {plan.candidates.map((candidate) => (
          <CandidateRow
            key={candidate.id}
            candidate={candidate}
            onPress={() => choose(candidate)}
          />
        ))}
      </View>
    </ActionShell>
  );
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

export function AskActionCard({ plan }: { plan: AskActionPlan }) {
  /**
   * A choice made on a clarify card, which REPLACES the server's plan.
   *
   * Keyed off nothing — when a new question arrives the screen renders a new
   * plan and this component is remounted with it, so a stale choice cannot
   * survive into the next turn.
   */
  const [chosen, setChosen] = useState<AskActionPlan | null>(null);
  const effective = chosen ?? plan;

  if (effective.outcome === "blocked") return <BlockedCard plan={effective} />;
  if (effective.outcome === "clarify") {
    return <ClarifyCard plan={effective} onChoose={setChosen} />;
  }
  if (effective.outcome === "confirm") {
    return <ConfirmDeleteCard target={effective.target} />;
  }
  if (effective.action === "complete_action_item") {
    return <CompleteCard target={effective.target} />;
  }
  return (
    <RenameCard
      target={effective.target}
      newTitle={effective.new_title}
      previousTitle={effective.previous_title}
    />
  );
}
