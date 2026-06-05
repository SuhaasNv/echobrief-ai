import { OpenAI } from "openai";

// Assuming an initialized openai client might be passed in or instantiated
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key-for-types",
});

/**
 * Node 1: PII Redaction
 * Scrubs common Personally Identifiable Information like emails and phone numbers.
 */
export function redactPII(input: string): string {
  if (!input) return input;

  // Basic Regex for Emails
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
  // Basic Regex for Phone Numbers (US format approximation)
  const phoneRegex = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;

  let redacted = input.replace(emailRegex, "[REDACTED_EMAIL]");
  redacted = redacted.replace(phoneRegex, "[REDACTED_PHONE]");

  return redacted;
}

/**
 * Node 2: Prompt Injection Guard
 * Uses heuristic checks to detect common jailbreak phrases.
 */
export function checkPromptInjection(input: string): boolean {
  if (!input) return false;

  const injectionKeywords = [
    "ignore all previous instructions",
    "system prompt",
    "you are now",
    "jailbreak",
    "bypass",
    "developer mode",
    "do anything now",
    "DAN",
  ];

  const lowerInput = input.toLowerCase();
  for (const keyword of injectionKeywords) {
    if (lowerInput.includes(keyword)) {
      return true; // Detected potential injection
    }
  }

  return false;
}

/**
 * Node 3: Toxicity and Moderation
 * Calls OpenAI's Moderation API to ensure input/output is safe.
 */
export async function checkToxicity(
  input: string,
): Promise<{ isSafe: boolean; categories?: string[] }> {
  try {
    const response = await openai.moderations.create({
      input: input,
    });

    const results = response.results[0];

    if (results.flagged) {
      const flaggedCategories = Object.entries(results.categories)
        .filter(([_, value]) => value === true)
        .map(([key, _]) => key);

      return {
        isSafe: false,
        categories: flaggedCategories,
      };
    }

    return { isSafe: true };
  } catch (error) {
    console.error("Moderation API failed", error);
    // Fail closed or open depending on strictness - we will fail open if API fails to avoid blocking users unnecessarily
    return { isSafe: true };
  }
}

/**
 * Node 4: Hallucination Checker
 * Simple utility that could use a secondary LLM call or fact grounding to verify claims.
 */
export async function checkHallucination(claim: string, context: string): Promise<boolean> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a factual consistency checker. Your job is to verify if the 'Claim' is strictly supported by the 'Context'. Answer ONLY 'YES' or 'NO'.",
        },
        {
          role: "user",
          content: `Context: ${context}\n\nClaim: ${claim}`,
        },
      ],
      temperature: 0,
      max_tokens: 5,
    });

    const answer = response.choices[0].message.content?.trim().toUpperCase();
    return answer === "YES";
  } catch (error) {
    console.error("Hallucination check failed", error);
    // If check fails, assume it might be a hallucination for safety
    return false;
  }
}
