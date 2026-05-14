import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name
`;
console.log("Tables:");
for (const t of tables) console.log("  -", t.table_name);

const extensions = await sql`
  SELECT extname FROM pg_extension ORDER BY extname
`;
console.log("\nExtensions:");
for (const e of extensions) console.log("  -", e.extname);

const fn = await sql`
  SELECT proname FROM pg_proc
  WHERE proname = 'match_transcript_chunks'
`;
console.log("\nFunctions:");
for (const f of fn) console.log("  -", f.proname);

await sql.end();
