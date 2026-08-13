/**
 * `bun run seed` — idempotently seed the admin account from env vars.
 * Useful after setting ADMIN_EMAIL / ADMIN_PASSWORD without restarting the server.
 */
import { ensureAdmin } from "./auth";

const result = await ensureAdmin();
console.log(result.message);
process.exit(result.created ? 0 : 1);
