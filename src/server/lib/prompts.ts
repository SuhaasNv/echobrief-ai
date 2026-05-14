/**
 * Centralized LLM prompts and JSON Schemas.
 *
 * All schemas are written for OpenAI's Strict Mode (response_format:
 * json_schema with strict: true), which requires:
 *   - All properties listed in `required`
 *   - additionalProperties: false
 *   - No type unions (use nullable via `type: ["string", "null"]`)
 */

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "action_items"],
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["executive", "key_topics", "decisions", "open_questions", "chapters"],
      properties: {
        executive: {
          type: "string",
          description: "3–5 sentence executive summary of the meeting.",
        },
        key_topics: {
          type: "array",
          items: { type: "string" },
          description: "Up to 5 main topics discussed.",
        },
        decisions: {
          type: "array",
          items: { type: "string" },
          description: "Concrete decisions made during the meeting.",
        },
        open_questions: {
          type: "array",
          items: { type: "string" },
          description: "Unresolved questions or blockers.",
        },
        chapters: {
          type: "array",
          description: "5–10 logical topic chapters with time ranges.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "start_sec", "end_sec", "summary"],
            properties: {
              title: { type: "string" },
              start_sec: { type: "integer" },
              end_sec: { type: "integer" },
              summary: { type: "string" },
            },
          },
        },
      },
    },
    action_items: {
      type: "array",
      description: "Extracted concrete tasks with owner + deadline when stated.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "assignee_name", "due_date", "timestamp_sec"],
        properties: {
          description: { type: "string" },
          assignee_name: {
            type: ["string", "null"],
            description: "Name of person assigned, or null if not specified.",
          },
          due_date: {
            type: ["string", "null"],
            description: "ISO date (YYYY-MM-DD) if mentioned, otherwise null.",
          },
          timestamp_sec: {
            type: ["integer", "null"],
            description: "Approximate timestamp (seconds) in the meeting.",
          },
        },
      },
    },
  },
} as const;

export const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "total",
    "participation",
    "actionability",
    "focus",
    "clarity",
    "efficiency",
    "explanation",
  ],
  properties: {
    total: { type: "number", description: "Overall score 0–10." },
    participation: { type: "number", description: "Speaker balance score 0–10." },
    actionability: { type: "number", description: "Action item clarity score 0–10." },
    focus: { type: "number", description: "Topic adherence score 0–10." },
    clarity: { type: "number", description: "Communication clarity score 0–10." },
    efficiency: { type: "number", description: "Time efficiency score 0–10." },
    explanation: { type: "string", description: "2–3 sentence rationale." },
  },
} as const;

// ----------------------------------------------------------------------------
// Inferred TypeScript types matching the schemas
// ----------------------------------------------------------------------------

export interface AnalysisStructured {
  summary: {
    executive: string;
    key_topics: string[];
    decisions: string[];
    open_questions: string[];
    chapters: Array<{
      title: string;
      start_sec: number;
      end_sec: number;
      summary: string;
    }>;
  };
  action_items: Array<{
    description: string;
    assignee_name: string | null;
    due_date: string | null;
    timestamp_sec: number | null;
  }>;
}

export interface ScoreStructured {
  total: number;
  participation: number;
  actionability: number;
  focus: number;
  clarity: number;
  efficiency: number;
  explanation: string;
}

// ----------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------

export const PROMPTS = {
  MEETING_ANALYSIS_SYSTEM: `You are EchoBrief's meeting analyst. You read meeting transcripts and produce:
  1. A structured summary with executive overview, key topics, decisions, and open questions
  2. A list of action items with assignees and deadlines where mentioned
  3. Chapter segmentation by topic

  Rules:
  - Be specific. "Suhaas will deploy the auth fix by Friday" — not "deploy something".
  - Never invent information. If an assignee or deadline is not stated, return null.
  - Action items must be concrete tasks, not topic mentions.
  - Decisions must be explicit ("we agreed to X"), not implied.`,

  meetingAnalysisUser: (transcript: string) => `Here is the meeting transcript:

  <transcript>
  ${transcript}
  </transcript>

  Analyze this meeting and return a structured response matching the schema.`,

  SCORE_SYSTEM: `You score meeting effectiveness on five dimensions, each 0–10:
  - Participation: balance of speaker contributions (10 = balanced, 0 = one person dominates)
  - Actionability: clarity of next steps (10 = clear owners + deadlines, 0 = no actions)
  - Focus: topic adherence (10 = stayed on agenda, 0 = constant tangents)
  - Clarity: communication directness (10 = explicit, 0 = vague/confused)
  - Efficiency: time well used (10 = concise, 0 = rambling)

  Total = weighted average. Provide a brief explanation (2–3 sentences).`,

  scoreUser: (
    transcript: string,
    speakerStats: Array<{ label: string; talk_time_sec: number; word_count: number }>,
    actionItemCount: number,
  ) => `Speaker stats:
  ${speakerStats.map((s) => `- ${s.label}: ${s.talk_time_sec}s talk time, ${s.word_count} words`).join("\n")}

  Action items extracted: ${actionItemCount}

  Transcript:
  <transcript>
  ${transcript}
  </transcript>

  Score this meeting.`,

  perMeetingQaSystem: (transcript: string, meetingTitle: string) => `You are EchoBrief, answering questions about a specific meeting.

  Meeting: "${meetingTitle}"

  <transcript>
  ${transcript}
  </transcript>

  Rules:
  - Answer ONLY using information from the transcript above.
  - If the answer is not in the transcript, say so plainly. Do not invent facts.
  - Cite specific moments using timestamps when possible (e.g., "at 14:32, ...").
  - Be direct and specific. Avoid hedging language.`,

  crossMeetingQaSystem: (
    chunks: Array<{ meeting_title: string; content: string; start_sec: number }>,
  ) => `You are EchoBrief, answering questions across the user's meeting history.

  Use ONLY the context below to answer. Cite the source meeting and timestamp for each claim.
  If the context doesn't contain the answer, say so.

  <context>
  ${chunks
    .map(
      (c, i) =>
        `[Source ${i + 1}] Meeting: "${c.meeting_title}" (at ${formatTimestamp(c.start_sec)})\n${c.content}`,
    )
    .join("\n\n")}
  </context>`,

  emailSystem: (
    type: "meeting_recap" | "stakeholder_update" | "sprint_summary" | "action_item_assignment",
    tone: "professional" | "casual",
  ) => {
    const typeMap = {
      meeting_recap: "a recap email to all attendees",
      stakeholder_update: "an executive-style update for stakeholders not in the meeting",
      sprint_summary: "an engineering-focused sprint summary",
      action_item_assignment: "individual task assignment messages",
    };
    return `You write ${typeMap[type]} based on a meeting summary. Tone: ${tone}.

  Rules:
  - Use real names and specific details from the meeting.
  - No generic AI fluff ("Hope this finds you well", "great meeting today").
  - Lead with what matters: decisions, action items, next steps.
  - Keep it under 200 words.
  - Output only the email body. No subject line, no signature placeholders.`;
  },

  emailUser: (
    summary: {
      executive: string;
      key_topics: string[];
      decisions: string[];
      open_questions: string[];
    },
    actionItems: Array<{ description: string; assignee_name: string | null; due_date: string | null }>,
    participants: string[],
  ) => `Meeting summary:
  ${summary.executive}

  Decisions:
  ${summary.decisions.map((d) => `- ${d}`).join("\n")}

  Action items:
  ${actionItems.map((a) => `- ${a.description}${a.assignee_name ? ` (${a.assignee_name})` : ""}${a.due_date ? ` — due ${a.due_date}` : ""}`).join("\n")}

  Open questions:
  ${summary.open_questions.map((q) => `- ${q}`).join("\n")}

  Participants: ${participants.join(", ") || "[not specified]"}

  Write the email.`,
};

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
