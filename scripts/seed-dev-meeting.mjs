/**
 * Seed a finished meeting straight into a LOCAL database.
 *
 * Why this exists: several things about the meeting screen can only be judged by
 * looking at them — whether the ribbon stays legible across a long conversation,
 * whether a pinned header lets content read through, whether an hour of
 * transcript scrolls smoothly. Producing that state the honest way means a real
 * recording through a real transcription bill, every time you want to look.
 *
 * This writes the END state directly: a `complete` meeting with a transcript,
 * diarized speakers and a summary. It does NOT exercise the pipeline — no
 * upload, no AssemblyAI, no worker — so it proves nothing about processing and
 * must never be used to claim transcription works. It is a rendering fixture.
 *
 * Refuses to run against anything but localhost, because a fake meeting in a
 * user's real library is indistinguishable from a bug.
 *
 *   node scripts/seed-dev-meeting.mjs --email you@local.test --minutes 30
 *   node scripts/seed-dev-meeting.mjs --email you@local.test --minutes 10 --speakers 2
 */
import postgres from "postgres";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}

const email = args.get("email");
const minutes = Number(args.get("minutes") ?? 10);
const speakerCount = Math.min(Math.max(Number(args.get("speakers") ?? 3), 1), 5);
const title = args.get("title") ?? `${minutes}-minute meeting`;

if (!email) {
  console.error("--email is required");
  process.exit(1);
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/echobrief";

// A fake meeting is only ever acceptable in a database nobody trusts. Checked on
// the host rather than on a NODE_ENV flag, which is the thing most likely to be
// wrong in the shell that does the damage.
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL)) {
  console.error(
    "Refusing to seed: DATABASE_URL is not local.\n  " + DATABASE_URL.replace(/:[^:@]+@/, ":***@"),
  );
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

const VOICES = ["A", "B", "C", "D", "E"].slice(0, speakerCount);

/** Turns of real meeting shape, cycled to fill the requested duration. */
const LINES = [
  "Right, let's start with the migration timeline.",
  "We're two weeks out. The backfill is the risk, not the cutover.",
  "How long does the backfill actually take?",
  "Six hours on the staging copy. Production is roughly four times the rows.",
  "So a day, realistically, with checks.",
  "I'd rather run it over a weekend than squeeze it into a window.",
  "Agreed. Let's book the weekend of the twelfth.",
  "I'll write the rollback before then. If it fails halfway we need an exit.",
  "Does the rollback need the old schema kept around?",
  "Yes, dual-write for one release. Then we drop it.",
  "That pushes the cleanup into next quarter.",
  "It does, and I think that's the right trade.",
  "Fine. Who owns the comms to support?",
  "I'll take it. They'll want a one-pager on what users might see.",
  "Nothing, if it goes well.",
  "Nothing is not a thing support can put in a macro.",
  "Fair. I'll draft it and send it round Thursday.",
  "Do we need a load test first?",
  "On the read path, yes. The write path is unchanged.",
  "Then let's close on that and pick it up Monday.",
];

const target = minutes * 60;
const paragraphs = [];
let t = 0;

/**
 * Speaker RUNS, not round-robin.
 *
 * The first version of this cycled A,B,C,A,B,C… one turn each, which drew a
 * perfectly uniform barcode and made the ribbon look far worse than it is. Real
 * meetings hold a voice for several turns — someone explains, someone else asks
 * two follow-ups — so the bands merge into readable blocks. Getting this wrong
 * does not just look unrealistic, it invents a rendering problem that the
 * product does not have, which is the most expensive kind of bad fixture.
 *
 * Deterministic pseudo-random, so two runs of the same arguments produce the
 * same picture and a screenshot comparison means something.
 */
let seed = 1;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

let voice = 0;
let i = 0;
while (t < target) {
  // 1-4 consecutive turns from one speaker, then hand over.
  const run = 1 + Math.floor(rand() * 4);
  for (let k = 0; k < run && t < target; k += 1, i += 1) {
    const start = t;
    // 5-25s turns. The spread is what gives the ribbon uneven bands.
    const dur = 5 + Math.floor(rand() * 20);
    t = Math.min(t + dur, target);
    paragraphs.push({
      start,
      end: t,
      speaker: VOICES[voice],
      text: LINES[i % LINES.length],
    });
  }
  // Next speaker, but not always the neighbour — a 4-way meeting where the
  // order never varies is its own kind of fake.
  voice = (voice + 1 + Math.floor(rand() * (VOICES.length - 1 || 1))) % VOICES.length;
}

const talk = {};
const words = {};
for (const p of paragraphs) {
  talk[p.speaker] = (talk[p.speaker] ?? 0) + (p.end - p.start);
  words[p.speaker] = (words[p.speaker] ?? 0) + p.text.split(/\s+/).length;
}
const speakers = VOICES.map((v) => ({
  id: v,
  label: `Speaker ${v}`,
  talk_time_sec: talk[v] ?? 0,
  word_count: words[v] ?? 0,
}));

const rawText = paragraphs.map((p) => `Speaker ${p.speaker}: ${p.text}`).join("\n");

const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
if (!user) {
  console.error(`No user ${email}. Sign up in the app against the local API first.`);
  await sql.end();
  process.exit(1);
}
const [ws] = await sql`SELECT id FROM workspaces WHERE owner_id = ${user.id} LIMIT 1`;
if (!ws) {
  console.error("That user has no workspace.");
  await sql.end();
  process.exit(1);
}

// No audio_key, deliberately. There is no object in R2 to point at, and a
// player offering to play bytes that do not exist is a worse fixture than one
// with no player — RibbonScrubber already degrades to a static strip.
const [m] = await sql`
  INSERT INTO meetings (user_id, workspace_id, title, status, duration_sec, recorded_at, processed_at, meeting_score)
  VALUES (${user.id}, ${ws.id}, ${title}, 'complete', ${t}, now(), now(), ${sql.json({
    total: 7.4,
    participation: 8,
    actionability: 7,
    focus: 6,
    clarity: 8,
    efficiency: 7,
    explanation: "Balanced discussion with clear owners on most decisions.",
  })})
  RETURNING id`;

await sql`
  INSERT INTO transcripts (meeting_id, raw_text, content, speakers, language, provider)
  VALUES (${m.id}, ${rawText}, ${sql.json({ paragraphs })}, ${sql.json(speakers)}, 'en', 'assemblyai')`;

await sql`
  INSERT INTO summaries (meeting_id, executive, key_topics, decisions, open_questions, chapters)
  VALUES (${m.id},
    'The team agreed to run the database migration over the weekend of the twelfth rather than inside a maintenance window, because the backfill is expected to take about a day at production volumes.',
    ${["Migration timeline", "Backfill duration", "Rollback plan", "Support comms"]},
    ${["Run the migration the weekend of the twelfth", "Dual-write the old schema for one release", "Load test the read path only"]},
    ${["Does the rollback require keeping the old schema beyond one release?"]},
    ${sql.json([
      {
        title: "Timeline",
        start_sec: 0,
        end_sec: Math.floor(t * 0.3),
        summary: "Two weeks out; the backfill is the risk.",
      },
      {
        title: "Rollback",
        start_sec: Math.floor(t * 0.3),
        end_sec: Math.floor(t * 0.7),
        summary: "Dual-write for one release, cleanup next quarter.",
      },
      {
        title: "Comms and load test",
        start_sec: Math.floor(t * 0.7),
        end_sec: t,
        summary: "One-pager for support; read-path load test.",
      },
    ])})`;

console.log(
  `seeded ${m.id}  ${Math.round(t / 60)} min  ${speakers.length} speakers  ${paragraphs.length} segments`,
);
await sql.end();
