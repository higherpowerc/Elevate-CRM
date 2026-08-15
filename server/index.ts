import { serve } from "bun";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { handleApi } from "./api";
import { ensureAdmin } from "./auth";
import { renderSignPage, readAgreementPdf } from "./agreements";

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
  ".pdf": "application/pdf",
};

/** Best-effort client IP for the e-signature delivery stamp: X-Forwarded-For
 *  first (the app runs behind Render's proxy in production), else Bun's
 *  server.requestIP (the fetch handler's second argument is the Server). */
function clientIp(req: Request, server: { requestIP(req: Request): { address: string } | null }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim() !== "") return xff.split(",")[0].trim();
  try {
    const ip = server.requestIP(req);
    if (ip?.address) return ip.address;
  } catch {
    /* ignore */
  }
  return "";
}

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
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, url, srv);
    }
    /* Native e-signature — PUBLIC routes (the emailed link is the credential).
       /sign/<token> renders the sign/decline page (recording delivery on
       first open); /agreement-pdf/<pdfId> serves the generated PDF (the id is
       an unguessable random, and the page links it for the signer). These
       must be checked BEFORE the SPA fallback. */
    if (req.method === "GET" && url.pathname.startsWith("/sign/")) {
      const token = decodeURIComponent(url.pathname.slice("/sign/".length));
      return renderSignPage(token, clientIp(req, srv));
    }
    if (req.method === "GET" && url.pathname.startsWith("/agreement-pdf/")) {
      const pdfId = url.pathname.slice("/agreement-pdf/".length);
      const bytes = readAgreementPdf(pdfId);
      if (!bytes) return new Response("Not found", { status: 404 });
      return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": MIME[".pdf"],
          "Cache-Control": "private, max-age=3600",
          "Content-Disposition": `inline; filename="agreement-${pdfId}.pdf"`,
        },
      });
    }
    return serveStatic(url.pathname);
  },
});

console.log(`[crm] Elevate CRM listening on http://localhost:${PORT}`);
console.log(`[crm] Database: ${process.env.DATA_DIR ?? join(import.meta.dir, "..", "data")}/crm.db`);

// Keep the process alive if all handlers detach (paranoia guard).
process.on("SIGINT", () => server.stop(true));
