/**
 * Input sanitization utilities for security.
 *
 * Protects against:
 * - Prompt injection attacks in LLM inputs
 * - XSS/HTML injection in user-generated content
 * - Token exhaustion attacks (oversized inputs)
 */

import { logPromptInjection } from "./logger";

/**
 * Patterns that indicate potential prompt injection attempts.
 * These are logged and redacted when found in user input.
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
  stripHtml?: boolean;
  checkSuspiciousPatterns?: boolean;
  logSecurityEvents?: boolean;
}

/**
 * Sanitize user-provided transcript text for LLM processing.
 *
 * This is the most critical sanitization point since transcripts
 * go directly into LLM prompts and could contain adversarial content.
 */
export function sanitizeTranscript(text: string, options: SanitizeOptions = {}): string {
  const {
    maxLength = MAX_LENGTHS.transcript,
    stripHtml = true,
    checkSuspiciousPatterns = true,
    logSecurityEvents = true,
  } = options;

  let sanitized = text;

  // 1. Strip HTML/XML tags that could break prompt structure
  if (stripHtml) {
    sanitized = sanitized.replace(/<\/?[^>]+(>|$)/g, "");
  }

  // 2. Check for and redact suspicious patterns
  if (checkSuspiciousPatterns) {
    for (const pattern of SUSPICIOUS_PATTERNS) {
      const matches = sanitized.match(pattern);
      if (matches) {
        if (logSecurityEvents) {
          // Use centralized security logger
          logPromptInjection(
            "unknown", // userId not available in sanitization context
            pattern.source,
            matches[0],
            text.length,
          );
        }
        sanitized = sanitized.replace(pattern, "[REDACTED - POLICY VIOLATION]");
      }
    }
  }

  // 3. Truncate to prevent token exhaustion
  if (sanitized.length > maxLength) {
    if (logSecurityEvents) {
      console.warn("[SECURITY] Transcript truncated:", {
        originalLength: sanitized.length,
        maxLength,
        truncated: sanitized.length - maxLength,
        timestamp: new Date().toISOString(),
      });
    }
    sanitized = sanitized.slice(0, maxLength) + "\n\n[TRUNCATED FOR LENGTH]";
  }

  return sanitized;
}

/**
 * Sanitize meeting/lecture titles.
 * Titles appear in prompts and UI, so must be safe.
 */
export function sanitizeTitle(title: string): string {
  return title
    .replace(/<\/?[^>]+(>|$)/g, "") // Strip HTML
    .slice(0, MAX_LENGTHS.title) // Limit length
    .trim();
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
