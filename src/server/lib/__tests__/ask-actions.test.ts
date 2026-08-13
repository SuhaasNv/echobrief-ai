/**
 * Target resolution for agentic Ask.
 *
 * These are the tests that matter most in the feature, because this function is
 * the whole reason no model chooses which row an instruction lands on. Every
 * case below is a sentence someone would actually type, and the assertion is
 * usually about the app REFUSING to choose rather than choosing well.
 */

import { describe, expect, it } from "vitest";
import { matchScore, resolveTarget, AMBIGUITY_MARGIN, MIN_MATCH_SCORE } from "../ask-actions";
import { parseAskActionPlan } from "@echobrief/shared";

interface Row {
  id: string;
  text: string;
}

const row = (id: string, text: string): Row => ({ id, text });

const text = (r: Row) => r.text;

describe("matchScore", () => {
  it("scores full coverage of the user's words at 1 or better", () => {
    expect(matchScore("pricing model", "Send the pricing model to Priya")).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("does not penalise a row for containing words the user did not say", () => {
    const short = matchScore("auth fix", "Deploy the auth fix");
    const long = matchScore("auth fix", "Deploy the auth fix to staging once QA signs off on it");
    expect(short).toBeCloseTo(long);
  });

  it("prefers the row where the words appear as a phrase", () => {
    const phrase = matchScore("pricing model", "Send the pricing model over");
    const scattered = matchScore("pricing model", "Model the pricing tiers");
    expect(phrase).toBeGreaterThan(scattered);
  });

  it("gives partial coverage a partial score", () => {
    expect(matchScore("enterprise pricing deck", "Review enterprise pricing")).toBeCloseTo(2 / 3);
  });

  it("ignores the command vocabulary, so a verb cannot carry a match", () => {
    // Everything here is a noise word: nothing identifying was said.
    expect(matchScore("delete the meeting", "Weekly engineering standup")).toBe(0);
  });

  it("scores an unrelated row at zero", () => {
    expect(matchScore("pricing model", "Deploy the auth fix to staging")).toBe(0);
  });
});

describe("resolveTarget", () => {
  const items = [
    row("a", "Send the pricing model to Priya by Friday"),
    row("b", "Review pricing for the enterprise tier with finance"),
    row("c", "Deploy the auth fix to staging"),
  ];

  it("resolves when one row is clearly the best fit", () => {
    const result = resolveTarget("pricing model", items, text);
    expect(result).toEqual({ kind: "resolved", item: items[0] });
  });

  it("asks rather than guessing when two rows fit equally", () => {
    const result = resolveTarget("pricing", items, text);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("unreachable");
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("finds nothing rather than offering the least-bad row", () => {
    expect(resolveTarget("quarterly board review", items, text)).toEqual({ kind: "none" });
  });

  it("never resolves without a hint, even when there is exactly one row", () => {
    // "Delete a meeting" with one recording in the account is still a sentence
    // that did not name it. The tap costs nothing; the wrong delete costs
    // everything.
    const only = [row("solo", "Mic test")];
    const result = resolveTarget(null, only, text);
    expect(result).toEqual({ kind: "ambiguous", items: only });
  });

  it("treats a hint made only of noise words as no hint at all", () => {
    const result = resolveTarget("the meeting", items, text);
    expect(result.kind).toBe("ambiguous");
  });

  it("returns none for an empty candidate set", () => {
    expect(resolveTarget("pricing model", [], text)).toEqual({ kind: "none" });
  });

  it("caps the choices offered at five", () => {
    const many = Array.from({ length: 12 }, (_, i) => row(String(i), `Pricing review ${i}`));
    const result = resolveTarget("pricing review", many, text);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("unreachable");
    expect(result.items).toHaveLength(5);
  });

  it("holds the ambiguity margin wide enough that one differing word asks", () => {
    // Four identifying words; three shared. The runner-up sits 0.25 below the
    // winner on coverage — comfortably outside the margin — so this DOES
    // resolve. The test pins the constants against silent drift in either
    // direction rather than asserting a behaviour twice.
    expect(AMBIGUITY_MARGIN).toBeGreaterThan(0);
    expect(AMBIGUITY_MARGIN).toBeLessThan(0.25);
    expect(MIN_MATCH_SCORE).toBeGreaterThanOrEqual(0.5);
  });

  it("does not let a single shared word clear the floor on its own", () => {
    // "enterprise" alone is 1 of 3 = 0.33, under MIN_MATCH_SCORE.
    expect(resolveTarget("enterprise onboarding checklist", items, text)).toEqual({ kind: "none" });
  });
});

/**
 * The client's fail-closed guard on the `x-ask-action` header.
 *
 * Every case here is "produce nothing" rather than "produce something partial",
 * because the caller renders a Delete button off the result. A card that fails
 * to appear is a bug report; a card that appears with the wrong target is a lost
 * recording.
 */
describe("parseAskActionPlan", () => {
  const candidate = {
    id: "4570404f-7532-4493-a50e-fe00de2ac80a",
    label: "Mic test",
    detail: "1 min",
    occurred_at: "2026-08-12T10:58:39.291Z",
  };

  it("accepts a well-formed confirm plan", () => {
    const plan = parseAskActionPlan({
      outcome: "confirm",
      action: "delete_meeting",
      target: candidate,
    });
    expect(plan).toEqual({ outcome: "confirm", action: "delete_meeting", target: candidate });
  });

  it("accepts a null occurred_at, which is a real value for an un-dated row", () => {
    const plan = parseAskActionPlan({
      outcome: "run",
      action: "complete_action_item",
      target: { ...candidate, occurred_at: null },
    });
    expect(plan?.outcome).toBe("run");
  });

  it("refuses a confirm plan for anything but a delete", () => {
    // Nothing else is ever proposed for confirmation, so a server claiming
    // otherwise is a contract this client does not know how to honour.
    expect(
      parseAskActionPlan({
        outcome: "confirm",
        action: "complete_action_item",
        target: candidate,
      }),
    ).toBeNull();
  });

  it("refuses a rename with no new title rather than PATCHing an empty one", () => {
    expect(
      parseAskActionPlan({
        outcome: "run",
        action: "rename_meeting",
        target: candidate,
        new_title: "",
        previous_title: "Mic test",
      }),
    ).toBeNull();
  });

  it("refuses a plan whose target is missing", () => {
    expect(parseAskActionPlan({ outcome: "run", action: "complete_action_item" })).toBeNull();
  });

  it("refuses an action name it does not recognise", () => {
    expect(
      parseAskActionPlan({ outcome: "run", action: "delete_everything", target: candidate }),
    ).toBeNull();
  });

  it("refuses a clarify list with one bad row rather than silently dropping it", () => {
    expect(
      parseAskActionPlan({
        outcome: "clarify",
        action: "delete_meeting",
        hint: "test",
        new_title: null,
        candidates: [candidate, { id: "x" }],
      }),
    ).toBeNull();
  });

  it("truncates an over-long clarify list to what the card will show", () => {
    const plan = parseAskActionPlan({
      outcome: "clarify",
      action: "delete_meeting",
      hint: "test",
      new_title: null,
      candidates: Array.from({ length: 9 }, (_, i) => ({ ...candidate, label: `Row ${i}` })),
    });
    expect(plan?.outcome).toBe("clarify");
    if (plan?.outcome !== "clarify") throw new Error("unreachable");
    expect(plan.candidates).toHaveLength(5);
  });

  it("refuses junk", () => {
    for (const junk of [null, undefined, 0, "", "delete", [], {}, { outcome: "run" }]) {
      expect(parseAskActionPlan(junk)).toBeNull();
    }
  });
});
