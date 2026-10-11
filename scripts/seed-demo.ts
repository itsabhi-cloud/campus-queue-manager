/**
 * Resets the public demo: wipes the database and seeds the demo campus with demo accounts.
 *   DEMO_MODE=true node dist/seed-demo.js     (production build)
 *   DEMO_MODE=true pnpm db:seed:demo          (from source)
 *
 * Safe to point at production *only* in the sense that it refuses to touch a database that holds
 * any non-demo account. The server also does this automatically (empty database on startup, then
 * daily), so this script is for an immediate reset.
 */
import { closeDatabase } from "../server/db/client";
import { demoModeEnabled, resetDemoData } from "../server/demo";

try {
  if (!demoModeEnabled()) {
    console.error(
      "Refusing to seed demo data: set DEMO_MODE=true for a demo database."
    );
    process.exitCode = 1;
  } else {
    const result = await resetDemoData();
    if (result.reset) console.log("Demo data reset.");
    else {
      console.error(`Demo data not reset: ${result.reason}`);
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(
    "Demo seed failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
