/**
 * Summary preferences must actually reach the model.
 *
 * A settings screen is the easiest thing in an app to fake: the control moves,
 * the value persists, the screen reloads showing the new value — and nothing
 * downstream ever reads it. Every one of those steps was already verified for
 * these preferences, and none of them proves the summary changes.
 *
 * This is the step that does. `summaryDirective()` is the only thing standing
 * between a stored preference and the system prompt (see llm.ts, where its
 * output is concatenated onto MEETING_ANALYSIS_SYSTEM), so if it returns the
 * same string for two different preference sets, the setting is decorative no
 * matter how well it persists.
 */

import { describe, it, expect } from "vitest";
import { summaryDirective, type SummaryPreferences } from "../prompts";

const ALL_STYLES = ["executive", "detailed", "bullets", "decisions"] as const;
const ALL_LENGTHS = ["short", "standard", "long"] as const;
const ALL_TONES = ["neutral", "direct", "warm"] as const;

describe("summaryDirective", () => {
  it("adds nothing when the user has expressed no preference", () => {
    // The default path must stay byte-identical to the original prompt. An
    // empty preferences object appending a stray header would change every
    // summary for every user who never opened the settings screen.
    expect(summaryDirective(null)).toBe("");
    expect(summaryDirective(undefined)).toBe("");
    expect(summaryDirective({})).toBe("");
  });

  it("produces a DISTINCT directive for every style", () => {
    const seen = new Map<string, string>();
    for (const style of ALL_STYLES) {
      const out = summaryDirective({ style });
      expect(out, `style '${style}' produced no directive`).not.toBe("");
      expect(out).toContain("STYLE:");
      // The real failure mode: two options that read differently in the UI and
      // send the model the same instruction.
      for (const [other, prior] of seen) {
        expect(out, `styles '${style}' and '${other}' are indistinguishable`).not.toBe(prior);
      }
      seen.set(style, out);
    }
    expect(seen.size).toBe(ALL_STYLES.length);
  });

  it("produces a DISTINCT directive for every length", () => {
    const outputs = ALL_LENGTHS.map((length) => summaryDirective({ length }));
    outputs.forEach((out, i) => {
      expect(out, `length '${ALL_LENGTHS[i]}' produced no directive`).toContain("LENGTH:");
    });
    expect(new Set(outputs).size).toBe(ALL_LENGTHS.length);
  });

  it("produces a DISTINCT directive for every tone", () => {
    const outputs = ALL_TONES.map((tone) => summaryDirective({ tone }));
    outputs.forEach((out, i) => {
      expect(out, `tone '${ALL_TONES[i]}' produced no directive`).toContain("TONE:");
    });
    expect(new Set(outputs).size).toBe(ALL_TONES.length);
  });

  it("combines independent choices rather than letting one win", () => {
    const prefs: SummaryPreferences = { style: "bullets", length: "short", tone: "direct" };
    const out = summaryDirective(prefs);

    expect(out).toContain("STYLE:");
    expect(out).toContain("LENGTH:");
    expect(out).toContain("TONE:");

    // Each choice must survive alongside the others — a naive implementation
    // that returns early after the first match would pass all three tests above
    // and still drop two of the user's three settings here.
    expect(out).toContain(summaryDirective({ style: "bullets" }).split("STYLE:")[1]!.trim());
    expect(out).toContain(summaryDirective({ tone: "direct" }).split("TONE:")[1]!.trim());
  });

  it("instructs an empty array when action items are turned off", () => {
    const off = summaryDirective({ detectActionItems: false });
    expect(off).toContain("ACTION ITEMS:");
    expect(off).toContain("empty action_items array");

    // Deliberately silent when ON. Extraction is the default behaviour, so
    // restating it only adds a line the model must weigh against the detailed
    // extraction rules already in the system prompt.
    expect(summaryDirective({ detectActionItems: true })).toBe("");
  });

  it("keeps the anti-fabrication rule above every formatting preference", () => {
    // The one thing a preference must never be able to override. "LENGTH: long"
    // plus a two-minute conversation is exactly the setup where a model pads —
    // inventing a decision to fill the space it was told to fill.
    const out = summaryDirective({ length: "long", style: "detailed" });
    expect(out).toMatch(/never inventing content/i);
    expect(out).toMatch(/no formatting preference justifies/i);
  });

  it("does not smuggle transcript-adjacent instructions into the user message", () => {
    // Directives are appended to the SYSTEM prompt. The transcript is untrusted
    // input wrapped in tags precisely so it cannot issue instructions, and
    // putting formatting rules beside it would blur the boundary the injection
    // defences rely on. Asserted here as a shape check: the directive block must
    // be self-contained and must not open a transcript tag.
    const out = summaryDirective({ style: "executive", length: "long", tone: "warm" });
    expect(out).not.toContain("<transcript>");
    expect(out).not.toContain("</transcript>");
  });
});
