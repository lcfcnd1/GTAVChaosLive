import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = normalize(process.env.OVERLAY_ROOT ?? join(process.cwd(), "apps/overlay"));
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const sourceRoutes = new Set(["/overlay/vertical", "/overlay/gifts", "/overlay/alerts", "/overlay/chaos"]);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const requested = pathname === "/" || sourceRoutes.has(pathname) ? "/index.html" : pathname;
  const file = normalize(join(root, requested.replace(/^\/+/, "")));
  if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
  try { const body = await readFile(file); response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" }); response.end(body); }
  catch { response.writeHead(404); response.end("Not found"); }
});
server.listen(Number(process.env.OVERLAY_PORT ?? 39178), "127.0.0.1", () => console.log("GTA Chaos Live overlay: http://127.0.0.1:39178/"));
