import { serve } from "bun";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { handleApi } from "./api";
import { ensureAdmin } from "./auth";

/**
 * Elevate CRM — single Bun server: serves the built React frontend from
 * ./dist and the JSON API under /api. One process, one port, real SQLite
 * file. Designed to be deployed as a single unit to any Bun-capable host.
 */

const PORT = Number(process.env.PORT ?? 3001);
const DIST_DIR = join(import.meta.dir, "..", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function serveStatic(pathname: string): Response {
  let rel = pathname === "/" ? "/index.html" : pathname;
  // Guard against path traversal.
  if (rel.includes("..")) return new Response("Not found", { status: 404 });
  const filePath = join(DIST_DIR, rel);
  if (!existsSync(filePath)) {
    // SPA fallback: any unknown path gets the app shell (the app uses
    // internal state routing, so this is mostly for robustness).
    if (!existsSync(join(DIST_DIR, "index.html"))) {
      return new Response("Frontend not built yet. Run `bun run build` first.", { status: 200 });
    }
    return new Response(readFileSync(join(DIST_DIR, "index.html")), {
      status: 200,
      headers: { "Content-Type": MIME[".html"] },
    });
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const body = readFileSync(filePath);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    },
  });
}

// Seed the admin account at startup if ADMIN_EMAIL / ADMIN_PASSWORD are set.
const seed = await ensureAdmin();
console.log(seed.message);

if (!existsSync(join(DIST_DIR, "index.html"))) {
  console.log("[crm] dist/index.html missing — run `bun run build` to build the frontend.");
}

const server = serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, url);
    }
    return serveStatic(url.pathname);
  },
});

console.log(`[crm] Elevate CRM listening on http://localhost:${PORT}`);
console.log(`[crm] Database: ${process.env.DATA_DIR ?? join(import.meta.dir, "..", "data")}/crm.db`);

// Keep the process alive if all handlers detach (paranoia guard).
process.on("SIGINT", () => server.stop(true));
