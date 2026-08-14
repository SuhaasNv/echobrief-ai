/**
 * Input sanitization utilities for security.
 *
 * Protects against:
 * - Prompt injection attacks in LLM inputs
 * - XSS/HTML injection in user-generated content
 * - Token exhaustion attacks (oversized inputs)
 */

/**
 * Patterns that indicate potential prompt injection attempts.
 * These are logged and redacted when found in user input.
 *
 * NOT applied to transcripts — see sanitizeTranscript for why. Several of these
 * ("you are now", "act as a") are ordinary English and match constantly in
 * recorded speech.
 */
const SUSPICIOUS_PATTERNS = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|above|prior)\s+instructions/gi,
  /disregard\s+(all\s+)?(previous|above|prior)/gi,
  /forget\s+(everything|all)\s+(you|that)/gi,
  /new\s+instructions:/gi,

  // Role manipulation
  /you\s+are\s+now\s+(a\s+)?/gi,
  /act\s+as\s+(a\s+)?/gi,
  /pretend\s+(you\s+are|to\s+be)/gi,
  /roleplay\s+as/gi,

  // System prompt injection attempts
  /<\/?system>/gi,
  /<\/?prompt>/gi,
  /<\/?instruction>/gi,

  // Template injection patterns
  /\{\{.*system.*\}\}/gi,
  /%%.*system.*%%/gi,
  /\$\{.*system.*\}/gi,

  // Command injection attempts
  /execute\s+(the\s+following|this)\s+command/gi,
  /run\s+(the\s+following|this)\s+(code|script)/gi,
];

/**
 * Maximum allowed length for different input types.
 * Prevents token exhaustion attacks and DoS.
 */
const MAX_LENGTHS = {
  transcript: 500_000, // 500K chars ≈ 80K words ≈ 100K tokens
  title: 200, // Meeting/lecture titles
  description: 2_000, // Meeting descriptions
  chatMessage: 10_000, // User chat messages
  actionItem: 500, // Action item descriptions
  flashcardQuestion: 500, // Flashcard questions
  flashcardAnswer: 2_000, // Flashcard answers
};

export interface SanitizeOptions {
  maxLength?: number;
  logSecurityEvents?: boolean;
}

/**
 * Sanitize user-provided transcript text for LLM processing.
 *
 * Length cap ONLY — the redaction pass was removed deliberately, because it
 * corrupted the user's own words in the one place they are least replaceable.
 * It rewrote ordinary English as "[REDACTED - POLICY VIOLATION]" ("you are now
 * the lead on this", "he'll act as the tiebreaker"), and the tag-stripping
 * regex swallowed the span "<50k but >" out of "revenue <50k but >100 units".
 * The summary was then built from the mangled text, so the damage reached the
 * user's screen.
 *
 * The defence that actually holds is already in place in prompts.ts: the
 * transcript is fenced inside <transcript> XML tags and the prompt states
 * plainly that the content is USER DATA, not instructions. Injection into a
 * transcript that only ever produces a summary shown back to the person who
 * recorded it is a near-zero-impact threat; silently mangling their words is a
 * real one.
 */
export function sanitizeTranscript(text: string, options: SanitizeOptions = {}): string {
  const { maxLength = MAX_LENGTHS.transcript, logSecurityEvents = true } = options;

  // Truncate to prevent token exhaustion — the only genuine DoS vector here,
  // and the only transformation allowed to touch transcript text.
  if (text.length > maxLength) {
    if (logSecurityEvents) {
      console.warn("[SECURITY] Transcript truncated:", {
        originalLength: text.length,
        maxLength,
        truncated: text.length - maxLength,
        timestamp: new Date().toISOString(),
      });
    }
    return text.slice(0, maxLength) + "\n\n[TRUNCATED FOR LENGTH]";
  }

  return text;
}

/**
 * Characters that render as something other than themselves.
 *
 * `Cc` is C0/C1 controls, `Cf` is format characters — which is where the
 * dangerous ones live: the bidi overrides U+202A–202E and isolates U+2066–2069
 * reverse the visual order of everything after them, and the zero-width family
 * (U+200B–200D, U+FEFF) is invisible entirely.
 *
 * This matters because a title reaches the PUBLIC share page, which any
 * unauthenticated visitor can open and which carries EchoBrief branding. React
 * escapes HTML, so there is no XSS here — but React does not touch bidi, so a
 * title containing U+202E renders as text the author chose in an order the
 * stored string does not have. Spoofing a legitimate-looking heading on a page
 * that looks official is the whole attack.
 *
 * Zero-width characters have a duller second cost: they defeat the ILIKE search
 * on the meetings list, so a title carrying one silently stops being findable.
 */
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}]/gu;

/**
 * Sanitize meeting/lecture titles.
 *
 * Titles reach prompts, the meetings list, and the public share page.
 *
 * NOTE ON WHAT WAS REMOVED. This used to run `/<\/?[^>]+(>|$)/g` to strip HTML —
 * the exact regex the `sanitizeTranscript` docblock above argues against, for
 * the exact reason given there: it swallows the span between a `<` and a `>` in
 * ordinary text. "Revenue <50k but >100 units" was being STORED as "Revenue 100
 * units". That pass was removed from transcripts and missed here, and it runs on
 * the write path — including on AI-generated titles in the worker — so the
 * damage was permanent rather than display-only.
 *
 * Dropping it costs nothing in safety: every surface that renders a title does
 * so through JSX text interpolation, which HTML-escapes. The share page was
 * audited specifically for this and has no `dangerouslySetInnerHTML` on any
 * user-derived value. Angle brackets in a title are a display concern that React
 * already handles, not a sanitization concern.
 *
 * What replaces it is the thing that was actually missing: characters that lie
 * about what they are.
 */
export function sanitizeTitle(title: string): string {
  return title.replace(INVISIBLE_CHARS, "").slice(0, MAX_LENGTHS.title).trim();
}

/**
 * Sanitize meeting descriptions.
 */
export function sanitizeDescription(description: string): string {
  return description
    .replace(/<\/?[^>]+(>|$)/g, "")
    .slice(0, MAX_LENGTHS.description)
    .trim();
}

/**
 * Sanitize user chat messages before sending to LLM.
 * Similar to transcript sanitization but with different limits.
 */
export function sanitizeChatMessage(message: string): string {
  let sanitized = message;

  // Strip HTML
  sanitized = sanitized.replace(/<\/?[^>]+(>|$)/g, "");

  // Check for prompt injection
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      console.warn("[SECURITY] Suspicious pattern in chat message");
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    }
  }

  // Truncate
  if (sanitized.length > MAX_LENGTHS.chatMessage) {
    sanitized = sanitized.slice(0, MAX_LENGTHS.chatMessage);
  }

  return sanitized.trim();
}

/**
 * Sanitize action item descriptions.
 */
export function sanitizeActionItem(description: string): string {
  return description
    .replace(/<\/?[^>]+(>|$)/g, "")
    .slice(0, MAX_LENGTHS.actionItem)
    .trim();
}

/**
 * Sanitize flashcard questions and answers.
 */
export function sanitizeFlashcard(text: string, isAnswer: boolean = false): string {
  const maxLength = isAnswer ? MAX_LENGTHS.flashcardAnswer : MAX_LENGTHS.flashcardQuestion;
  return text
    .replace(/<\/?[^>]+(>|$)/g, "")
    .slice(0, maxLength)
    .trim();
}

/**
 * Check if a string contains suspicious patterns without modifying it.
 * Useful for logging/monitoring without redaction.
 */
export function containsSuspiciousPatterns(text: string): boolean {
  return SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Get a security score for input text (0-100, higher is safer).
 * Used for monitoring and alerting.
 */
export function getSecurityScore(text: string): number {
  let score = 100;

  // Deduct points for suspicious patterns
  const suspiciousCount = SUSPICIOUS_PATTERNS.filter((p) => p.test(text)).length;
  score -= suspiciousCount * 20;

  // Deduct points for excessive length
  if (text.length > MAX_LENGTHS.transcript) {
    score -= 30;
  } else if (text.length > MAX_LENGTHS.transcript * 0.8) {
    score -= 10;
  }

  // Deduct points for HTML/XML content
  if (/<\/?[^>]+>/.test(text)) {
    score -= 15;
  }

  return Math.max(0, score);
}
