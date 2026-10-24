// Local dev server: serves the static site and runs api/*.js the way Vercel does.
// Usage: node scripts/dev-server.mjs  (reads .env if present)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || (process.argv.includes("--memory") ? 3001 : 3000));

// .env loader (no dependency). .env.local comes from `vercel env pull`.
for (const name of [".env", ".env.local"]) {
  const envFile = path.join(root, name);
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// --memory: an isolated local world (no Redis, no wallet key, no launches), safe while production runs.
// --token=<mint>: pretend the project token is live, to try the holder chat.
if (process.argv.includes("--memory")) {
  // keep the public address (shop and tips show it), drop the key
  if (!process.env.AGENT_WALLET_PUBLIC) process.env.AGENT_WALLET_PUBLIC = (await import("../lib/wallet.js")).publicAddress() || "";
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "AGENT_WALLET_SECRET", "LAUNCH_ENABLED", "PINATA_JWT"]) delete process.env[k];
  process.env.SESSION_SECRET ||= "local-dev-only";
}
// --wallet=<address>: the crew wallet to show (public address only)
const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
if (walletArg) process.env.AGENT_WALLET_PUBLIC = walletArg.slice(9);
const tokenArg = process.argv.find((a) => a.startsWith("--token="));
if (tokenArg) process.env.PROJECT_TOKEN_MINT = tokenArg.slice(8);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2", ".glb": "model/gltf-binary" };
const BLOCKED = ["node_modules", ".git", ".env", "api", "lib", "scripts"];

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, "");
    const file = path.join(root, "api", `${name}.js`);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("no such api"); }
    try {
      const mod = await import(pathToFileURL(file).href);
      req.body = req.method === "POST" ? await readJson(req) : undefined;
      // tiny Vercel-style helpers
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (obj) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
      await mod.default(req, res);
    } catch (err) {
      console.error(err);
      res.statusCode = 500; res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  if (/^\/coin\/[^/]+\/?$/.test(p)) p = "/coin.html"; // same rewrite as vercel.json
  const first = p.split("/")[1];
  if (BLOCKED.includes(first)) { res.statusCode = 403; return res.end("forbidden"); }
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
  res.setHeader("cache-control", "no-store");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Cookers dev server on http://localhost:${PORT}`);
  console.log(`claude: ${process.env.ANTHROPIC_API_KEY ? "configured" : "missing"} · fal: ${process.env.FAL_KEY ? "configured" : "missing"} · redis: ${process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? "configured" : "memory"} · mode: ${process.env.TRADING_MODE || "paper"}`);
});
