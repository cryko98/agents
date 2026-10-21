// Local dev server: serves the static site and runs api/*.js the way Vercel does.
// Usage: node scripts/dev-server.mjs  (reads .env if present)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3000);

// .env loader (no dependency)
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
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
  const first = p.split("/")[1];
  if (BLOCKED.includes(first)) { res.statusCode = 403; return res.end("forbidden"); }
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
  res.setHeader("cache-control", "no-store");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Agent House dev server on http://localhost:${PORT}`);
  console.log(`claude: ${process.env.ANTHROPIC_API_KEY ? "configured" : "missing"} · fal: ${process.env.FAL_KEY ? "configured" : "missing"}`);
});
