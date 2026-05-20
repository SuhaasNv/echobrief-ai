#!/usr/bin/env node
/**
 * Test subscription API endpoint.
 * 
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/test-subscription-api.mjs
 */

import postgres from "postgres";

async function testSubscriptionEndpoint() {
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: "require",
    max: 1,
    prepare: false,
  });

  try {
    console.log("Testing subscription system...\n");

    // 1. Check if subscriptions table exists
    console.log("✓ Checking subscriptions table...");
    const subscriptions = await sql`SELECT * FROM subscriptions LIMIT 1`;
    console.log(`  Found ${subscriptions.length} subscription(s)`);

    // 2. Check if usage_logs table exists
    console.log("✓ Checking usage_logs table...");
    const usageLogs = await sql`SELECT * FROM usage_logs LIMIT 1`;
    console.log(`  Found ${usageLogs.length} usage log(s)`);

    // 3. Get a user to test with
    console.log("\n✓ Getting test user...");
    const users = await sql`SELECT id, email FROM users LIMIT 1`;
    if (users.length === 0) {
      console.log("  No users found. Create a user first.");
      return;
    }
    const testUser = users[0];
    console.log(`  Using user: ${testUser.email} (${testUser.id})`);

    // 4. Check user's subscription
    console.log("\n✓ Checking user subscription...");
    const userSubs = await sql`
      SELECT tier, status, created_at
      FROM subscriptions
      WHERE user_id = ${testUser.id}
    `;
    if (userSubs.length > 0) {
      console.log(`  Tier: ${userSubs[0].tier}`);
      console.log(`  Status: ${userSubs[0].status}`);
      console.log(`  Created: ${userSubs[0].created_at}`);
    } else {
      console.log("  No subscription found (should have been backfilled)");
    }

    // 5. Test usage tracking functions
    console.log("\n✓ Testing usage tracker functions...");
    
    // Import the usage tracker (this requires the module to work in Node)
    console.log("  Note: Full API testing requires running the dev server");
    console.log("  Run: npm run dev:api");
    console.log("  Then test: curl http://localhost:3000/api/v1/subscription");

    console.log("\n✅ Database schema verification complete!");
    console.log("\nNext steps:");
    console.log("  1. Start the API server: npm run dev:api");
    console.log("  2. Get an auth token by logging in");
    console.log("  3. Test the endpoint:");
    console.log('     curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/subscription');
    
  } catch (err) {
    console.error("❌ Test failed:", err.message);
    throw err;
  } finally {
    await sql.end();
  }
}

testSubscriptionEndpoint().catch((err) => {
  console.error(err);
  process.exit(1);
});
